import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  cancel,
  pending,
  isPermissionGranted,
  requestPermission,
  Schedule,
} from "@tauri-apps/plugin-notification";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { deleteRecord, readRecord, writeRecord } from "./storage.ts";
import {
  currentPeriodMonth,
  decodeData,
  emptyData,
  insights,
  money,
  type Data,
} from "./domain.ts";
import type { PinLockRecord } from "./crypto.ts";

export const native = isTauri();
export const android = native && /Android/i.test(navigator.userAgent);

let loading: Promise<Data> | undefined;

export async function loadData(): Promise<Data> {
  return (loading ??= initializeData());
}

async function initializeData(): Promise<Data> {
  const saved = await readRecord("finances");
  let legacy = saved;
  if (saved === undefined && native) {
    const options = { baseDir: BaseDirectory.AppData };
    if (await exists("finances.json", options)) {
      const old = JSON.parse(await readTextFile("finances.json", options));
      if (!old || !Object.hasOwn(old, "data"))
        throw new Error(
          "Не удалось прочитать прежние данные. Исходный файл сохранен.",
        );
      legacy = old.data;
    }
  } else if (saved === undefined) {
    const old = localStorage.getItem("potok-finance-v1");
    if (old !== null) legacy = JSON.parse(old);
  }
  let data = legacy === undefined ? emptyData() : decodeData(legacy);
  const wasMigrated =
    saved !== undefined &&
    typeof saved === "object" &&
    saved !== null &&
    (saved as { version?: number }).version !== 2;
  if (!data.demo && saved !== undefined && !wasMigrated) return data;
  if (data.demo) data = emptyData();
  await writeRecord("finances", data);
  return data;
}

export async function persistData(data: Data): Promise<void> {
  const validated = decodeData(data);
  await writeRecord("finances", validated);
}

export async function loadPinLock(): Promise<PinLockRecord | null> {
  const raw = await readRecord("app-lock");
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as PinLockRecord).hash === "string" &&
    typeof (raw as PinLockRecord).salt === "string"
  ) {
    return raw as PinLockRecord;
  }
  return null;
}

export async function savePinLock(record: PinLockRecord): Promise<void> {
  await writeRecord("app-lock", record);
}

export async function clearPinLock(): Promise<void> {
  await deleteRecord("app-lock");
}

export function hapticTap(): void {
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    ) {
      navigator.vibrate(10);
    }
  } catch {
    /* Ignore vibration permission restrictions on desktop browsers. */
  }
}

export async function saveFile(
  name: string,
  content: string,
  extension: "json" | "csv",
): Promise<boolean> {
  if (native) {
    const path = await save({
      defaultPath: name,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return false;
    await writeTextFile(path, content);
  } else {
    const url = URL.createObjectURL(
      new Blob([content], {
        type:
          extension === "csv"
            ? "text/csv;charset=utf-8"
            : "application/json;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

async function pickTextFile(
  filterName: string,
  extensions: string[],
  accept: string,
  maxBytes: number,
  tooBigMessage: string,
): Promise<string | null> {
  if (native) {
    const path = await open({
      multiple: false,
      filters: [{ name: filterName, extensions }],
    });
    if (!path) return null;
    const raw = await readTextFile(path);
    if (raw.length > maxBytes) throw new Error(tooBigMessage);
    return raw;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        if (file.size > maxBytes) throw new Error(tooBigMessage);
        resolve(await file.text());
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function pickBackupRaw(): Promise<string | null> {
  return pickTextFile(
    "Резервная копия finacc",
    ["json"],
    ".json,application/json",
    20_000_000,
    "Резервная копия должна быть не больше 20 МБ.",
  );
}

export async function pickCsvText(): Promise<string | null> {
  return pickTextFile(
    "CSV-выписка",
    ["csv", "txt"],
    ".csv,text/csv,text/plain",
    10_000_000,
    "CSV-файл должен быть не больше 10 МБ.",
  );
}

export async function pickBackup(): Promise<Data | null> {
  const raw = await pickBackupRaw();
  if (raw === null) return null;
  return decodeData(JSON.parse(raw));
}

export async function enableNotifications(): Promise<void> {
  if (!android)
    throw new Error(
      "Фоновые напоминания доступны в Android-приложении. Здесь напоминания отображаются внутри finacc.",
    );
  if (
    !(await isPermissionGranted()) &&
    (await requestPermission()) !== "granted"
  )
    throw new Error("Разрешите уведомления для finacc в настройках Android.");
}

function notificationId(id: string): number {
  let hash = 0;
  for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return hash & 0x7fffffff;
}

let notificationQueue = Promise.resolve();

export function syncReminders(data: Data) {
  if (!android) return Promise.resolve();
  const task = notificationQueue
    .catch(() => {})
    .then(() => scheduleReminders(data));
  notificationQueue = task;
  return task;
}

async function scheduleReminders(data: Data) {
  const scheduled = await pending();
  if (scheduled.length) await cancel(scheduled.map((n) => n.id));
  if (!data.notifications || data.demo) return;
  if (!(await isPermissionGranted()))
    throw new Error(
      "Уведомления отключены в настройках Android. Напоминания сохранены в приложении.",
    );
  for (const reminder of data.reminders) {
    const date = new Date(`${reminder.date}T${reminder.time}:00`);
    // The JS helper returns void; await the native command to report scheduling failures.
    if (!reminder.done && date.getTime() > Date.now())
      await invoke<void>("plugin:notification|notify", {
        options: {
          id: notificationId(reminder.id),
          title: reminder.title,
          body: reminder.amount
            ? money(reminder.amount)
            : "Запланированное напоминание",
          schedule: Schedule.at(date, false, true),
        },
      });
  }
}

export async function notifyBudget(before: Data, after: Data) {
  if (
    !android ||
    !after.notifications ||
    after.demo ||
    !(await isPermissionGranted())
  )
    return;
  const currentPeriod = currentPeriodMonth(after.preferences.paydayDay);
  const prior = new Set(
    insights(before, currentPeriod)
      .filter((i) => i.severity === "warning")
      .map((i) => i.title),
  );
  for (const alert of insights(after, currentPeriod).filter(
    (i) => i.id.startsWith("limit-") && !prior.has(i.title),
  ))
    await invoke<void>("plugin:notification|notify", {
      options: { title: alert.title, body: alert.description },
    });
}
