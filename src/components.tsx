import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Camera,
  Car,
  Check,
  Coffee,
  CreditCard,
  Delete,
  Dumbbell,
  Gamepad2,
  Gift,
  Heart,
  House,
  Landmark,
  Laptop,
  LayoutGrid,
  LockKeyhole,
  Music,
  Palmtree,
  PawPrint,
  Pencil,
  Plane,
  Plus,
  QrCode,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Trash2,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { DollarAmount, Money, useMoney } from "./currency";
import {
  dateKey,
  entityBalance,
  formatDate,
  money as formatRub,
  parseMoney,
  type Category,
  type CategoryIconId,
  type Data,
  type Debt,
  type Saving,
  type Transaction,
} from "./domain";
import { parseFnsQr, type FnsQrResult } from "./import";
import { verifyPin, type PinLockRecord } from "./crypto";
import { hapticTap } from "./platform";

export const categoryIcons: Record<CategoryIconId, LucideIcon> = {
  basket: ShoppingBasket,
  coffee: Coffee,
  car: Car,
  bag: ShoppingBag,
  home: House,
  sparkles: Sparkles,
  heart: Heart,
  grid: LayoutGrid,
  briefcase: BriefcaseBusiness,
  laptop: Laptop,
  gift: Gift,
  plane: Plane,
  gamepad: Gamepad2,
  music: Music,
  book: BookOpen,
  dumbbell: Dumbbell,
  zap: Zap,
  smartphone: Smartphone,
  shirt: Shirt,
  paw: PawPrint,
};

