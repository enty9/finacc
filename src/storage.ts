import { isTauri } from "@tauri-apps/api/core";
import NativeDatabase from "@tauri-apps/plugin-sql";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

// Keep validated snapshots in single atomic rows in app_state.
const schema =
  "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)";
const upsert =
  "INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
const removeSql = "DELETE FROM app_state WHERE key = $1";

export type Key = "finances" | "usd-rate" | "rates" | "app-lock" | "ai-chat";

let nativeDb: Promise<NativeDatabase> | undefined;
let browserDb: Promise<IDBDatabase> | undefined;
let queue = Promise.resolve<unknown>(undefined);

function indexedDatabase() {
  return (browserDb ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("finacc", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Закройте другие вкладки finacc и повторите попытку."));
  }));
}

async function databaseFile(
  bytes?: Uint8Array,
): Promise<Uint8Array | undefined> {
  const db = await indexedDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", bytes ? "readwrite" : "readonly");
    const store = tx.objectStore("files");
    const request = bytes
      ? store.put(bytes, "finacc.db")
      : store.get("finacc.db");
    tx.oncomplete = () =>
      resolve(bytes ?? (request.result as Uint8Array | undefined));
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () =>
      reject(
        tx.error ??
          new Error("Не удалось сохранить SQLite-базу. Изменения не записаны."),
      );
  });
}

let sql: ReturnType<(typeof import("sql.js"))["default"]> | undefined;

async function accessRecord(
  key: Key,
  mode: "read" | "write" | "delete",
  value?: string,
): Promise<string | null> {
  if (isTauri()) {
    const db = await (nativeDb ??= NativeDatabase.load("sqlite:finacc.db").then(
      async (db) => {
        await db.execute(schema);
        return db;
      },
    ));
    if (mode === "write" && value !== undefined) {
      await db.execute(upsert, [key, value]);
      return value;
    }
    if (mode === "delete") {
      await db.execute(removeSql, [key]);
      return null;
    }
    const rows = await db.select<{ value: string }[]>(
      "SELECT value FROM app_state WHERE key = $1",
      [key],
    );
    return rows[0]?.value ?? null;
  }

  sql ??= import("sql.js").then((module) =>
    module.default({ locateFile: () => wasmUrl }),
  );
  const SQL = await sql;
  const db = new SQL.Database(await databaseFile());
  try {
    db.run(schema);
    if (mode === "write" && value !== undefined) {
      db.run(upsert, [key, value]);
      await databaseFile(db.export());
      return value;
    }
    if (mode === "delete") {
      db.run(removeSql, [key]);
      await databaseFile(db.export());
      return null;
    }
    const rows = db.exec("SELECT value FROM app_state WHERE key = $1", [key]);
    return (rows[0]?.values[0]?.[0] as string | undefined) ?? null;
  } finally {
    db.close();
  }
}

function access(key: Key, mode: "read" | "write" | "delete", value?: string) {
  const task = queue
    .catch(() => {})
    .then(() => accessRecord(key, mode, value));
  queue = task;
  return task;
}

export async function readRecord(key: Key): Promise<unknown> {
  const value = await access(key, "read");
  return value === null ? undefined : JSON.parse(value);
}

export async function writeRecord(key: Key, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("Нельзя сохранить пустую запись.");
  await access(key, "write", serialized);
}

export async function deleteRecord(key: Key): Promise<void> {
  await access(key, "delete");
}
