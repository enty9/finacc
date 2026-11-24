import {
  dualMoney,
  formatCurrency,
  rateForCurrency,
  type ExchangeRates,
  type SecondaryCurrency,
} from "./exchange.ts";

export type Kind = "income" | "expense";
export type Page =
  | "overview"
  | "transactions"
  | "budget"
  | "goals"
  | "reports"
  | "reminders";
export type AccountType = "card" | "cash" | "credit" | "savings";
export type DebtDirection = "owe" | "owed";
export type Recurrence = "none" | "weekly" | "monthly" | "yearly";
export type ThemeMode = "glass" | "oled" | "light";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalance: number;
  color: string;
  archived?: boolean;
}

export interface AccountTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  note: string;
  createdAt?: number;
}

export interface Category {
  id: string;
  name: string;
  kind: Kind;
  color: string;
  icon: string;
}

export interface Transaction {
  id: string;
  kind: Kind;
  amount: number;
  title: string;
  categoryId: string;
  date: string;
  note: string;
  accountId?: string;
  tags?: string[];
  createdAt?: number;
}

export interface Saving {
  id: string;
  name: string;
  target: number;
  initial: number;
  startDate: string;
  color: string;
  archived?: boolean;
  icon?: string;
}

export interface Debt {
  id: string;
  name: string;
  initial: number;
  startDate: string;
  dueDate: string;
  direction?: DebtDirection;
  interestRate?: number;
  archived?: boolean;
}

export interface Movement {
  id: string;
  entityId: string;
  entityType: "saving" | "debt";
  amount: number;
  date: string;
  accountId?: string;
  note?: string;
  createdAt?: number;
}

export interface Reminder {
  id: string;
  title: string;
  amount: number;
  date: string;
  time: string;
  type: "bill" | "credit" | "saving";
  done: boolean;
  recurrence?: Recurrence;
  categoryId?: string;
  entityId?: string;
  accountId?: string;
}

export interface InsightThresholds {
  growthPercent: number;
  growthMinAmount: number;
  largeMinAmount: number;
}

export type AiChoice = "undecided" | "enabled" | "disabled";

export type AiModelId = "qwen2.5-3b" | "qwen2.5-1.5b";

export interface AiPreferences {
  choice: AiChoice;
  modelId: AiModelId;
  includeContext: boolean;
}

export interface Preferences {
  theme: ThemeMode;
  secondaryCurrency: SecondaryCurrency;
  paydayDay: number;
  hideBalancesOnStart: boolean;
  insightThresholds: InsightThresholds;
  dismissedInsights: string[];
  ai: AiPreferences;
}

export interface Data {
  version: 2;
  demo: boolean;
  name: string;
  openingBalance: number;
  notifications: boolean;
  accounts: Account[];
  transfers: AccountTransfer[];
  categories: Category[];
  transactions: Transaction[];
  savings: Saving[];
  debts: Debt[];
  movements: Movement[];
  reminders: Reminder[];
  limits: Record<string, number>;
  preferences: Preferences;
}

export const palette = [
  "#60a5fa",
  "#34d399",
  "#fb7185",
  "#fbbf24",
  "#a78bfa",
  "#38bdf8",
  "#f97316",
  "#94a3b8",
];

export const categoryIconIds = [
  "basket",
  "coffee",
  "car",
  "bag",
  "home",
  "sparkles",
  "heart",
  "grid",
  "briefcase",
  "laptop",
  "gift",
  "plane",
  "gamepad",
  "music",
  "book",
  "dumbbell",
  "zap",
  "smartphone",
  "shirt",
  "paw",
] as const;

export type CategoryIconId = (typeof categoryIconIds)[number];

export const uid = () => crypto.randomUUID();

const ruPlural = new Intl.PluralRules("ru-RU");
export function pluralRu(
  count: number,
  forms: [string, string, string],
): string {
  const category = ruPlural.select(Math.abs(count));
  if (category === "one") return forms[0];
  if (category === "few") return forms[1];
  return forms[2];
}

export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function tomorrowKey(now = new Date()): string {
  return dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export const formatDate = (date: string) => date.split("-").reverse().join(".");
export const monthKey = (date = new Date()) => dateKey(date).slice(0, 7);

export function shiftMonth(month: string, offset: number) {
  return monthKey(
    new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1 + offset,
      1,
    ),
  );
}

export function currentPeriodMonth(paydayDay = 1, now = new Date()): string {
  const day = Math.max(1, Math.min(28, Math.trunc(paydayDay) || 1));
  if (day <= 1 || now.getDate() >= day) return monthKey(now);
  return shiftMonth(monthKey(now), -1);
}

export const monthName = (month: string, short = false) =>
  new Date(`${month}-15T12:00:00`)
    .toLocaleDateString("ru-RU", {
      month: short ? "short" : "long",
      ...(short ? {} : { year: "numeric" }),
    })
    .replace(" г.", "");

export const money = (amount: number, decimals = false) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: amount % 100 ? 2 : 0,
  }).format(amount / 100);

export const inputMoney = (amount: number) => String(amount / 100);

export function evaluateMoneyExpression(
  value: string,
  zero = false,
): number {
  const cleaned = value
    .trim()
    .replace(/\s+/g, "")
    .replaceAll(",", ".")
    .replaceAll("−", "-")
    .replaceAll("×", "*")
    .replaceAll("÷", "/");

  if (!cleaned)
    throw new Error("Введите сумму в рублях.");

  const hasOperator = /[+\-*/()]/.test(cleaned);
  if (!hasOperator) {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(cleaned))
      throw new Error(
        "Введите сумму в рублях, не более двух знаков после запятой.",
      );
    const [whole, fraction = ""] = cleaned.split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (amount > 100_000_000_000 || (!zero && amount === 0))
      throw new Error(
        "Сумма должна быть больше нуля и не превышать 1 млрд ₽.",
      );
    return amount;
  }

  let index = 0;
  const peek = () => cleaned[index] ?? "";

  function parseNumber(): number {
    const start = index;
    let dots = 0;
    while (index < cleaned.length) {
      const ch = cleaned[index];
      if (ch >= "0" && ch <= "9") {
        index++;
      } else if (ch === "." && dots === 0) {
        dots++;
        index++;
      } else {
        break;
      }
    }
    const raw = cleaned.slice(start, index);
    if (!raw || raw === ".")
      throw new Error("Проверьте выражение для суммы.");
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
      throw new Error("Проверьте выражение для суммы.");
    return parsed;
  }

  function parseFactor(): number {
    if (peek() === "+") {
      index++;
      return parseFactor();
    }
    if (peek() === "-") {
      index++;
      return -parseFactor();
    }
    if (peek() === "(") {
      index++;
      const inner = parseExpression();
      if (peek() !== ")")
        throw new Error("Проверьте скобки в выражении.");
      index++;
      return inner;
    }
    return parseNumber();
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = cleaned[index++];
      const right = parseFactor();
      if (op === "*") {
        left *= right;
      } else {
        if (Math.abs(right) < 1e-12)
          throw new Error("Нельзя делить на ноль.");
        left /= right;
      }
    }
    return left;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = cleaned[index++];
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const result = parseExpression();
  if (index !== cleaned.length || !Number.isFinite(result))
    throw new Error("Проверьте выражение для суммы.");

  const amount = Math.round(result * 100);
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > 100_000_000_000 ||
    (!zero && amount === 0)
  )
    throw new Error(
      "Сумма должна быть больше нуля и не превышать 1 млрд ₽.",
    );
  return amount;
}

