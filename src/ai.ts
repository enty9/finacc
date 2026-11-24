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
  stage: "tokenizer" | "weights" | "verifying";
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
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

export async function getAiStatus(): Promise<AiStatus> {
  if (!isTauri()) return unsupportedAiStatus();
  return invoke<AiStatus>("ai_status");
}

export async function installAiModel(modelId: AiModelId): Promise<AiStatus> {
  if (!isTauri()) {
    throw new Error("Локальный ИИ доступен только в приложении для Android и ПК.");
  }
  return invoke<AiStatus>("ai_install_model", { modelId });
}

export async function cancelAiInstall(): Promise<void> {
  if (!isTauri()) return;
  await invoke("ai_cancel_install");
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

  return () => {
    for (const unlisten of unlisteners) unlisten();
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
