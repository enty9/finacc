import type { ExchangeRate } from "./exchange.ts";

export type Kind = "income" | "expense";
export type Page =
  "overview" | "transactions" | "budget" | "goals" | "reports" | "reminders";
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
}
export interface Saving {
  id: string;
  name: string;
  target: number;
  initial: number;
  startDate: string;
  color: string;
}
export interface Debt {
  id: string;
  name: string;
  initial: number;
  startDate: string;
  dueDate: string;
}
export interface Movement {
  id: string;
  entityId: string;
  entityType: "saving" | "debt";
  amount: number;
  date: string;
}
export interface Reminder {
  id: string;
  title: string;
  amount: number;
  date: string;
  time: string;
  type: "bill" | "credit" | "saving";
  done: boolean;
}
export interface Data {
  version: 1;
  demo: boolean;
  name: string;
  openingBalance: number;
  notifications: boolean;
  categories: Category[];
  transactions: Transaction[];
  savings: Saving[];
  debts: Debt[];
  movements: Movement[];
  reminders: Reminder[];
  limits: Record<string, number>;
}
export const palette = [
  "#60a5fa",
  "#a5c8ff",
  "#38bdf8",
  "#818cf8",
  "#67c9e8",
  "#94a3b8",
  "#93c5fd",
  "#b8c8e0",
];
export const uid = () => crypto.randomUUID();
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
export function parseMoney(value: string, zero = false): number {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized))
    throw new Error(
      "Введите сумму в рублях, не более двух знаков после запятой.",
    );
  const [whole, fraction = ""] = normalized.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (amount > 100_000_000_000 || (!zero && amount === 0))
    throw new Error("Сумма должна быть больше нуля и не превышать 1 млрд ₽.");
  return amount;
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
  const date = text.split(".").reverse().join("-");
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text) || !validDate(date))
    throw new Error("Введите дату операции в формате ДД.ММ.ГГГГ.");
  if (date > dateKey())
    throw new Error("Дата операции не может быть в будущем.");
  return date;
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
  return data.transactions.filter((t) => t.date.startsWith(period));
}
export function categoryTotals(data: Data, period: string) {
  const expenses = periodTransactions(data, period).filter(
    (t) => t.kind === "expense",
  );
  const sums = new Map<string, number>();
  expenses.forEach((t) =>
    sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount),
  );
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
export function balances(data: Data, until = "2199-12-31") {
  const flow = totals(data.transactions.filter((t) => t.date <= until));
  const transfers = data.movements
    .filter((m) => m.date <= until)
    .reduce((sum, m) => sum + m.amount, 0);
  const cash = data.openingBalance + flow.income - flow.expense - transfers;
  const overdraft = Math.max(0, -cash);
  return {
    cash: Math.max(0, cash),
    overdraft,
    saved: data.savings.reduce(
      (sum, s) => sum + entityBalance(data, s, "saving", until),
      0,
    ),
    debt:
      overdraft +
      data.debts.reduce(
        (sum, d) => sum + entityBalance(data, d, "debt", until),
        0,
      ),
  };
}
export const periodEnd = (period: string) =>
  period.length === 4
    ? `${period}-12-31`
    : dateKey(
        new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
      );
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
export interface Insight {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "info";
  page: Page;
}
// shortcut: rule-based signals suggest a review; add configurable rules if users need personal thresholds.
export function insights(
  data: Data,
  month: string,
  formatMoney: (amount: number) => string = money,
): Insight[] {
  const result: Insight[] = [];
  const categories = categoryTotals(data, month);
  for (const c of categories) {
    if (c.limit && c.amount >= c.limit * 0.8)
      result.push({
        id: `limit-${c.id}`,
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
  const expenses = data.transactions
    .filter((t) => t.kind === "expense")
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = new Map<string, Transaction>();
  const duplicateKeys = new Set<string>();
  for (const t of expenses) {
    const key = `${t.amount}|${t.title.trim().toLocaleLowerCase("ru")}|${t.categoryId}`;
    const prior = last.get(key);
    if (
      t.date.startsWith(month) &&
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
  const previous = categoryTotals(data, shiftMonth(month, -1));
  for (const c of categories) {
    const before = previous.find((p) => p.id === c.id)?.amount ?? 0;
    if (before > 0 && c.amount >= before * 1.5 && c.amount - before >= 300_000)
      result.push({
        id: `growth-${c.id}`,
        title: `Больше расходов: ${c.name.toLocaleLowerCase("ru")}`,
        description: `Рост на ${changePercent(c.amount, before)}% к прошлому месяцу: ${formatMoney(c.amount)} вместо ${formatMoney(before)}.`,
        severity: "info",
        page: "reports",
      });
  }
  const monthExpenses = expenses.filter((t) => t.date.startsWith(month));
  const past = expenses.filter((t) => t.date < `${month}-01`);
  const average = past.length
    ? past.reduce((sum, t) => sum + t.amount, 0) / past.length
    : 0;
  const large = monthExpenses.filter(
    (t) => t.amount >= Math.max(1_000_000, average * 3),
  );
  if (large.length)
    result.push({
      id: "large",
      title: "Крупные платежи",
      description: `${large.length} ${large.length === 1 ? "операция" : "операции"} от ${formatMoney(Math.max(1_000_000, Math.ceil((average * 3) / 100) * 100))}. Самый крупный платеж: «${[...large].sort((a, b) => b.amount - a.amount)[0].title}».`,
      severity: "info",
      page: "transactions",
    });
  return result;
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
    color: palette[3],
    icon: "car",
  },
  {
    id: "shopping",
    name: "Покупки",
    kind: "expense",
    color: palette[4],
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
    color: palette[5],
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
    color: palette[0],
    icon: "briefcase",
  },
  {
    id: "freelance",
    name: "Подработка",
    kind: "income",
    color: palette[4],
    icon: "laptop",
  },
  {
    id: "gift",
    name: "Подарки и другое",
    kind: "income",
    color: palette[3],
    icon: "gift",
  },
];
export function emptyData(): Data {
  return {
    version: 1,
    demo: false,
    name: "",
    openingBalance: 0,
    notifications: false,
    categories: defaultCategories.map((c) => ({ ...c })),
    transactions: [],
    savings: [],
    debts: [],
    movements: [],
    reminders: [],
    limits: {},
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
  const records = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) &&
    v.length <= 50000 &&
    v.every(object) &&
    v.every(
      (e) =>
        text(e.id, 100) &&
        /^[a-zA-Z0-9_-]+$/.test(e.id) &&
        !Object.hasOwn(Object.prototype, e.id) &&
        e.id !== "prototype",
    ) &&
    new Set(v.map((e) => e.id)).size === v.length;
  if (!object(value)) return fail();
  const d = value;
  if (
    d.version !== 1 ||
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
  const kind = (v: unknown) => v === "income" || v === "expense";
  const color = (v: unknown) =>
    typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  if (
    !d.categories.every(
      (c) =>
        text(c.name) &&
        c.name.trim() &&
        kind(c.kind) &&
        color(c.color) &&
        text(c.icon),
    )
  )
    return fail();
  if (
    !d.transactions.every(
      (t) =>
        amount(t.amount) &&
        t.amount > 0 &&
        text(t.title) &&
        t.title.trim() &&
        text(t.note, 500) &&
        validDate(t.date) &&
        t.date <= dateKey() &&
        kind(t.kind) &&
        categoryRecords.some((c) => c.id === t.categoryId && c.kind === t.kind),
    )
  )
    return fail();
  if (
    !d.savings.every(
      (s) =>
        text(s.name) &&
        s.name.trim() &&
        amount(s.target) &&
        s.target > 0 &&
        amount(s.initial) &&
        validDate(s.startDate) &&
        s.startDate <= dateKey() &&
        color(s.color),
    )
  )
    return fail();
  if (
    !d.debts.every(
      (b) =>
        text(b.name) &&
        b.name.trim() &&
        amount(b.initial) &&
        validDate(b.startDate) &&
        b.startDate <= dateKey() &&
        validDate(b.dueDate) &&
        b.dueDate >= b.startDate,
    )
  )
    return fail();
  if (
    !d.movements.every(
      (m) =>
        amount(m.amount, true) &&
        m.amount !== 0 &&
        validDate(m.date) &&
        m.date <= dateKey() &&
        (m.entityType === "saving" || m.entityType === "debt") &&
        (m.entityType === "saving" ? savingRecords : debtRecords).some(
          (e) =>
            e.id === m.entityId &&
            typeof e.startDate === "string" &&
            e.startDate <= String(m.date),
        ),
    )
  )
    return fail();
  if (
    !d.reminders.every(
      (r) =>
        text(r.title) &&
        r.title.trim() &&
        amount(r.amount) &&
        validDate(r.date) &&
        typeof r.time === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) &&
        ["bill", "credit", "saving"].includes(String(r.type)) &&
        typeof r.done === "boolean",
    )
  )
    return fail();
  if (
    Object.entries(d.limits).some(
      ([id, n]) =>
        !amount(n) ||
        !categoryRecords.some((c) => c.id === id && c.kind === "expense"),
    )
  )
    return fail();
  const data = d as unknown as Data;
  const absoluteTotal =
    data.openingBalance +
    data.transactions.reduce((s, t) => s + t.amount, 0) +
    data.movements.reduce((s, m) => s + Math.abs(m.amount), 0) +
    [...data.savings, ...data.debts].reduce((s, e) => s + e.initial, 0);
  if (!Number.isSafeInteger(absoluteTotal)) return fail();
  for (const type of ["saving", "debt"] as const) {
    for (const entity of type === "saving" ? data.savings : data.debts) {
      let balance = entity.initial;
      for (const m of data.movements
        .filter((m) => m.entityId === entity.id && m.entityType === type)
        .sort((a, b) => a.date.localeCompare(b.date))) {
        balance += type === "saving" ? m.amount : -m.amount;
        if (balance < 0)
          throw new Error(
            "Перевод создает отрицательный остаток накоплений или переплату долга. Проверьте историю переводов. Текущие данные не изменены.",
          );
      }
    }
  }
  return data;
}
function csvCell(value: string | number): string {
  const text = String(value);
  const formula = /^[\s]*[=+\-@]/.test(text) && !/^-\d+(,\d{2})?$/.test(text);
  return `"${(formula ? "'" : "") + text.replaceAll('"', '""')}"`;
}
export function exportCsv(
  data: Data,
  period: string,
  rate: ExchangeRate | null = null,
): string {
  const dollars = (amount: number) =>
    rate ? (amount / 100 / rate.rubPerUsd).toFixed(2).replace(".", ",") : "";
  const rows: (string | number)[][] = [
    [
      "Дата",
      "Тип",
      "Категория",
      "Описание",
      "Сумма (RUB)",
      "Сумма (USD, справочно)",
      "Примечание",
    ],
  ];
  for (const t of [...periodTransactions(data, period)].sort((a, b) =>
    a.date.localeCompare(b.date),
  ))
    rows.push([
      formatDate(t.date),
      t.kind === "income" ? "Доход" : "Расход",
      data.categories.find((c) => c.id === t.categoryId)?.name ?? "",
      t.title,
      (t.amount / 100).toFixed(2).replace(".", ","),
      dollars(t.amount),
      t.note,
    ]);
  for (const m of data.movements.filter((m) => m.date.startsWith(period)))
    rows.push([
      formatDate(m.date),
      m.entityType === "saving"
        ? m.amount > 0
          ? "Взнос в накопления"
          : "Снятие накоплений"
        : m.amount > 0
          ? "Погашение долга"
          : "Увеличение долга",
      "Перевод",
      (m.entityType === "saving" ? data.savings : data.debts).find(
        (e) => e.id === m.entityId,
      )?.name ?? "",
      (m.amount / 100).toFixed(2).replace(".", ","),
      dollars(m.amount),
      "Не включается в доходы и расходы",
    ]);
  const sum = totals(periodTransactions(data, period));
  rows.push(
    [],
    ["Сводка", period],
    ["Показатель", "RUB", "USD (по текущему справочному курсу)"],
    [
      "Доходы",
      (sum.income / 100).toFixed(2).replace(".", ","),
      dollars(sum.income),
    ],
    [
      "Расходы",
      (sum.expense / 100).toFixed(2).replace(".", ","),
      dollars(sum.expense),
    ],
    [
      "Разница",
      ((sum.income - sum.expense) / 100).toFixed(2).replace(".", ","),
      dollars(sum.income - sum.expense),
    ],
  );
  const balance = balances(data, periodEnd(period));
  if (balance.overdraft)
    rows.push([
      "Долг по перерасходу на конец периода",
      (balance.overdraft / 100).toFixed(2).replace(".", ","),
      dollars(balance.overdraft),
    ]);
  if (rate)
    rows.push(
      [],
      ["Курс ЦБ: RUB за 1 USD", String(rate.rubPerUsd).replace(".", ",")],
      ["Дата курса", rate.date],
      ["Проверен", new Date(rate.checkedAt).toISOString()],
      [
        "USD — справочный пересчет всех сумм по одному указанному курсу, не исторический курс операции",
      ],
    );
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