export function parseMoney(value: string, zero = false): number {
  return evaluateMoneyExpression(value, zero);
}

export function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "2199-12-31"
  )
    return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
}

export function parseTransactionDate(value: string): string {
  const text = value.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : text.split(".").reverse().join("-");
  if (
    (!/^\d{2}\.\d{2}\.\d{4}$/.test(text) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(text)) ||
    !validDate(date)
  )
    throw new Error("Введите дату операции в формате ДД.ММ.ГГГГ.");
  if (date > dateKey())
    throw new Error("Дата операции не может быть в будущем.");
  return date;
}

function daysInMonth(year: number, monthZeroBased: number): number {
  return new Date(year, monthZeroBased + 1, 0).getDate();
}

export function periodBounds(
  period: string,
  paydayDay = 1,
): { start: string; end: string; label: string } {
  if (period.length === 4) {
    return {
      start: `${period}-01-01`,
      end: `${period}-12-31`,
      label: `${period} год`,
    };
  }
  const year = Number(period.slice(0, 4));
  const monthZero = Number(period.slice(5, 7)) - 1;
  const day = Math.max(1, Math.min(28, Math.trunc(paydayDay) || 1));

  if (day <= 1) {
    const start = `${period}-01`;
    const end = dateKey(new Date(year, monthZero + 1, 0));
    return { start, end, label: monthName(period) };
  }

  const startDay = Math.min(day, daysInMonth(year, monthZero));
  const startDate = new Date(year, monthZero, startDay);
  const nextMonthZero = monthZero === 11 ? 0 : monthZero + 1;
  const nextYear = monthZero === 11 ? year + 1 : year;
  const nextPayday = Math.min(day, daysInMonth(nextYear, nextMonthZero));
  const endDate = new Date(nextYear, nextMonthZero, nextPayday - 1);
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  return {
    start,
    end,
    label: `${formatDate(start).slice(0, 5)} – ${formatDate(end).slice(0, 5)}`,
  };
}

export function totals(transactions: Transaction[]) {
  return transactions.reduce(
    (sum, t) => {
      sum[t.kind] += t.amount;
      return sum;
    },
    { income: 0, expense: 0 },
  );
}

export function periodTransactions(data: Data, period: string) {
  const { start, end } = periodBounds(period, data.preferences.paydayDay);
  return data.transactions.filter((t) => t.date >= start && t.date <= end);
}

export function categoryTotals(data: Data, period: string) {
  const expenses = periodTransactions(data, period).filter(
    (t) => t.kind === "expense",
  );
  const sums = new Map<string, number>();
  for (const t of expenses) {
    sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount);
  }
  return data.categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      ...c,
      amount: sums.get(c.id) ?? 0,
      limit: data.limits[c.id] ?? 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function entityBalance(
  data: Data,
  entity: Saving | Debt,
  type: "saving" | "debt",
  until = "2199-12-31",
) {
  if (entity.startDate > until) return 0;
  const change = data.movements
    .filter(
      (m) =>
        m.entityId === entity.id && m.entityType === type && m.date <= until,
    )
    .reduce((sum, m) => sum + m.amount, 0);
  return entity.initial + (type === "saving" ? change : -change);
}

function movementCashDelta(
  movement: Movement,
  owedDebtIds: Set<string>,
): number {
  if (movement.entityType === "debt" && owedDebtIds.has(movement.entityId)) {
    return movement.amount;
  }
  return -movement.amount;
}

export function accountBalance(
  data: Data,
  accountId: string,
  until = "2199-12-31",
): number {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return 0;
  const defaultAccountId = data.accounts[0]?.id ?? "main";
  const owedDebtIds = new Set(
    data.debts.filter((d) => d.direction === "owed").map((d) => d.id),
  );

  let balance = account.initialBalance;
  for (const t of data.transactions) {
    if (t.date <= until && (t.accountId ?? defaultAccountId) === accountId) {
      balance += t.kind === "income" ? t.amount : -t.amount;
    }
  }
  for (const tr of data.transfers) {
    if (tr.date <= until) {
      if (tr.toAccountId === accountId) balance += tr.amount;
      if (tr.fromAccountId === accountId) balance -= tr.amount;
    }
  }
  for (const m of data.movements) {
    if (m.date <= until && (m.accountId ?? defaultAccountId) === accountId) {
      balance += movementCashDelta(m, owedDebtIds);
    }
  }
  return balance;
}

export function balances(data: Data, until = "2199-12-31") {
  const flow = totals(data.transactions.filter((t) => t.date <= until));
  const owedDebtIds = new Set(
    data.debts.filter((d) => d.direction === "owed").map((d) => d.id),
  );
  const cashAdjust = data.movements
    .filter((m) => m.date <= until)
    .reduce((sum, m) => sum + movementCashDelta(m, owedDebtIds), 0);

  const opening = data.accounts.length
    ? data.accounts.reduce((s, a) => s + a.initialBalance, 0)
    : data.openingBalance;
  const rawCash = opening + flow.income - flow.expense + cashAdjust;
  const overdraft = Math.max(0, -rawCash);

  let debt = overdraft;
  let receivable = 0;
  for (const d of data.debts) {
    const b = entityBalance(data, d, "debt", until);
    if (d.direction === "owed") receivable += b;
    else debt += b;
  }

  return {
    cash: Math.max(0, rawCash),
    overdraft,
    saved: data.savings.reduce(
      (sum, s) => sum + entityBalance(data, s, "saving", until),
      0,
    ),
    debt,
    receivable,
  };
}

