import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AiModelId } from "./domain";
import { readRecord, writeRecord } from "./storage";

export interface AiModelPreset {
  id: AiModelId;
  name: string;
  description: string;
  recommended: boolean;
  approxBytes: number;
  sizeLabel: string;
  ramRequirement: string;
  installed: boolean;
  installedBytes: number;
}

export interface AiStatus {
  supported: boolean;
  modelsDir: string;
  activeModelId: AiModelId | null;
  loadedModelId: AiModelId | null;
  downloadingModelId: AiModelId | null;
  generating: boolean;
  models: AiModelPreset[];
}

export interface AiDownloadProgress {
  modelId: AiModelId;
  stage: "tokenizer" | "weights" | "verifying" | "waiting";
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface AiBgStateSnapshot {
  modelId: AiModelId | null;
  status: "idle" | "downloading" | "done" | "error" | "canceled";
  stage: "tokenizer" | "weights" | "verifying" | "waiting";
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  error: string | null;
  active: boolean;
}

interface NativeAiDownloaderBridge {
  isAvailable(): boolean;
  startDownload(modelId: string): string;
  cancelDownload(): void;
  getStateJson(): string;
  resumePendingIfNeeded(): void;
}

declare global {
  interface Window {
    FinaccAiDownloader?: NativeAiDownloaderBridge;
    __finaccAiBgEvent?: (snapshot: AiBgStateSnapshot) => void;
  }
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  aborted?: boolean;
  error?: string;
}

export interface AiChatRequest {
  modelId: AiModelId;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  requestId: string;
}

export interface AiChatDone {
  requestId: string;
  fullText: string;
  aborted: boolean;
  tokensGenerated: number;
}

export const DEFAULT_AI_MODELS: AiModelPreset[] = [
  {
    id: "qwen2.5-3b",
    name: "Qwen2.5 3B Instruct (Q4_K_M)",
    description:
      "Рекомендуемая модель: точный разбор трат, категорий и вопросов на русском языке.",
    recommended: true,
    approxBytes: 1_930_000_000,
    sizeLabel: "~1.93 ГБ",
    ramRequirement: "6+ ГБ ОЗУ",
    installed: false,
    installedBytes: 0,
  },
  {
    id: "qwen2.5-1.5b",
    name: "Qwen2.5 1.5B Instruct (Q4_K_M)",
    description:
      "Лёгкая модель: быстрее скачивается и экономит память на компактных смартфонах.",
    recommended: false,
    approxBytes: 986_000_000,
    sizeLabel: "~986 МБ",
    ramRequirement: "4+ ГБ ОЗУ",
    installed: false,
    installedBytes: 0,
  },
];

export function unsupportedAiStatus(): AiStatus {
  return {
    supported: false,
    modelsDir: "",
    activeModelId: null,
    loadedModelId: null,
    downloadingModelId: null,
    generating: false,
    models: DEFAULT_AI_MODELS.map((m) => ({ ...m })),
  };
}

export function formatBytesRu(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 МБ";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} ГБ`;
  const mb = Math.max(1, Math.round(bytes / (1024 * 1024)));
  return `${mb} МБ`;
}

const VALID_STAGES = new Set(["tokenizer", "weights", "verifying", "waiting"]);
const VALID_MODELS = new Set(["qwen2.5-3b", "qwen2.5-1.5b"]);

function normalizeStage(
  raw: string | undefined,
): AiDownloadProgress["stage"] {
  if (raw && VALID_STAGES.has(raw)) {
    return raw as AiDownloadProgress["stage"];
  }
  return "weights";
}

function normalizeModelId(raw: string | null | undefined): AiModelId | null {
  if (raw && VALID_MODELS.has(raw)) {
    return raw as AiModelId;
  }
  return null;
}

export function isBackgroundDownloadSupported(): boolean {
  try {
    return Boolean(window.FinaccAiDownloader?.isAvailable?.());
  } catch {
    return false;
  }
}

export function getBackgroundDownloadState(): AiBgStateSnapshot | null {
  if (!isBackgroundDownloadSupported()) return null;
  try {
    const rawJson = window.FinaccAiDownloader!.getStateJson();
    if (!rawJson) return null;
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    const statusRaw = String(parsed.status ?? "idle");
    const status =
      statusRaw === "downloading" ||
      statusRaw === "done" ||
      statusRaw === "error" ||
      statusRaw === "canceled"
        ? statusRaw
        : "idle";
    return {
      modelId: normalizeModelId(
        typeof parsed.modelId === "string" ? parsed.modelId : null,
      ),
      status,
      stage: normalizeStage(
        typeof parsed.stage === "string" ? parsed.stage : undefined,
      ),
      downloadedBytes: Number(parsed.downloadedBytes) || 0,
      totalBytes: Number(parsed.totalBytes) || 0,
      percent: Number(parsed.percent) || 0,
      error: typeof parsed.error === "string" ? parsed.error : null,
      active: Boolean(parsed.active),
    };
  } catch {
    return null;
  }
}

export function getBackgroundDownloadProgress(): AiDownloadProgress | null {
  const bg = getBackgroundDownloadState();
  if (!bg || !bg.active || !bg.modelId) return null;
  return {
    modelId: bg.modelId,
    stage: bg.stage,
    downloadedBytes: bg.downloadedBytes,
    totalBytes: bg.totalBytes,
    percent: bg.percent,
  };
}

export function resumePendingBackgroundDownload(): void {
  if (!isBackgroundDownloadSupported()) return;
  try {
    window.FinaccAiDownloader?.resumePendingIfNeeded();
  } catch {
    // Non-critical foreground handoff
  }
}

export async function getAiStatus(): Promise<AiStatus> {
  if (!isTauri()) return unsupportedAiStatus();
  const base = await invoke<AiStatus>("ai_status");
  const bg = getBackgroundDownloadState();
  if (
    bg &&
    bg.active &&
    bg.modelId &&
    !base.models.some((m) => m.id === bg.modelId && m.installed)
  ) {
    base.downloadingModelId = bg.modelId;
  }
  return base;
}

export async function installAiModel(modelId: AiModelId): Promise<AiStatus> {
  if (!isTauri()) {
    throw new Error("Локальный ИИ доступен только в приложении для Android и ПК.");
  }
  if (isBackgroundDownloadSupported()) {
    window.FinaccAiDownloader!.startDownload(modelId);
    return getAiStatus();
  }
  return invoke<AiStatus>("ai_install_model", { modelId });
}

export async function cancelAiInstall(): Promise<void> {
  if (!isTauri()) return;
  if (isBackgroundDownloadSupported()) {
    try {
      window.FinaccAiDownloader!.cancelDownload();
    } catch {
      // Fall through to Rust flag reset
    }
  }
  await invoke("ai_cancel_install").catch(() => {});
}

export async function deleteAiModel(modelId: AiModelId): Promise<AiStatus> {
  if (!isTauri()) return unsupportedAiStatus();
  return invoke<AiStatus>("ai_delete_model", { modelId });
}

export async function unloadAiModel(): Promise<void> {
  if (!isTauri()) return;
  await invoke("ai_unload_model");
}

export async function sendAiChat(request: AiChatRequest): Promise<AiChatDone> {
  if (!isTauri()) {
    throw new Error("Локальный ИИ доступен только в приложении для Android и ПК.");
  }
  return invoke<AiChatDone>("ai_chat", { request });
}

export async function stopAiChat(): Promise<void> {
  if (!isTauri()) return;
  await invoke("ai_stop_chat");
}

export async function subscribeAiDownload(handlers: {
  onProgress?: (payload: AiDownloadProgress) => void;
  onDone?: (payload: { modelId: AiModelId }) => void;
  onError?: (payload: { modelId: AiModelId; error: string }) => void;
  onCanceled?: (payload: { modelId: AiModelId | null }) => void;
}): Promise<() => void> {
  if (!isTauri()) return () => {};

  const unlisteners: UnlistenFn[] = [];
  if (handlers.onProgress) {
    unlisteners.push(
      await listen<AiDownloadProgress>("ai-download-progress", (event) =>
        handlers.onProgress?.(event.payload),
      ),
    );
  }
  if (handlers.onDone) {
    unlisteners.push(
      await listen<{ modelId: AiModelId }>("ai-download-done", (event) =>
        handlers.onDone?.(event.payload),
      ),
    );
  }
  if (handlers.onError) {
    unlisteners.push(
      await listen<{ modelId: AiModelId; error: string }>(
        "ai-download-error",
        (event) => handlers.onError?.(event.payload),
      ),
    );
  }

  const bgListener = (raw: AiBgStateSnapshot) => {
    if (!raw || typeof raw !== "object") return;
    const modelId = normalizeModelId(raw.modelId);
    if (raw.status === "downloading" && modelId) {
      handlers.onProgress?.({
        modelId,
        stage: normalizeStage(raw.stage),
        downloadedBytes: Number(raw.downloadedBytes) || 0,
        totalBytes: Number(raw.totalBytes) || 0,
        percent: Number(raw.percent) || 0,
      });
    } else if (raw.status === "done" && modelId) {
      handlers.onDone?.({ modelId });
    } else if (raw.status === "error" && modelId) {
      handlers.onError?.({
        modelId,
        error: raw.error || "Сбой фоновой загрузки модели.",
      });
    } else if (raw.status === "canceled") {
      handlers.onCanceled?.({ modelId });
    }
  };
  const prevHandler = window.__finaccAiBgEvent;
  window.__finaccAiBgEvent = (snapshot) => {
    prevHandler?.(snapshot);
    bgListener(snapshot);
  };

  return () => {
    for (const unlisten of unlisteners) unlisten();
    if (window.__finaccAiBgEvent && !prevHandler) {
      delete window.__finaccAiBgEvent;
    } else {
      window.__finaccAiBgEvent = prevHandler;
    }
  };
}

export async function subscribeAiChat(handlers: {
  onToken?: (payload: { requestId: string; token: string }) => void;
  onDone?: (payload: AiChatDone) => void;
  onError?: (payload: { requestId: string; error: string }) => void;
}): Promise<() => void> {
  if (!isTauri()) return () => {};

  const unlisteners: UnlistenFn[] = [];
  if (handlers.onToken) {
    unlisteners.push(
      await listen<{ requestId: string; token: string }>(
        "ai-chat-token",
        (event) => handlers.onToken?.(event.payload),
      ),
    );
  }
  if (handlers.onDone) {
    unlisteners.push(
      await listen<AiChatDone>("ai-chat-done", (event) =>
        handlers.onDone?.(event.payload),
      ),
    );
  }
  if (handlers.onError) {
    unlisteners.push(
      await listen<{ requestId: string; error: string }>(
        "ai-chat-error",
        (event) => handlers.onError?.(event.payload),
      ),
    );
  }

  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

const MAX_SAVED_MESSAGES = 40;

export async function loadAiHistory(): Promise<AiChatMessage[]> {
  try {
    const raw = await readRecord("ai-chat");
    if (!Array.isArray(raw)) return [];
    const valid = raw.filter(
      (item): item is AiChatMessage =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as AiChatMessage).id === "string" &&
        ((item as AiChatMessage).role === "user" ||
          (item as AiChatMessage).role === "assistant") &&
        typeof (item as AiChatMessage).content === "string" &&
        typeof (item as AiChatMessage).createdAt === "number",
    );
    return valid.slice(-MAX_SAVED_MESSAGES);
  } catch {
    return [];
  }
}

export async function saveAiHistory(messages: AiChatMessage[]): Promise<void> {
  const sanitized = messages
    .filter((m) => m.content.trim().length > 0 && !m.error)
    .slice(-MAX_SAVED_MESSAGES);
  await writeRecord("ai-chat", sanitized);
}
