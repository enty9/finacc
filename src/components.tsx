import { DollarAmount, Money, useMoney } from "./currency";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ShoppingBasket,
  Coffee,
  Car,
  ShoppingBag,
  House,
  Sparkles,
  Heart,
  LayoutGrid,
  BriefcaseBusiness,
  Laptop,
  Gift,
  X,
  Plus,
  Check,
  Wallet,
  CalendarDays,
  Palmtree,
  ShieldCheck,
  CreditCard,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import {
  entityBalance,
  formatDate,
  parseMoney,
  type Category,
  type Data,
  type Saving,
  type Debt,
  type Transaction,
} from "./domain";

const icons: Record<string, LucideIcon> = {
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
};
export function CategoryIcon({
  category,
  small = false,
}: {
  category?: Category;
  small?: boolean;
}) {
  const Icon = icons[category?.icon ?? "grid"] ?? LayoutGrid;
  return (
    <span
      className={`category-icon ${small ? "small" : ""}`}
      style={{
        color: category?.color ?? "#60a5fa",
        background: `${category?.color ?? "#60a5fa"}16`,
      }}
    >
      <Icon size={small ? 17 : 21} strokeWidth={1.7} />
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
  return <section className={`glass card ${className}`}>{children}</section>;
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
      {action && (
        <button className="text-button" onClick={onAction}>
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
      {action && (
        <button className="button secondary" onClick={onAction}>
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
  const money = useMoney();
  if (!transactions.length)
    return (
      <Empty
        title="Пока нет операций"
        description="Добавьте доход или расход — здесь появится ваша история."
      />
    );
  return (
    <div className={`transaction-list ${compact ? "compact" : ""}`}>
      {transactions.map((t) => {
        const category = data.categories.find((c) => c.id === t.categoryId);
        return (
          <button
            className="transaction-row"
            onClick={() => onEdit(t)}
            key={t.id}
            aria-label={`Изменить: ${t.title}, ${money(t.amount)}`}
          >
            <CategoryIcon category={category} />
            <span className="transaction-info">
              <strong>{t.title}</strong>
              <span>
                {category?.name}
                <span className="mobile-dot"> · </span>
                <span className="mobile-date">
                  {formatDate(t.date)}
                </span>
              </span>
            </span>
            <span className="transaction-date">
              {formatDate(t.date)}
            </span>
            <span
              className={`transaction-amount ${t.kind === "income" ? "positive" : ""}`}
            >
              {t.kind === "income" ? "+" : "−"} {<Money amount={t.amount} />}
            </span>
            <span className="row-edit">
              <Pencil size={14} />
            </span>
          </button>
        );
      })}
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
  const money = useMoney();
  const amount = entityBalance(data, goal, debt ? "debt" : "saving");
  const target = "target" in goal ? goal.target : goal.initial;
  const progress = debt
    ? target
      ? ((target - amount) / target) * 100
      : 100
    : (amount / target) * 100;
  const Icon = debt
    ? CreditCard
    : /подуш|резерв/i.test(goal.name)
      ? ShieldCheck
      : Palmtree;
  const color = "color" in goal ? goal.color : "#a5c8ff";
  return (
    <div className={`goal-card ${compact ? "compact" : ""}`}>
      <div className="goal-heading">
        <span className="goal-icon" style={{ background: `${color}18`, color }}>
          <Icon size={22} strokeWidth={1.6} />
        </span>
        <div>
          <h3>{goal.name}</h3>
          <p>
            {debt
              ? `До ${new Date(`${(goal as Debt).dueDate}T12:00:00`).toLocaleDateString("ru-RU")}`
              : "Шаг за шагом к мечте"}
          </p>
        </div>
        <span className="goal-percent">{Math.round(progress)}%</span>
      </div>
      <div className="goal-amount">
        <strong>{<Money amount={amount} />}</strong>
        <span>{debt ? "осталось вернуть" : `из ${money(target)}`}</span>
      </div>
      <Progress value={progress} color={color} label={goal.name} />
      {!compact && (
        <button className="button secondary full-width" onClick={onTransfer}>
          <Plus size={16} />
          {debt ? "Платеж или получение" : "Пополнить или снять"}
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
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal glass"
      aria-labelledby="modal-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">ПРОСТО О ФИНАНСАХ</span>
          <h2 id="modal-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
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
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
  zero?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  let amount: number | null = null;
  try {
    amount = parseMoney(value, true);
  } catch {
    /* An unfinished input has no dollar equivalent yet. */
  }
  return (
    <label>
      {label}
      <div className="money-input">
        <input
          name={name}
          inputMode="decimal"
          required
          placeholder={zero ? "0" : "0,00"}
          defaultValue={defaultValue}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
        />
        <span>₽</span>
      </div>
      {amount !== null && <DollarAmount amount={amount} />}
    </label>
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