export const periodEnd = (period: string, paydayDay = 1) =>
  periodBounds(period, paydayDay).end;

export function previousPeriod(period: string) {
  return period.length === 4
    ? String(Number(period) - 1)
    : shiftMonth(period, -1);
}

export function changePercent(
  current: number,
  previous: number,
): number | null {
  return previous > 0
    ? Math.round(((current - previous) / previous) * 100)
    : null;
}

export interface SafeToSpendResult {
  dailySafe: number;
  daysLeft: number;
  totalDays: number;
  elapsedDays: number;
  spent: number;
  remainingPool: number;
  upcomingBills: number;
  projectedExpense: number;
  source: "budget" | "balance";
}

export function safeToSpend(
  data: Data,
  month: string,
  today = dateKey(),
): SafeToSpendResult {
  const { start, end } = periodBounds(month, data.preferences.paydayDay);
  const startMs = new Date(`${start}T12:00:00`).getTime();
  const endMs = new Date(`${end}T12:00:00`).getTime();
  const todayMs = new Date(`${today}T12:00:00`).getTime();
  const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

  let elapsedDays: number;
  let daysLeft: number;
  if (today < start) {
    elapsedDays = 0;
    daysLeft = totalDays;
  } else if (today > end) {
    elapsedDays = totalDays;
    daysLeft = 0;
  } else {
    elapsedDays = Math.round((todayMs - startMs) / 86400000) + 1;
    daysLeft = Math.max(1, Math.round((endMs - todayMs) / 86400000) + 1);
  }

  const spent = totals(periodTransactions(data, month)).expense;
  const budgetTotal = Object.values(data.limits).reduce((s, n) => s + n, 0);
  const windowStart = today > start ? today : start;
  const upcomingBills = data.reminders
    .filter((r) => !r.done && r.date >= windowStart && r.date <= end)
    .reduce((s, r) => s + r.amount, 0);

  const source = budgetTotal > 0 ? "budget" : "balance";
  const currentCash = balances(data).cash;
  const remainingPool =
    source === "budget"
      ? Math.max(0, budgetTotal - spent)
      : Math.max(0, currentCash - upcomingBills);
  const dailySafe = daysLeft > 0 ? Math.floor(remainingPool / daysLeft) : 0;
  const projectedExpense =
    elapsedDays > 0 ? Math.round((spent / elapsedDays) * totalDays) : 0;

  return {
    dailySafe,
    daysLeft,
    totalDays,
    elapsedDays,
    spent,
    remainingPool,
    upcomingBills,
    projectedExpense,
    source,
  };
}

export function nextRecurrenceDate(
  date: string,
  recurrence: Recurrence = "none",
): string {
  if (recurrence === "none") return date;
  const year = Number(date.slice(0, 4));
  const monthZero = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));

  if (recurrence === "weekly") {
    return dateKey(new Date(year, monthZero, day + 7));
  }
  if (recurrence === "monthly") {
    const nextMonthZero = monthZero === 11 ? 0 : monthZero + 1;
    const nextYear = monthZero === 11 ? year + 1 : year;
    const clampedDay = Math.min(day, daysInMonth(nextYear, nextMonthZero));
    return dateKey(new Date(nextYear, nextMonthZero, clampedDay));
  }
  const nextYear = year + 1;
  const clampedDay = Math.min(day, daysInMonth(nextYear, monthZero));
  return dateKey(new Date(nextYear, monthZero, clampedDay));
}

export function payReminder(
  data: Data,
  reminder: Reminder,
  options?: {
    date?: string;
    accountId?: string;
    categoryId?: string;
    entityId?: string;
  },
): Data {
  const payDate = options?.date ?? dateKey();
  if (!validDate(payDate) || payDate > dateKey()) {
    throw new Error("Дата платежа не может быть в будущем.");
  }
  const accountId =
    options?.accountId ??
    reminder.accountId ??
    data.accounts.find((a) => !a.archived)?.id ??
    data.accounts[0]?.id ??
    "main";
  const categoryId =
    options?.categoryId ??
    reminder.categoryId ??
    data.categories.find((c) => c.kind === "expense" && c.id === "home")?.id ??
    data.categories.find((c) => c.kind === "expense")?.id ??
    "other";
  const entityId = options?.entityId ?? reminder.entityId;

  let transactions = data.transactions;
  let movements = data.movements;

  if (reminder.amount > 0) {
    if (reminder.type === "bill") {
      transactions = [
        ...data.transactions,
        {
          id: uid(),
          kind: "expense",
          amount: reminder.amount,
          title: reminder.title,
          categoryId,
          date: payDate,
          note: "Оплачено из напоминания",
          accountId,
          createdAt: Date.now(),
        },
      ];
    } else {
      const entityType = reminder.type === "credit" ? "debt" : "saving";
      const entity =
        entityType === "debt"
          ? data.debts.find((d) => d.id === entityId && d.direction !== "owed")
          : data.savings.find((s) => s.id === entityId);

      if (entity) {
        if (payDate < entity.startDate) {
          throw new Error(
            "Дата платежа раньше даты создания цели или долга.",
          );
        }
        if (entityType === "debt") {
          const left = entityBalance(data, entity, "debt");
          if (reminder.amount > left) {
            throw new Error(
              "Сумма напоминания больше текущего остатка долга.",
            );
          }
        }
        movements = [
          ...data.movements,
          {
            id: uid(),
            entityId: entity.id,
            entityType,
            amount: reminder.amount,
            date: payDate,
            accountId,
            note: "По напоминанию",
            createdAt: Date.now(),
          },
        ];
      } else {
        transactions = [
          ...data.transactions,
          {
            id: uid(),
            kind: "expense",
            amount: reminder.amount,
            title: reminder.title,
            categoryId,
            date: payDate,
            note: "Оплачено из напоминания",
            accountId,
            createdAt: Date.now(),
          },
        ];
      }
    }
  }

  const recurrence = reminder.recurrence ?? "none";
  const reminders = data.reminders.map((r) => {
    if (r.id !== reminder.id) return r;
    if (recurrence !== "none") {
      return {
        ...r,
        date: nextRecurrenceDate(r.date, recurrence),
        done: false,
      };
    }
    return { ...r, done: true };
  });

  return {
    ...data,
    transactions,
    movements,
    reminders,
  };
}

