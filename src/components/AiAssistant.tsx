import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Cpu,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  formatBytesRu,
  type AiChatMessage,
  type AiDownloadProgress,
  type AiStatus,
} from "../ai";
import { buildFinancialContext, getQuickPrompts } from "../aiContext";
import type { AiChoice, AiModelId, Data, Page } from "../domain";

const downloadStageLabel = (stage: AiDownloadProgress["stage"]): string => {
  switch (stage) {
    case "tokenizer":
      return "Подготовка токенизатора...";
    case "verifying":
      return "Проверка целостности GGUF...";
    case "weights":
    default:
      return "Загрузка весов модели...";
  }
};

export function AiInstallProgressBar({
  status,
  progress,
  onCancel,
  compact = false,
}: {
  status: AiStatus;
  progress: AiDownloadProgress | null;
  onCancel: () => Promise<void>;
  compact?: boolean;
}) {
  const [canceling, setCanceling] = useState(false);
  const activeId = status.downloadingModelId ?? progress?.modelId ?? "qwen2.5-3b";
  const model = status.models.find((m) => m.id === activeId);
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));
  const totalBytes = progress?.totalBytes || model?.approxBytes || 0;
  const downloadedBytes = progress?.downloadedBytes ?? 0;

  return (
    <div
      className={`glass-surface ai-progress-card ${compact ? "compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="ai-progress-top">
        <div className="ai-progress-title">
          <LoaderCircle size={17} className="ai-spin" />
          <div>
            <strong>Установка {model?.name ?? activeId}</strong>
            <small>
              {downloadStageLabel(progress?.stage ?? "weights")}{" "}
              {percent > 0 ? `(${Math.round(percent)}%)` : ""}
            </small>
          </div>
        </div>
        <button
          type="button"
          className="button ghost small"
          disabled={canceling}
          onClick={async () => {
            setCanceling(true);
            try {
              await onCancel();
            } finally {
              setCanceling(false);
            }
          }}
        >
          Отменить
        </button>
      </div>
      <div className="ai-progress-track" aria-hidden="true">
        <div className="ai-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="ai-progress-meta">
        <span>
          {formatBytesRu(downloadedBytes)} из {formatBytesRu(totalBytes)}
        </span>
        <span>После установки вверху появится кнопка ✨</span>
      </div>
    </div>
  );
}

export function AiOptInCard({
  status,
  choice,
  selectedModelId,
  onSelectModel,
  onInstall,
  onDismiss,
}: {
  status: AiStatus;
  choice: AiChoice;
  selectedModelId: AiModelId;
  onSelectModel: (modelId: AiModelId) => Promise<void>;
  onInstall: (modelId: AiModelId) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [pickedId, setPickedId] = useState<AiModelId>(selectedModelId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPickedId(selectedModelId);
  }, [selectedModelId]);

  if (!status.supported || status.downloadingModelId) return null;

  const selectedModel =
    status.models.find((m) => m.id === pickedId) ?? status.models[0];
  const anyInstalled = status.models.some((m) => m.installed);

  if (choice === "disabled" || anyInstalled) return null;

  return (
    <section
      className="glass-surface ai-optin-card"
      aria-label="Локальный ИИ-помощник"
    >
      <div className="ai-optin-head">
        <span className="wealth-icon ai-badge-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <span className="eyebrow">ЛОКАЛЬНЫЙ ИИ ПО ЖЕЛАНИЮ</span>
          <h3>Финансовый ассистент прямо на устройстве</h3>
          <p>
            Поможет разобрать лишние траты, бюджет и базовые идеи по накоплениям
            без отправки цифр в облако. Модель ставится отдельно и скрывается,
            если она вам не нужна.
          </p>
        </div>
      </div>

      {choice === "undecided" && (
        <div className="ai-model-options" role="radiogroup" aria-label="Выбор модели ИИ">
          {status.models.map((model) => {
            const active = model.id === pickedId;
            return (
              <button
                key={model.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`ai-model-option ${active ? "selected" : ""}`}
                onClick={async () => {
                  setPickedId(model.id);
                  await onSelectModel(model.id);
                }}
              >
                <div className="ai-model-option-top">
                  <strong>{model.name}</strong>
                  {model.recommended ? (
                    <span className="ai-tag recommended">Рекомендуется</span>
                  ) : (
                    <span className="ai-tag">Лёгкая</span>
                  )}
                </div>
                <small>{model.description}</small>
                <div className="ai-model-specs">
                  <span>{model.sizeLabel}</span>
                  <span>{model.ramRequirement}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="ai-optin-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onInstall(pickedId);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} />
          <span>
            {choice === "enabled"
              ? `Установить ${selectedModel?.name ?? "модель"}`
              : `Установить (${selectedModel?.sizeLabel ?? "~1.93 ГБ"})`}
          </span>
        </button>
        <button
          type="button"
          className="button ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDismiss();
            } finally {
              setBusy(false);
            }
          }}
        >
          Не нужно
        </button>
      </div>
      <small className="ai-optin-note">
        Кнопка ✨ в верхнем углу появится только после завершения установки. Включить
        или удалить модель можно в любой момент в Настройках.
      </small>
    </section>
  );
}

export function AiSettingsSection({
  status,
  progress,
  choice,
  selectedModelId,
  onSelectModel,
  onInstall,
  onCancelInstall,
  onUnloadModel,
  onDeleteModel,
  onSetChoice,
  onOpenChat,
}: {
  status: AiStatus | null;
  progress: AiDownloadProgress | null;
  choice: AiChoice;
  selectedModelId: AiModelId;
  onSelectModel: (modelId: AiModelId) => Promise<void>;
  onInstall: (modelId: AiModelId) => Promise<void>;
  onCancelInstall: () => Promise<void>;
  onUnloadModel: () => Promise<void>;
  onDeleteModel: (modelId: AiModelId) => Promise<void>;
  onSetChoice: (next: AiChoice) => Promise<void>;
  onOpenChat: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  if (!status || !status.supported) {
    return (
      <div className="settings-backup ai-settings-card">
        <h3>Локальный ИИ-помощник</h3>
        <p>
          Локальная нейросеть запускается на CPU устройства (Android и ПК) через
          встроенный движок. В обычной веб-версии без нативного клиента эта
          функция недоступна.
        </p>
      </div>
    );
  }

  const selectedModel = status.models.find((m) => m.id === selectedModelId);
  const isReady = choice === "enabled" && Boolean(selectedModel?.installed);

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setErr("");
    setBusyId(key);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="settings-backup ai-settings-card">
      <div className="ai-settings-head">
        <div>
          <h3>Локальный ИИ-помощник</h3>
          <p>
            {isReady
              ? "Установлен и активен: кнопка ✨ доступна в верхнем углу."
              : choice === "disabled"
                ? "Отключён по вашему выбору. Можно включить обратно в любой момент."
                : "Модель скачивается отдельно и работает полностью локально."}
          </p>
        </div>
        {isReady && (
          <button
            type="button"
            className="button secondary small"
            onClick={onOpenChat}
          >
            <Sparkles size={15} />
            Открыть чат
          </button>
        )}
      </div>

      {status.downloadingModelId && (
        <AiInstallProgressBar
          status={status}
          progress={progress}
          onCancel={onCancelInstall}
          compact
        />
      )}

      <div className="ai-settings-models">
        {status.models.map((model) => {
          const isSelected = model.id === selectedModelId;
          const isLoaded = status.loadedModelId === model.id;
          const isDownloadingThis = status.downloadingModelId === model.id;
          return (
            <div
              key={model.id}
              className={`ai-settings-model ${isSelected ? "selected" : ""}`}
            >
              <div className="ai-settings-model-info">
                <div className="ai-model-option-top">
                  <strong>{model.name}</strong>
                  {model.recommended && (
                    <span className="ai-tag recommended">Рекомендуется</span>
                  )}
                  {model.installed && (
                    <span className="ai-tag installed">Установлена</span>
                  )}
                  {isLoaded && <span className="ai-tag loaded">В ОЗУ</span>}
                </div>
                <small>
                  {model.sizeLabel} • {model.ramRequirement}
                  {model.installed
                    ? ` • на диске ${formatBytesRu(model.installedBytes)}`
                    : ""}
                </small>
              </div>

              <div className="ai-settings-model-actions">
                {!model.installed ? (
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={
                      Boolean(status.downloadingModelId) || busyId !== null
                    }
                    onClick={() =>
                      void runAction(`install-${model.id}`, async () => {
                        await onSelectModel(model.id);
                        await onInstall(model.id);
                      })
                    }
                  >
                    <Download size={14} />
                    {isDownloadingThis ? "Скачивается..." : "Установить"}
                  </button>
                ) : (
                  <>
                    {(!isSelected || choice !== "enabled") && (
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={busyId !== null}
                        onClick={() =>
                          void runAction(`activate-${model.id}`, async () => {
                            await onSelectModel(model.id);
                            await onSetChoice("enabled");
                          })
                        }
                      >
                        <Sparkles size={14} />
                        Выбрать
                      </button>
                    )}
                    {isLoaded && (
                      <button
                        type="button"
                        className="button ghost small"
                        disabled={status.generating || busyId !== null}
                        onClick={() =>
                          void runAction("unload", onUnloadModel)
                        }
                      >
                        <Cpu size={14} />
                        Выгрузить из ОЗУ
                      </button>
                    )}
                    <button
                      type="button"
                      className="button ghost danger-text small"
                      disabled={
                        isDownloadingThis || status.generating || busyId !== null
                      }
                      onClick={() =>
                        void runAction(`delete-${model.id}`, () =>
                          onDeleteModel(model.id),
                        )
                      }
                    >
                      <Trash2 size={14} />
                      Удалить
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {choice !== "disabled" ? (
        <button
          type="button"
          className="button ghost full-width"
          disabled={Boolean(status.downloadingModelId) || busyId !== null}
          onClick={() => void runAction("disable", () => onSetChoice("disabled"))}
        >
          Скрыть кнопку ИИ-помощника
        </button>
      ) : (
        <button
          type="button"
          className="button secondary full-width"
          disabled={busyId !== null}
          onClick={() => void runAction("enable", () => onSetChoice("enabled"))}
        >
          <Sparkles size={15} />
          Включить ИИ-помощника обратно
        </button>
      )}

      {err && (
        <p className="ai-inline-error" role="alert">
          <AlertCircle size={15} />
          <span>{err}</span>
        </p>
      )}
    </div>
  );
}

export function AiChatOverlay({
  data,
  month,
  page,
  status,
  messages,
  streamingText,
  generating,
  onSend,
  onStop,
  onClear,
  onToggleContext,
  onClose,
}: {
  data: Data;
  month: string;
  page: Page;
  status: AiStatus;
  messages: AiChatMessage[];
  streamingText: string;
  generating: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => Promise<void>;
  onToggleContext: (include: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [showContextPreview, setShowContextPreview] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startY = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const includeContext = data.preferences.ai.includeContext;
  const activeModel =
    status.models.find((m) => m.id === data.preferences.ai.modelId) ??
    status.models.find((m) => m.installed);
  const quickPrompts = useMemo(() => getQuickPrompts(page), [page]);
  const contextPreview = useMemo(
    () => buildFinancialContext(data, month),
    [data, month],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText, generating]);

  const submitText = async (raw: string) => {
    const clean = raw.trim();
    if (!clean || generating) return;
    setInput("");
    await onSend(clean);
  };

  return (
    <div
      className="ai-overlay-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="ai-chat-sheet glass-floating"
        role="dialog"
        aria-modal="true"
        aria-label="Локальный ИИ финансовый помощник"
        style={
          dragOffset > 0
            ? { transform: `translateY(${dragOffset}px)`, transition: "none" }
            : undefined
        }
      >
        <div
          className="ai-sheet-handle-zone"
          onTouchStart={(e) => {
            startY.current = e.touches[0].clientY;
          }}
          onTouchMove={(e) => {
            if (startY.current === null) return;
            const delta = e.touches[0].clientY - startY.current;
            if (delta > 0) setDragOffset(delta);
          }}
          onTouchEnd={() => {
            if (dragOffset > 90) {
              setDragOffset(0);
              onClose();
            } else {
              setDragOffset(0);
            }
            startY.current = null;
          }}
        >
          <span className="modal-handle" aria-hidden="true" />
        </div>

        <header className="ai-chat-header">
          <div className="ai-chat-title">
            <span className="ai-chat-badge">
              <Sparkles size={17} />
            </span>
            <div>
              <h2>Финансовый ИИ-помощник</h2>
              <small>
                {activeModel?.name ?? "Локальная модель"} • на устройстве
              </small>
            </div>
          </div>
          <div className="ai-chat-head-actions">
            {messages.length > 0 && !generating && (
              <button
                type="button"
                className="icon-button"
                aria-label="Очистить историю чата"
                title="Очистить историю"
                onClick={() => void onClear()}
              >
                <RotateCcw size={17} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть чат"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="ai-context-bar">
          <button
            type="button"
            className={`ai-context-toggle ${includeContext ? "active" : ""}`}
            aria-pressed={includeContext}
            onClick={() => void onToggleContext(!includeContext)}
          >
            {includeContext ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>
              {includeContext ? "Учитывать мои финансы" : "Без данных счёта"}
            </span>
          </button>

          {includeContext && (
            <button
              type="button"
              className="ai-context-inspect"
              aria-expanded={showContextPreview}
              onClick={() => setShowContextPreview((v) => !v)}
            >
              <span>Что видит ИИ</span>
              {showContextPreview ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
          )}
        </div>

        {showContextPreview && includeContext && (
          <pre className="ai-context-preview">{contextPreview}</pre>
        )}

        <div className="ai-messages" ref={scrollRef}>
          {messages.length === 0 && !generating ? (
            <div className="ai-empty-chat">
              <div className="ai-empty-intro">
                <ShieldCheck size={20} />
                <p>
                  Спросите, какие траты уменьшить в этом месяце, как быстрее
                  закрыть цели или куда разумнее направить свободный остаток.
                </p>
              </div>
              <div className="ai-quick-prompts">
                {quickPrompts.map((qp) => (
                  <button
                    key={qp.label}
                    type="button"
                    className="ai-prompt-chip"
                    onClick={() => void submitText(qp.prompt)}
                  >
                    <Sparkles size={13} />
                    <span>{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`ai-msg ${msg.role} ${msg.error ? "is-error" : ""}`}
                >
                  <div className="ai-msg-bubble">
                    <p>{msg.content}</p>
                    {msg.aborted && (
                      <small className="ai-msg-meta">Генерация остановлена</small>
                    )}
                    {msg.error && (
                      <small className="ai-msg-meta">{msg.error}</small>
                    )}
                  </div>
                </div>
              ))}
              {generating && (
                <div className="ai-msg assistant streaming">
                  <div className="ai-msg-bubble">
                    {streamingText ? (
                      <p>
                        {streamingText}
                        <span className="ai-cursor" aria-hidden="true" />
                      </p>
                    ) : (
                      <p className="ai-thinking">
                        <LoaderCircle size={15} className="ai-spin" />
                        <span>
                          {status.loadedModelId
                            ? "Анализирую вопрос..."
                            : "Загружаю модель в память..."}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="ai-chat-footer">
          <div className="ai-disclaimer">
            Локально на устройстве • не является индивидуальной инвестиционной
            рекомендацией (ИИР)
          </div>
          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void submitText(input);
            }}
          >
            <textarea
              rows={1}
              value={input}
              placeholder="Спросите о тратах, бюджете или накоплениях..."
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitText(input);
                }
              }}
            />
            {generating ? (
              <button
                type="button"
                className="button secondary ai-send-btn"
                aria-label="Остановить ответ"
                onClick={() => void onStop()}
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="button primary ai-send-btn"
                aria-label="Отправить"
                disabled={!input.trim()}
              >
                <Send size={16} />
              </button>
            )}
          </form>
        </footer>
      </section>
    </div>
  );
}