export function CategoryIcon({
  category,
  iconId,
  color,
  small = false,
}: {
  category?: Category;
  iconId?: string;
  color?: string;
  small?: boolean;
}) {
  const resolvedIcon = iconId ?? category?.icon ?? "grid";
  const Icon =
    categoryIcons[resolvedIcon as CategoryIconId] ?? LayoutGrid;
  const tint = color ?? category?.color ?? "#60a5fa";
  return (
    <span
      className={`category-icon ${small ? "small" : ""}`}
      style={{
        color: tint,
        background: `${tint}1a`,
      }}
    >
      <Icon size={small ? 17 : 20} strokeWidth={1.75} />
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-surface card ${className}`}>{children}</section>
  );
}

export function CardHeading({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="card-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && onAction && (
        <button type="button" className="text-button" onClick={onAction}>
          {action}
          <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
}

export function Empty({
  title,
  description,
  action,
  onAction,
  icon: Icon = Wallet,
}: {
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={28} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && onAction && (
        <button
          type="button"
          className="button secondary"
          onClick={onAction}
        >
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}

export function Progress({
  value,
  color,
  label,
}: {
  value: number;
  color?: string;
  label: string;
}) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: color,
        }}
      />
    </div>
  );
}

export function ConfirmInline({
  label = "Удалить",
  confirmLabel = "Точно?",
  onConfirm,
  iconOnly = false,
  disabled = false,
  ariaLabel,
}: {
  label?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  iconOnly?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled || busy}
        className={
          iconOnly
            ? "icon-button subtle"
            : "button ghost danger-text"
        }
        aria-label={ariaLabel ?? label}
        onClick={() => setArmed(true)}
      >
        <Trash2 size={15} />
        {!iconOnly && <span>{label}</span>}
      </button>
    );
  }

  return (
    <span className="confirm-inline">
      <button
        type="button"
        disabled={busy}
        className="confirm-inline-cancel"
        onClick={() => setArmed(false)}
      >
        Отмена
      </button>
      <button
        type="button"
        disabled={busy}
        className="confirm-inline-yes"
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {confirmLabel}
      </button>
    </span>
  );
}

function formatGroupDate(date: string, today: string): string {
  if (date === today) return "Сегодня";
  const yesterdayDate = new Date(`${today}T12:00:00`);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (date === dateKey(yesterdayDate)) return "Вчера";
  const parsed = new Date(`${date}T12:00:00`);
  const currentYear = today.slice(0, 4);
  return parsed.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.slice(0, 4) !== currentYear ? { year: "numeric" } : {}),
  });
}

export function TransactionList({
  transactions,
  data,
  onEdit,
  compact = false,
}: {
  transactions: Transaction[];
  data: Data;
  onEdit: (transaction: Transaction) => void;
  compact?: boolean;
}) {
  const formatDual = useMoney();
  const today = dateKey();
  const showAccount = data.accounts.length > 1;
  const accountMap = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categoryMap = new Map(data.categories.map((c) => [c.id, c]));

  if (!transactions.length)
    return (
      <Empty
        title="Пока нет операций"
        description="Добавьте доход или расход — здесь появится ваша история."
      />
    );

  const renderRow = (t: Transaction) => {
    const category = categoryMap.get(t.categoryId);
    const accountName = showAccount
      ? accountMap.get(t.accountId ?? data.accounts[0]?.id ?? "main")
      : undefined;
    return (
      <button
        type="button"
        className="transaction-row"
        onClick={() => onEdit(t)}
        key={t.id}
        aria-label={`Изменить: ${t.title}, ${formatDual(t.amount)}`}
      >
        <CategoryIcon category={category} />
        <span className="transaction-info">
          <strong>{t.title}</strong>
          <span className="transaction-meta">
            <span>{category?.name}</span>
            {accountName && (
              <span className="tx-account-badge">{accountName}</span>
            )}
            {compact && (
              <>
                <span className="mobile-dot"> · </span>
                <span className="mobile-date">{formatDate(t.date)}</span>
              </>
            )}
            {t.tags && t.tags.length > 0 && (
              <span className="tx-tags-inline">
                {t.tags.slice(0, 3).map((tag) => (
                  <span className="tx-tag-chip" key={tag}>
                    #{tag}
                  </span>
                ))}
              </span>
            )}
          </span>
        </span>
        {compact && (
          <span className="transaction-date">{formatDate(t.date)}</span>
        )}
        <span
          className={`transaction-amount ${t.kind === "income" ? "positive" : ""}`}
        >
          {t.kind === "income" ? "+" : "−"} <Money amount={t.amount} />
        </span>
        <span className="row-edit">
          <Pencil size={14} />
        </span>
      </button>
    );
  };

  if (compact) {
    return (
      <div className="transaction-list compact">
        {transactions.map(renderRow)}
      </div>
    );
  }

  const groups: { date: string; items: Transaction[] }[] = [];
  for (const t of transactions) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <div className="transaction-list grouped">
      {groups.map((group) => (
        <div className="tx-date-group" key={group.date}>
          <div className="tx-date-header">
            <span>{formatGroupDate(group.date, today)}</span>
            <small>{formatDate(group.date)}</small>
          </div>
          {group.items.map(renderRow)}
        </div>
      ))}
    </div>
  );
}

export function GoalCard({
  goal,
  data,
  onTransfer,
  debt = false,
  compact = false,
}: {
  goal: Saving | Debt;
  data: Data;
  onTransfer: () => void;
  debt?: boolean;
  compact?: boolean;
}) {
  const formatDual = useMoney();
  const isDebt = debt || "dueDate" in goal;
  const direction = isDebt && "direction" in goal ? goal.direction ?? "owe" : "owe";
  const amount = entityBalance(data, goal, isDebt ? "debt" : "saving");
  const target = "target" in goal ? goal.target : goal.initial;
  const progress = isDebt
    ? target
      ? ((target - amount) / target) * 100
      : 100
    : (amount / target) * 100;
  const Icon = isDebt
    ? direction === "owed"
      ? Landmark
      : CreditCard
    : /подуш|резерв/i.test(goal.name)
      ? ShieldCheck
      : Palmtree;
  const color =
    "color" in goal
      ? goal.color
      : direction === "owed"
        ? "var(--receivable)"
        : "#a5c8ff";
  const rateText =
    isDebt && "interestRate" in goal && goal.interestRate
      ? ` · ${goal.interestRate}% год.`
      : "";

  return (
    <div
      className={`goal-card ${compact ? "compact" : ""} ${goal.archived ? "archived" : ""}`}
    >
      <div className="goal-heading">
        <span
          className="goal-icon"
          style={{
            background:
              direction === "owed"
                ? "rgba(167, 139, 250, 0.16)"
                : `${color}1f`,
            color,
          }}
        >
          <Icon size={21} strokeWidth={1.65} />
        </span>
        <div>
          <h3>
            {goal.name}
            {goal.archived && <span className="archived-pill">Архив</span>}
          </h3>
          <p>
            {isDebt
              ? `До ${new Date(`${(goal as Debt).dueDate}T12:00:00`).toLocaleDateString("ru-RU")}${rateText}`
              : "Шаг за шагом к мечте"}
          </p>
        </div>
        <span className="goal-percent">{Math.round(progress)}%</span>
      </div>
      <div className="goal-amount">
        <strong>
          <Money amount={amount} />
        </strong>
        <span>
          {isDebt
            ? direction === "owed"
              ? "должны вернуть"
              : "осталось вернуть"
            : `из ${formatDual(target)}`}
        </span>
      </div>
      <Progress value={progress} color={color} label={goal.name} />
      {!compact && (
        <button
          type="button"
          className="button secondary full-width"
          onClick={onTransfer}
        >
          <Plus size={16} />
          {isDebt
            ? direction === "owed"
              ? "Возврат или одолжить"
              : "Платеж или получение"
            : "Пополнить или снять"}
        </button>
      )}
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const startY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal glass-floating"
      aria-labelledby="modal-title"
      style={
        dragOffset > 0
          ? {
              transform: `translateY(${dragOffset}px)`,
              transition: "none",
            }
          : undefined
      }
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            onClose();
          }
        }
      }}
    >
      <div
        className="modal-drag-zone"
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
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ПРОСТО О ФИНАНСАХ</span>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}

export function SubmitForm({
  children,
  onSubmit,
  label = "Сохранить",
  footer,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  label?: string;
  footer?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError("");
        setBusy(true);
        try {
          await onSubmit(form);
          hapticTap();
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Не удалось сохранить. Попробуйте еще раз.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        {footer}
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? (
            "Сохраняем…"
          ) : (
            <>
              <Check size={17} />
              {label}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

export function MoneyField({
  name = "amount",
  label = "Сумма, ₽",
  defaultValue = "",
  zero = false,
  onValueReady,
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
  zero?: boolean;
  onValueReady?: (raw: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  let amount: number | null = null;
  try {
    amount = parseMoney(value, true);
  } catch {
    /* An unfinished expression has no preview yet. */
  }
  const hasFormula = /[+\-*/×÷−()]/.test(value);

  const appendOp = (op: string) => {
    const next = `${value}${op}`;
    setValue(next);
    onValueReady?.(next);
    inputRef.current?.focus();
  };

  return (
    <div className="money-field-wrap">
      <label>
        {label}
        <div className="money-input">
          <input
            ref={inputRef}
            name={name}
            inputMode="decimal"
            required
            placeholder={zero ? "0" : "0,00 или 450+180"}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              onValueReady?.(event.target.value);
            }}
            autoComplete="off"
          />
          <span>₽</span>
        </div>
        <div className="calc-preview-row">
          {hasFormula && amount !== null && (
            <span className="calc-result">= {formatRub(amount)}</span>
          )}
          {amount !== null && <DollarAmount amount={amount} />}
        </div>
      </label>
      <div className="calc-ops" aria-label="Быстрый калькулятор">
        {[
          ["+", "+"],
          ["−", "-"],
          ["×", "*"],
          ["÷", "/"],
        ].map(([display, op]) => (
          <button
            type="button"
            key={op}
            className="calc-op-btn"
            onClick={() => appendOp(op)}
          >
            {display}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReminderIcon({ type }: { type: string }) {
  const Icon =
    type === "credit"
      ? CreditCard
      : type === "saving"
        ? ShieldCheck
        : CalendarDays;
  return (
    <span className={`reminder-icon ${type}`}>
      <Icon size={19} strokeWidth={1.6} />
    </span>
  );
}

export function FlowIcon({ kind }: { kind: "income" | "expense" }) {
  return (
    <span className={`flow-icon ${kind}`}>
      {kind === "income" ? (
        <ArrowDownLeft size={19} />
      ) : (
        <ArrowUpRight size={19} />
      )}
    </span>
  );
}

export function PinLockScreen({
  lockRecord,
  onUnlock,
}: {
  lockRecord: PinLockRecord;
  onUnlock: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const lockedSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  async function submitPin(candidate: string) {
    if (lockedSeconds > 0 || candidate.length < 4) return;
    const ok = await verifyPin(candidate, lockRecord);
    if (ok) {
      hapticTap();
      onUnlock();
      return;
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setPin("");
    if (nextAttempts >= 5) {
      setCooldownUntil(Date.now() + 15_000);
      setNow(Date.now());
      setAttempts(0);
      setError("Слишком много попыток. Подождите 15 секунд.");
    } else {
      setError("Неверный PIN-код.");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) {
        setError("");
        setPin((prev) => (prev.length < 8 ? prev + e.key : prev));
      } else if (e.key === "Backspace") {
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Enter") {
        void submitPin(pin);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pin-screen">
      <div className="pin-card glass-floating">
        <span className="pin-badge">
          <LockKeyhole size={26} />
        </span>
        <h1>finacc защищен</h1>
        <p>
          {lockedSeconds > 0
            ? `Повторите через ${lockedSeconds} сек.`
            : "Введите PIN-код для доступа к финансам"}
        </p>
        <div className="pin-dots" aria-label={`Введено цифр: ${pin.length}`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span
              key={i}
              className={`pin-dot ${i < pin.length ? "filled" : ""}`}
            />
          ))}
        </div>
        {error && <p className="pin-error">{error}</p>}
        <div className="pin-keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button
              type="button"
              key={digit}
              className="pin-key"
              disabled={lockedSeconds > 0}
              onClick={() => {
                setError("");
                hapticTap();
                setPin((prev) => (prev.length < 8 ? prev + digit : prev));
              }}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="pin-key secondary"
            aria-label="Стереть цифру"
            disabled={!pin.length}
            onClick={() => setPin((prev) => prev.slice(0, -1))}
          >
            <Delete size={20} />
          </button>
          <button
            type="button"
            className="pin-key"
            disabled={lockedSeconds > 0}
            onClick={() => {
              setError("");
              hapticTap();
              setPin((prev) => (prev.length < 8 ? prev + "0" : prev));
            }}
          >
            0
          </button>
          <button
            type="button"
            className="pin-key confirm"
            aria-label="Войти"
            disabled={pin.length < 4 || lockedSeconds > 0}
            onClick={() => void submitPin(pin)}
          >
            <Check size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue?: string }[]>;
}

export function QrScannerModal({
  onApply,
  onClose,
}: {
  onApply: (result: FnsQrResult) => void;
  onClose: () => void;
}) {
  const [rawText, setRawText] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!cameraActive) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let rafId = 0;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Камера недоступна в этом окружении.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = (
          window as unknown as {
            BarcodeDetector?: new (opts: {
              formats: string[];
            }) => BarcodeDetectorLike;
          }
        ).BarcodeDetector;
        if (!Detector) {
          setCameraError(
            "Встроенное распознавание QR не поддерживается WebView. Вставьте текст чека ниже.",
          );
          return;
        }
        const detector = new Detector({ formats: ["qr_code"] });
        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const payload = codes[0]?.rawValue;
            if (payload) {
              setRawText(payload);
              const parsed = parseFnsQr(payload);
              if (parsed) {
                hapticTap();
                onApply(parsed);
                return;
              }
            }
          } catch {
            /* Keep scanning frame by frame. */
          }
          rafId = window.setTimeout(scan, 350);
        };
        rafId = window.setTimeout(scan, 350);
      } catch (e) {
        if (!cancelled) {
          setCameraError(
            e instanceof Error
              ? e.message
              : "Не удалось открыть камеру.",
          );
          setCameraActive(false);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraActive, onApply]);

  const parsed = parseFnsQr(rawText);

  return (
    <Modal
      title="Чек по QR-коду ФНС"
      description="Наведите камеру на QR-код кассового чека или вставьте его строку."
      onClose={onClose}
    >
      <div className="qr-scanner-body">
        {cameraActive ? (
          <div className="qr-video-box">
            <video ref={videoRef} playsInline muted />
            <button
              type="button"
              className="button secondary full-width"
              onClick={() => setCameraActive(false)}
            >
              Остановить камеру
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="button secondary full-width"
            onClick={() => {
              setCameraError("");
              setCameraActive(true);
            }}
          >
            <Camera size={16} />
            Включить камеру для сканирования
          </button>
        )}
        {cameraError && <p className="form-hint">{cameraError}</p>}
        <label className="qr-text-label">
          Строка QR-кода чека
          <textarea
            rows={3}
            value={rawText}
            placeholder="t=20261124T1435&s=1245.50&fn=...&i=...&fp=..."
            onChange={(e) => setRawText(e.target.value)}
          />
        </label>
        {parsed ? (
          <div className="qr-preview glass-surface">
            <QrCode size={18} />
            <div>
              <strong>{formatRub(parsed.amount)}</strong>
              <span>
                {formatDate(parsed.date)} · {parsed.note}
              </span>
            </div>
          </div>
        ) : (
          rawText.trim().length > 0 && (
            <p className="form-error">
              Не удалось распознать формат чека ФНС (`t=...&s=...`).
            </p>
          )
        )}
        <div className="form-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!parsed}
            onClick={() => parsed && onApply(parsed)}
          >
            <Check size={16} />
            Подставить в операцию
          </button>
        </div>
      </div>
    </Modal>
  );
}