export function deleteCategorySafe(data: Data, categoryId: string): Data {
  const target = data.categories.find((c) => c.id === categoryId);
  if (!target) return data;
  const remaining = data.categories.filter(
    (c) => c.kind === target.kind && c.id !== categoryId,
  );
  if (remaining.length === 0) {
    throw new Error("Должна остаться хотя бы одна категория этого типа.");
  }
  const fallback =
    remaining.find(
      (c) => c.id === (target.kind === "expense" ? "other" : "gift"),
    ) ?? remaining[0];
  const nextLimits = { ...data.limits };
  delete nextLimits[categoryId];

  return {
    ...data,
    categories: data.categories.filter((c) => c.id !== categoryId),
    transactions: data.transactions.map((t) =>
      t.categoryId === categoryId ? { ...t, categoryId: fallback.id } : t,
    ),
    reminders: data.reminders.map((r) =>
      r.categoryId === categoryId ? { ...r, categoryId: fallback.id } : r,
    ),
    limits: nextLimits,
  };
}

export function deleteEntitySafe(
  data: Data,
  entityId: string,
  entityType: "saving" | "debt",
): Data {
  return {
    ...data,
    savings:
      entityType === "saving"
        ? data.savings.filter((s) => s.id !== entityId)
        : data.savings,
    debts:
      entityType === "debt"
        ? data.debts.filter((d) => d.id !== entityId)
        : data.debts,
    movements: data.movements.filter(
      (m) => !(m.entityId === entityId && m.entityType === entityType),
    ),
    reminders: data.reminders.map((r) =>
      r.entityId === entityId ? { ...r, entityId: undefined } : r,
    ),
  };
}

export function deleteAccountSafe(data: Data, accountId: string): Data {
  const target = data.accounts.find((a) => a.id === accountId);
  if (!target) return data;
  const others = data.accounts.filter((a) => a.id !== accountId);
  if (others.length === 0) {
    throw new Error("Должен остаться хотя бы один счет.");
  }
  const fallback = others.find((a) => !a.archived) ?? others[0];

  const accounts = others.map((a) =>
    a.id === fallback.id
      ? { ...a, initialBalance: a.initialBalance + target.initialBalance }
      : a,
  );
  const transfers = data.transfers
    .map((tr) => ({
      ...tr,
      fromAccountId:
        tr.fromAccountId === accountId ? fallback.id : tr.fromAccountId,
      toAccountId: tr.toAccountId === accountId ? fallback.id : tr.toAccountId,
    }))
    .filter((tr) => tr.fromAccountId !== tr.toAccountId);

  return {
    ...data,
    accounts,
    transfers,
    transactions: data.transactions.map((t) =>
      t.accountId === accountId ? { ...t, accountId: fallback.id } : t,
    ),
    movements: data.movements.map((m) =>
      m.accountId === accountId ? { ...m, accountId: fallback.id } : m,
    ),
    reminders: data.reminders.map((r) =>
      r.accountId === accountId ? { ...r, accountId: fallback.id } : r,
    ),
  };
}

export interface FrequentTemplate {
  key: string;
  kind: Kind;
  title: string;
  categoryId: string;
  amount: number;
  accountId?: string;
  count: number;
}

export function frequentTemplates(
  data: Data,
  limit = 5,
): FrequentTemplate[] {
  const groups = new Map<string, FrequentTemplate & { lastDate: string }>();
  for (const t of data.transactions) {
    const cleanTitle = t.title.trim();
    const key = `${t.kind}|${cleanTitle.toLocaleLowerCase("ru")}|${t.categoryId}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        kind: t.kind,
        title: cleanTitle,
        categoryId: t.categoryId,
        amount: t.amount,
        accountId: t.accountId,
        count: 1,
        lastDate: t.date,
      });
    } else {
      existing.count += 1;
      if (t.date >= existing.lastDate) {
        existing.lastDate = t.date;
        existing.amount = t.amount;
        existing.title = cleanTitle;
        existing.accountId = t.accountId;
      }
    }
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        b.count - a.count || b.lastDate.localeCompare(a.lastDate),
    )
    .slice(0, limit)
    .map(({ lastDate: _, ...item }) => item);
}

export interface Insight {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "info";
  page: Page;
}

export function insights(
  data: Data,
  period: string,
  formatMoney: (amount: number) => string = money,
  annual = false,
): Insight[] {
  const result: Insight[] = [];
  const thresholds = data.preferences.insightThresholds;
  const dismissed = new Set(data.preferences.dismissedInsights);
  const categories = categoryTotals(data, period);

  if (!annual) {
    for (const c of categories) {
      if (c.limit && c.amount >= c.limit * 0.8) {
        result.push({
          id: `limit-${period}-${c.id}`,
          title:
            c.amount > c.limit
              ? `Лимит «${c.name}» превышен`
              : c.amount === c.limit
                ? `Лимит «${c.name}» достигнут`
                : `Лимит «${c.name}» близко`,
          description:
            c.amount > c.limit
              ? `На ${formatMoney(c.amount - c.limit)} больше плана. Можно пересмотреть бюджет.`
              : c.amount === c.limit
                ? "Бюджет категории полностью использован."
                : `Использовано ${Math.round((c.amount / c.limit) * 100)}% бюджета. Осталось ${formatMoney(c.limit - c.amount)}.`,
          severity: "warning",
          page: "budget",
        });
      }
    }
  }

  const { start, end } = periodBounds(period, data.preferences.paydayDay);
  const expenses = data.transactions
    .filter((t) => t.kind === "expense")
    .sort((a, b) => a.date.localeCompare(b.date));

  const last = new Map<string, Transaction>();
  const duplicateKeys = new Set<string>();
  for (const t of expenses) {
    const key = `${t.amount}|${t.title.trim().toLocaleLowerCase("ru")}|${t.categoryId}`;
    const prior = last.get(key);
    if (
      t.date >= start &&
      t.date <= end &&
      prior &&
      new Date(`${t.date}T12:00:00`).getTime() -
        new Date(`${prior.date}T12:00:00`).getTime() <=
        48 * 60 * 60 * 1000 &&
      !duplicateKeys.has(key)
    ) {
      duplicateKeys.add(key);
      result.push({
        id: `duplicate-${t.id}`,
        title: "Возможное повторное списание",
        description: `«${t.title}» — ${formatMoney(t.amount)} дважды за 48 часов. Проверьте операции.`,
        severity: "warning",
        page: "transactions",
      });
    }
    last.set(key, t);
  }

  const previous = categoryTotals(data, previousPeriod(period));
  const priorById = new Map(previous.map((p) => [p.id, p.amount]));
  for (const c of categories) {
    const before = priorById.get(c.id) ?? 0;
    const growthMultiplier = 1 + thresholds.growthPercent / 100;
    if (
      before > 0 &&
      c.amount >= before * growthMultiplier &&
      c.amount - before >= thresholds.growthMinAmount
    ) {
      result.push({
        id: `growth-${period}-${c.id}`,
        title: `Больше расходов: ${c.name.toLocaleLowerCase("ru")}`,
        description: `Рост на ${changePercent(c.amount, before)}% к прошлому ${annual ? "году" : "месяцу"}: ${formatMoney(c.amount)} вместо ${formatMoney(before)}.`,
        severity: "info",
        page: "reports",
      });
    }
  }

  const periodExpenses = expenses.filter(
    (t) => t.date >= start && t.date <= end,
  );
  const past = expenses.filter((t) => t.date < start);
  const average = past.length
    ? past.reduce((sum, t) => sum + t.amount, 0) / past.length
    : 0;
  const threshold = Math.max(thresholds.largeMinAmount, average * 3);
  const large = periodExpenses.filter((t) => t.amount >= threshold);
  if (large.length) {
    const biggest = [...large].sort((a, b) => b.amount - a.amount)[0];
    const word = pluralRu(large.length, ["операция", "операции", "операций"]);
    result.push({
      id: `large-${period}`,
      title: "Крупные платежи",
      description: `${large.length} ${word} от ${formatMoney(Math.max(thresholds.largeMinAmount, Math.ceil((average * 3) / 100) * 100))}. Самый крупный платеж: «${biggest.title}».`,
      severity: "info",
      page: "transactions",
    });
  }

  return result.filter((i) => !dismissed.has(i.id));
}

const defaultCategories: Category[] = [
  {
    id: "food",
    name: "Продукты",
    kind: "expense",
    color: palette[0],
    icon: "basket",
  },
  {
    id: "cafe",
    name: "Кафе и рестораны",
    kind: "expense",
    color: palette[2],
    icon: "coffee",
  },
  {
    id: "transport",
    name: "Транспорт",
    kind: "expense",
    color: palette[4],
    icon: "car",
  },
  {
    id: "shopping",
    name: "Покупки",
    kind: "expense",
    color: palette[5],
    icon: "bag",
  },
  {
    id: "home",
    name: "Дом и счета",
    kind: "expense",
    color: palette[1],
    icon: "home",
  },
  {
    id: "fun",
    name: "Отдых",
    kind: "expense",
    color: palette[3],
    icon: "sparkles",
  },
  {
    id: "health",
    name: "Здоровье",
    kind: "expense",
    color: palette[6],
    icon: "heart",
  },
  {
    id: "other",
    name: "Другое",
    kind: "expense",
    color: palette[7],
    icon: "grid",
  },
  {
    id: "salary",
    name: "Зарплата",
    kind: "income",
    color: palette[1],
    icon: "briefcase",
  },
  {
    id: "freelance",
    name: "Подработка",
    kind: "income",
    color: palette[5],
    icon: "laptop",
  },
  {
    id: "gift",
    name: "Подарки и другое",
    kind: "income",
    color: palette[4],
    icon: "gift",
  },
];

export function defaultPreferences(): Preferences {
  return {
    theme: "glass",
    secondaryCurrency: "USD",
    paydayDay: 1,
    hideBalancesOnStart: false,
    insightThresholds: {
      growthPercent: 50,
      growthMinAmount: 300_000,
      largeMinAmount: 1_000_000,
    },
    dismissedInsights: [],
    ai: {
      choice: "undecided",
      modelId: "qwen2.5-3b",
      includeContext: true,
    },
  };
}

export function emptyData(): Data {
  return {
    version: 2,
    demo: false,
    name: "",
    openingBalance: 0,
    notifications: false,
    accounts: [
      {
        id: "main",
        name: "Основной счет",
        type: "card",
        initialBalance: 0,
        color: palette[0],
      },
    ],
    transfers: [],
    categories: defaultCategories.map((c) => ({ ...c })),
    transactions: [],
    savings: [],
    debts: [],
    movements: [],
    reminders: [],
    limits: {},
    preferences: defaultPreferences(),
  };
}

export function decodeData(value: unknown): Data {
  const fail = () => {
    throw new Error(
      "Файл поврежден или имеет неподдерживаемый формат. Текущие данные не изменены.",
    );
  };
  const object = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const text = (v: unknown, max = 120): v is string =>
    typeof v === "string" && v.length <= max;
  const amount = (v: unknown, signed = false): v is number =>
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    Math.abs(v) <= 100_000_000_000 &&
    (signed || v >= 0);
  const idValid = (v: unknown): v is string =>
    text(v, 100) &&
    /^[a-zA-Z0-9_-]+$/.test(v) &&
    !Object.hasOwn(Object.prototype, v) &&
    v !== "prototype";
  const records = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) &&
    v.length <= 50000 &&
    v.every(object) &&
    v.every((e) => idValid(e.id)) &&
    new Set(v.map((e) => e.id)).size === v.length;

  if (!object(value)) return fail();
  const d = value;
  const maxAllowedDate = tomorrowKey();

  if (
    (d.version !== 1 && d.version !== 2) ||
    typeof d.demo !== "boolean" ||
    typeof d.notifications !== "boolean" ||
    !text(d.name, 50) ||
    !amount(d.openingBalance)
  )
    return fail();

  if (
    !records(d.categories) ||
    !records(d.transactions) ||
    !records(d.savings) ||
    !records(d.debts) ||
    !records(d.movements) ||
    !records(d.reminders) ||
    !object(d.limits)
  )
    return fail();

  const categoryRecords = d.categories,
    savingRecords = d.savings,
    debtRecords = d.debts;
  if (
    categoryRecords.length > 500 ||
    savingRecords.length > 1000 ||
    debtRecords.length > 1000
  )
    return fail();

  const kind = (v: unknown): v is Kind => v === "income" || v === "expense";
  const color = (v: unknown): v is string =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

  let accounts: Account[];
  if (d.accounts === undefined) {
    accounts = [
      {
        id: "main",
        name: "Основной счет",
        type: "card",
        initialBalance: d.openingBalance as number,
        color: palette[0],
      },
    ];
  } else {
    if (!records(d.accounts) || d.accounts.length === 0 || d.accounts.length > 50)
      return fail();
    for (const a of d.accounts) {
      if (
        !text(a.name, 80) ||
        !a.name.trim() ||
        !["card", "cash", "credit", "savings"].includes(String(a.type)) ||
        !amount(a.initialBalance) ||
        !color(a.color) ||
        (a.archived !== undefined && typeof a.archived !== "boolean")
      )
        return fail();
    }
    accounts = d.accounts.map((a) => ({
      id: a.id as string,
      name: String(a.name).trim(),
      type: a.type as AccountType,
      initialBalance: a.initialBalance as number,
      color: a.color as string,
      ...(a.archived ? { archived: true } : {}),
    }));
  }
  const accountSet = new Set(accounts.map((a) => a.id));
  const defaultAccountId = accounts[0].id;

  let transfers: AccountTransfer[] = [];
  if (d.transfers !== undefined) {
    if (!records(d.transfers)) return fail();
    for (const tr of d.transfers) {
      if (
        !idValid(tr.fromAccountId) ||
        !idValid(tr.toAccountId) ||
        !accountSet.has(tr.fromAccountId) ||
        !accountSet.has(tr.toAccountId) ||
        tr.fromAccountId === tr.toAccountId ||
        !amount(tr.amount) ||
        tr.amount <= 0 ||
        !validDate(tr.date) ||
        tr.date > maxAllowedDate ||
        !text(tr.note, 500)
      )
        return fail();
    }
    transfers = d.transfers.map((tr) => ({
      id: tr.id as string,
      fromAccountId: tr.fromAccountId as string,
      toAccountId: tr.toAccountId as string,
      amount: tr.amount as number,
      date: tr.date as string,
      note: String(tr.note ?? ""),
      ...(typeof tr.createdAt === "number" && Number.isSafeInteger(tr.createdAt)
        ? { createdAt: tr.createdAt }
        : {}),
    }));
  }

  const categoryMap = new Map<string, Kind>();
  for (const c of d.categories) {
    if (
      !text(c.name) ||
      !c.name.trim() ||
      !kind(c.kind) ||
      !color(c.color) ||
      !text(c.icon)
    )
      return fail();
    categoryMap.set(c.id as string, c.kind);
  }

  const transactions: Transaction[] = [];
  for (const t of d.transactions) {
    if (
      !amount(t.amount) ||
      t.amount <= 0 ||
      !text(t.title) ||
      !t.title.trim() ||
      !text(t.note, 500) ||
      !validDate(t.date) ||
      t.date > maxAllowedDate ||
      !kind(t.kind) ||
      !idValid(t.categoryId) ||
      categoryMap.get(t.categoryId) !== t.kind
    )
      return fail();

    const accountId =
      t.accountId === undefined ? defaultAccountId : String(t.accountId);
    if (!accountSet.has(accountId)) return fail();

    let tags: string[] | undefined;
    if (t.tags !== undefined) {
      if (
        !Array.isArray(t.tags) ||
        t.tags.length > 20 ||
        !t.tags.every((tag) => text(tag, 40) && tag.trim().length > 0)
      )
        return fail();
      tags = [...new Set(t.tags.map((tag) => String(tag).trim()))];
    }

    transactions.push({
      id: t.id as string,
      kind: t.kind,
      amount: t.amount as number,
      title: String(t.title),
      categoryId: t.categoryId,
      date: t.date,
      note: String(t.note),
      accountId,
      ...(tags && tags.length ? { tags } : {}),
      ...(typeof t.createdAt === "number" && Number.isSafeInteger(t.createdAt)
        ? { createdAt: t.createdAt }
        : {}),
    });
  }

  const savingMap = new Map<string, string>();
  const savings: Saving[] = [];
  for (const s of d.savings) {
    if (
      !text(s.name) ||
      !s.name.trim() ||
      !amount(s.target) ||
      s.target <= 0 ||
      !amount(s.initial) ||
      !validDate(s.startDate) ||
      s.startDate > maxAllowedDate ||
      !color(s.color) ||
      (s.archived !== undefined && typeof s.archived !== "boolean") ||
      (s.icon !== undefined && !text(s.icon, 40))
    )
      return fail();
    savingMap.set(s.id as string, s.startDate);
    savings.push({
      id: s.id as string,
      name: String(s.name),
      target: s.target as number,
      initial: s.initial as number,
      startDate: s.startDate,
      color: s.color,
      ...(s.archived ? { archived: true } : {}),
      ...(s.icon ? { icon: String(s.icon) } : {}),
    });
  }

  const debtMap = new Map<string, string>();
  const debts: Debt[] = [];
  for (const b of d.debts) {
    if (
      !text(b.name) ||
      !b.name.trim() ||
      !amount(b.initial) ||
      !validDate(b.startDate) ||
      b.startDate > maxAllowedDate ||
      !validDate(b.dueDate) ||
      b.dueDate < b.startDate ||
      (b.direction !== undefined &&
        b.direction !== "owe" &&
        b.direction !== "owed") ||
      (b.interestRate !== undefined &&
        (typeof b.interestRate !== "number" ||
          !Number.isFinite(b.interestRate) ||
          b.interestRate < 0 ||
          b.interestRate > 1000)) ||
      (b.archived !== undefined && typeof b.archived !== "boolean")
    )
      return fail();
    debtMap.set(b.id as string, b.startDate);
    debts.push({
      id: b.id as string,
      name: String(b.name),
      initial: b.initial as number,
      startDate: b.startDate,
      dueDate: b.dueDate,
      direction: (b.direction as DebtDirection | undefined) ?? "owe",
      ...(b.interestRate !== undefined
        ? { interestRate: b.interestRate }
        : {}),
      ...(b.archived ? { archived: true } : {}),
    });
  }

  const movements: Movement[] = [];
  const groupedMovements = new Map<string, Movement[]>();
  for (const m of d.movements) {
    if (
      !amount(m.amount, true) ||
      m.amount === 0 ||
      !validDate(m.date) ||
      m.date > maxAllowedDate ||
      (m.entityType !== "saving" && m.entityType !== "debt") ||
      !idValid(m.entityId) ||
      (m.note !== undefined && !text(m.note, 500))
    )
      return fail();

    const startDate = (m.entityType === "saving" ? savingMap : debtMap).get(
      m.entityId,
    );
    if (!startDate || startDate > m.date) return fail();

    const accountId =
      m.accountId === undefined ? defaultAccountId : String(m.accountId);
    if (!accountSet.has(accountId)) return fail();

    const entry: Movement = {
      id: m.id as string,
      entityId: m.entityId,
      entityType: m.entityType,
      amount: m.amount as number,
      date: m.date,
      accountId,
      ...(m.note ? { note: String(m.note) } : {}),
      ...(typeof m.createdAt === "number" && Number.isSafeInteger(m.createdAt)
        ? { createdAt: m.createdAt }
        : {}),
    };
    movements.push(entry);
    const groupKey = `${entry.entityType}:${entry.entityId}`;
    const list = groupedMovements.get(groupKey);
    if (list) list.push(entry);
    else groupedMovements.set(groupKey, [entry]);
  }

  const reminders: Reminder[] = [];
  for (const r of d.reminders) {
    if (
      !text(r.title) ||
      !r.title.trim() ||
      !amount(r.amount) ||
      !validDate(r.date) ||
      typeof r.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ||
      !["bill", "credit", "saving"].includes(String(r.type)) ||
      typeof r.done !== "boolean" ||
      (r.recurrence !== undefined &&
        !["none", "weekly", "monthly", "yearly"].includes(String(r.recurrence))) ||
      (r.categoryId !== undefined &&
        (!idValid(r.categoryId) || !categoryMap.has(r.categoryId))) ||
      (r.entityId !== undefined &&
        (!idValid(r.entityId) ||
          (!savingMap.has(r.entityId) && !debtMap.has(r.entityId)))) ||
      (r.accountId !== undefined &&
        (!idValid(r.accountId) || !accountSet.has(r.accountId)))
    )
      return fail();
    reminders.push({
      id: r.id as string,
      title: String(r.title),
      amount: r.amount as number,
      date: r.date,
      time: r.time,
      type: r.type as Reminder["type"],
      done: r.done,
      ...(r.recurrence ? { recurrence: r.recurrence as Recurrence } : {}),
      ...(r.categoryId ? { categoryId: r.categoryId } : {}),
      ...(r.entityId ? { entityId: r.entityId } : {}),
      ...(r.accountId ? { accountId: r.accountId } : {}),
    });
  }

  for (const [id, n] of Object.entries(d.limits)) {
    if (!amount(n) || categoryMap.get(id) !== "expense") return fail();
  }

  const prefDefaults = defaultPreferences();
  let preferences = prefDefaults;
  if (d.preferences !== undefined) {
    if (!object(d.preferences)) return fail();
    const p = d.preferences;
    const theme = ["glass", "oled", "light"].includes(String(p.theme))
      ? (p.theme as ThemeMode)
      : prefDefaults.theme;
    const secondaryCurrency = [
      "USD",
      "EUR",
      "CNY",
      "KZT",
      "BYN",
      "NONE",
    ].includes(String(p.secondaryCurrency))
      ? (p.secondaryCurrency as SecondaryCurrency)
      : prefDefaults.secondaryCurrency;
    const paydayDay =
      typeof p.paydayDay === "number" &&
      Number.isSafeInteger(p.paydayDay) &&
      p.paydayDay >= 1 &&
      p.paydayDay <= 28
        ? p.paydayDay
        : prefDefaults.paydayDay;
    const hideBalancesOnStart =
      typeof p.hideBalancesOnStart === "boolean"
        ? p.hideBalancesOnStart
        : prefDefaults.hideBalancesOnStart;

    let insightThresholds = prefDefaults.insightThresholds;
    if (object(p.insightThresholds)) {
      const th = p.insightThresholds;
      insightThresholds = {
        growthPercent:
          typeof th.growthPercent === "number" &&
          Number.isSafeInteger(th.growthPercent) &&
          th.growthPercent >= 10 &&
          th.growthPercent <= 500
            ? th.growthPercent
            : prefDefaults.insightThresholds.growthPercent,
        growthMinAmount: amount(th.growthMinAmount)
          ? th.growthMinAmount
          : prefDefaults.insightThresholds.growthMinAmount,
        largeMinAmount: amount(th.largeMinAmount)
          ? th.largeMinAmount
          : prefDefaults.insightThresholds.largeMinAmount,
      };
    }

    const dismissedInsights =
      Array.isArray(p.dismissedInsights) &&
      p.dismissedInsights.length <= 1000 &&
      p.dismissedInsights.every((item) => text(item, 160))
        ? (p.dismissedInsights as string[])
        : [];

    const rawAi =
      p.ai && typeof p.ai === "object"
        ? (p.ai as Record<string, unknown>)
        : null;
    const aiChoice: AiChoice =
      rawAi?.choice === "enabled" ||
      rawAi?.choice === "disabled" ||
      rawAi?.choice === "undecided"
        ? rawAi.choice
        : "undecided";
    const aiModelId: AiModelId =
      rawAi?.modelId === "qwen2.5-3b" || rawAi?.modelId === "qwen2.5-1.5b"
        ? rawAi.modelId
        : "qwen2.5-3b";
    const aiIncludeContext =
      typeof rawAi?.includeContext === "boolean"
        ? rawAi.includeContext
        : true;

    preferences = {
      theme,
      secondaryCurrency,
      paydayDay,
      hideBalancesOnStart,
      insightThresholds,
      dismissedInsights,
      ai: {
        choice: aiChoice,
        modelId: aiModelId,
        includeContext: aiIncludeContext,
      },
    };
  }

  const openingBalance = accounts.reduce((s, a) => s + a.initialBalance, 0);
  const absoluteTotal =
    openingBalance +
    transactions.reduce((s, t) => s + t.amount, 0) +
    transfers.reduce((s, tr) => s + tr.amount, 0) +
    movements.reduce((s, m) => s + Math.abs(m.amount), 0) +
    [...savings, ...debts].reduce((s, e) => s + e.initial, 0);
  if (!Number.isSafeInteger(absoluteTotal)) return fail();

  for (const type of ["saving", "debt"] as const) {
    for (const entity of type === "saving" ? savings : debts) {
      let balance = entity.initial;
      const list = (groupedMovements.get(`${type}:${entity.id}`) ?? []).sort(
        (a, b) => a.date.localeCompare(b.date),
      );
      for (const m of list) {
        balance += type === "saving" ? m.amount : -m.amount;
        if (balance < 0) {
          throw new Error(
            "Перевод создает отрицательный остаток накоплений или переплату долга. Проверьте историю переводов. Текущие данные не изменены.",
          );
        }
      }
    }
  }

  return {
    version: 2,
    demo: Boolean(d.demo),
    name: String(d.name),
    openingBalance,
    notifications: Boolean(d.notifications),
    accounts,
    transfers,
    categories: d.categories as unknown as Category[],
    transactions,
    savings,
    debts,
    movements,
    reminders,
    limits: d.limits as Record<string, number>,
    preferences,
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  const formula = /^[\s]*[=+\-@]/.test(text) && !/^-\d+(,\d{2})?$/.test(text);
  return `"${(formula ? "'" : "") + text.replaceAll('"', '""')}"`;
}

export function exportCsv(
  data: Data,
  period: string,
  rates: ExchangeRates | null = null,
): string {
  const secondary = data.preferences.secondaryCurrency;
  const activeCurrency = secondary === "NONE" ? null : secondary;
  const rubPerUnit = activeCurrency
    ? rateForCurrency(rates, activeCurrency)
    : null;
  const converted = (amount: number) =>
    rubPerUnit
      ? (amount / 100 / rubPerUnit).toFixed(2).replace(".", ",")
      : "";

  const accountNames = new Map(data.accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map(data.categories.map((c) => [c.id, c.name]));
  const { start, end } = periodBounds(period, data.preferences.paydayDay);
  const secHeader = activeCurrency
    ? `Сумма (${activeCurrency}, справочно)`
    : "Доп. валюта";

  const rows: (string | number)[][] = [
    [
      "Дата",
      "Тип",
      "Счет",
      "Категория",
      "Описание",
      "Сумма (RUB)",
      secHeader,
      "Теги",
      "Примечание",
    ],
  ];

  for (const t of [...periodTransactions(data, period)].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    rows.push([
      formatDate(t.date),
      t.kind === "income" ? "Доход" : "Расход",
      accountNames.get(t.accountId ?? data.accounts[0]?.id ?? "main") ?? "",
      categoryNames.get(t.categoryId) ?? "",
      t.title,
      (t.amount / 100).toFixed(2).replace(".", ","),
      converted(t.amount),
      (t.tags ?? []).join(", "),
      t.note,
    ]);
  }

  for (const tr of data.transfers.filter(
    (item) => item.date >= start && item.date <= end,
  )) {
    rows.push([
      formatDate(tr.date),
      "Перевод между счетами",
      `${accountNames.get(tr.fromAccountId) ?? ""} → ${accountNames.get(tr.toAccountId) ?? ""}`,
      "Перевод",
      tr.note || "Перевод между счетами",
      (tr.amount / 100).toFixed(2).replace(".", ","),
      converted(tr.amount),
      "",
      "Не включается в доходы и расходы",
    ]);
  }

  for (const m of data.movements.filter(
    (item) => item.date >= start && item.date <= end,
  )) {
    const debt =
      m.entityType === "debt"
        ? data.debts.find((d) => d.id === m.entityId)
        : undefined;
    const typeLabel =
      m.entityType === "saving"
        ? m.amount > 0
          ? "Взнос в накопления"
          : "Снятие накоплений"
        : debt?.direction === "owed"
          ? m.amount > 0
            ? "Возврат долга мне"
            : "Выдача в долг"
          : m.amount > 0
            ? "Погашение долга"
            : "Увеличение долга";
    rows.push([
      formatDate(m.date),
      typeLabel,
      accountNames.get(m.accountId ?? data.accounts[0]?.id ?? "main") ?? "",
      "Перевод",
      (m.entityType === "saving" ? data.savings : data.debts).find(
        (e) => e.id === m.entityId,
      )?.name ?? "",
      (m.amount / 100).toFixed(2).replace(".", ","),
      converted(m.amount),
      "",
      m.note || "Не включается в доходы и расходы",
    ]);
  }

  const sum = totals(periodTransactions(data, period));
  rows.push(
    [],
    ["Сводка", period],
    [
      "Показатель",
      "RUB",
      activeCurrency
        ? `${activeCurrency} (по текущему справочному курсу)`
        : "Доп. валюта",
    ],
    [
      "Доходы",
      (sum.income / 100).toFixed(2).replace(".", ","),
      converted(sum.income),
    ],
    [
      "Расходы",
      (sum.expense / 100).toFixed(2).replace(".", ","),
      converted(sum.expense),
    ],
    [
      "Разница",
      ((sum.income - sum.expense) / 100).toFixed(2).replace(".", ","),
      converted(sum.income - sum.expense),
    ],
  );

  const balance = balances(data, periodEnd(period, data.preferences.paydayDay));
  if (balance.overdraft) {
    rows.push([
      "Долг по перерасходу на конец периода",
      (balance.overdraft / 100).toFixed(2).replace(".", ","),
      converted(balance.overdraft),
    ]);
  }
  if (rates && activeCurrency && rubPerUnit) {
    rows.push(
      [],
      [
        `Курс ЦБ: RUB за 1 ${activeCurrency}`,
        String(rubPerUnit).replace(".", ","),
      ],
      ["Дата курса", rates.date],
      ["Проверен", new Date(rates.checkedAt).toISOString()],
      [
        `${activeCurrency} — справочный пересчет всех сумм по одному указанному курсу, не исторический курс операции`,
      ],
    );
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

export { dualMoney, formatCurrency };
