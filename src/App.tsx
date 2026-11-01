import { Money, ExchangeRateBar, useMoney, useCurrency } from "./currency";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  FileText,
  Flag,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  balances,
  categoryTotals,
  changePercent,
  dateKey,
  emptyData,
  exportCsv,
  insights,
  monthKey,
  monthName,
  periodEnd,
  periodTransactions,
  previousPeriod,
  shiftMonth,
  totals,
  type Category,
  type Data,
  type Debt,
  type Page,
  type Reminder,
  type Saving,
  type Transaction,
} from "./domain";
import {
  Card,
  CardHeading,
  CategoryIcon,
  Empty,
  FlowIcon,
  GoalCard,
  Modal,
  Progress,
  ReminderIcon,
  SubmitForm,
  TransactionList,
} from "./components";
import { CashChart, ExpenseChart, Sparkline } from "./charts";
import {
  BudgetForm,
  EntityForm,
  ReminderForm,
  SettingsForm,
  TransactionForm,
  TransferForm,
  type Commit,
} from "./forms";
import {
  android,
  enableNotifications,
  loadData,
  notifyBudget,
  persistData,
  pickBackup,
  saveFile,
  syncReminders,
} from "./platform";

type ModalState =
  | { type: "transaction"; transaction?: Transaction }
  | { type: "budget"; category: Category }
  | { type: "entity"; debt: boolean; entity?: Saving | Debt }
  | { type: "transfer"; debt: boolean; entity: Saving | Debt }
  | { type: "reminder"; reminder?: Reminder }
  | { type: "settings" }
  | { type: "help" }
  | { type: "import"; data: Data }
  | { type: "start" };
const navigation: {
  id: Page;
  title: string;
  short: string;
  icon: LucideIcon;
}[] = [
  { id: "overview", title: "Обзор", short: "Обзор", icon: LayoutDashboard },
  {
    id: "transactions",
    title: "Операции",
    short: "Операции",
    icon: ArrowDownLeft,
  },
  { id: "budget", title: "Бюджет", short: "Бюджет", icon: Wallet },
  { id: "goals", title: "Цели и долги", short: "Цели", icon: Target },
  { id: "reports", title: "Отчеты", short: "Отчеты", icon: BarChart3 },
  { id: "reminders", title: "Напоминания", short: "Напоминания", icon: Bell },
];
const titles: Record<Page, [string, string]> = {
  overview: [
    "Финансы в равновесии",
    "Все важное о ваших деньгах. Спокойно и понятно.",
  ],
  transactions: [
    "У каждой суммы своя история",
    "Записывайте доходы и расходы, чтобы видеть больше.",
  ],
  budget: [
    "Планы, которые работают",
    "Задайте границы расходов. О приближении к ним мы напомним.",
  ],
  goals: [
    "Ближе к тому, что важно",
    "Копите на мечты и постепенно закрывайте долги.",
  ],
  reports: [
    "Вся картина в деталях",
    "Замечайте привычки и сравнивайте свои результаты.",
  ],
  reminders: [
    "Ничего не упустить",
    "Счета, платежи и полезные финансовые привычки.",
  ],
};
const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Не удалось выполнить действие. Попробуйте еще раз.";

export default function App() {
  const money = useMoney();
  const { rate: exchangeRate } = useCurrency();
  const [data, setData] = useState<Data | null>(null);
  const dataRef = useRef<Data | null>(null);
  const saving = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const [month, setMonth] = useState(monthKey());
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [hidden, setHidden] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [goalTab, setGoalTab] = useState<"saving" | "debt">("saving");
  const [annual, setAnnual] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showAllInsights, setShowAllInsights] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const showError = useCallback(
    (error: unknown) => setToast({ text: errorMessage(error), error: true }),
    [],
  );
  const close = () => setModal(null);

  useEffect(() => {
    let active = true;
    loadData()
      .then((result) => {
        if (active) {
          dataRef.current = result;
          setData(result);
        }
      })
      .catch((e) => {
        if (active) setLoadError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.error ? 10000 : 4000,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!data) return;
    syncReminders(data).catch(showError);
  }, [data?.reminders, data?.notifications, data?.demo, showError]); // Scheduling follows the saved reminder list, including completion and deletion.
  const commit: Commit = useCallback(
    async (update) => {
      if (!dataRef.current || saving.current)
        throw new Error("Дождитесь сохранения предыдущего изменения.");
      saving.current = true;
      const before = dataRef.current;
      try {
        const next = update(before);
        await persistData(next);
        dataRef.current = next;
        setData(next);
        setToast({ text: "Сохранено. Все на своих местах.", error: false });
        notifyBudget(before, next).catch(showError);
      } finally {
        saving.current = false;
      }
    },
    [showError],
  );
  const navigate = (next: Page) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  if (loadError)
    return (
      <div className="loading-screen">
        <div className="brand-icon">
          <DollarSign />
        </div>
        <h1>Не удалось прочитать данные</h1>
        <p>{loadError}</p>
        <p>Сохраненные данные не перезаписаны.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Попробовать снова
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="loading-screen">
        <div className="brand-icon loading">
          <DollarSign />
        </div>
        <h1>finacc</h1>
        <p>Собираем вашу финансовую картину…</p>
      </div>
    );

  const period = annual && page === "reports" ? month.slice(0, 4) : month;
  const selected = periodTransactions(data, period);
  const sum = totals(selected);
  const prior = totals(periodTransactions(data, previousPeriod(period)));
  const balance = balances(data, periodEnd(period));
  const currentBalance = balances(data);
  const categories = categoryTotals(data, month);
  const allInsights = insights(data, month, money);
  const upcoming = data.reminders
    .filter((r) => !r.done)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const sortedTransactions = [...selected].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      data.transactions.indexOf(b) - data.transactions.indexOf(a),
  );
  const filtered = sortedTransactions.filter(
    (t) =>
      (kindFilter === "all" || t.kind === kindFilter) &&
      (categoryFilter === "all" || t.categoryId === categoryFilter) &&
      `${t.title} ${t.note} ${data.categories.find((c) => c.id === t.categoryId)?.name}`
        .toLocaleLowerCase("ru")
        .includes(search.trim().toLocaleLowerCase("ru")),
  );
  const budgetTotal = categories.reduce((s, c) => s + c.limit, 0);
  const budgetSpent = categories
    .filter((c) => c.limit > 0)
    .reduce((s, c) => s + c.amount, 0);
  const rate =
    sum.income > 0
      ? Math.round(((sum.income - sum.expense) / sum.income) * 100)
      : 0;
  const doneCount = data.reminders.filter((r) => r.done).length;

  async function exportFile(backup = false) {
    if (!data || exportBusy) return;
    setExportBusy(true);
    try {
      const saved = await saveFile(
        backup
          ? `finacc-backup-${dateKey()}.json`
          : `finacc-report-${period}.csv`,
        backup
          ? JSON.stringify(data, null, 2)
          : exportCsv(data, period, exchangeRate),
        backup ? "json" : "csv",
      );
      if (saved)
        setToast({
          text: backup
            ? "Резервная копия экспортирована."
            : "Отчет экспортирован в CSV.",
          error: false,
        });
    } catch (e) {
      showError(e);
    } finally {
      setExportBusy(false);
    }
  }
  async function importFile() {
    try {
      const backup = await pickBackup();
      if (backup) setModal({ type: "import", data: backup });
    } catch (e) {
      showError(e);
    }
  }
  const editTransaction = (transaction: Transaction) =>
    setModal({ type: "transaction", transaction });
  const metric = (kind: "income" | "expense") => {
    const change = changePercent(sum[kind], prior[kind]);
    const values = Array.from(
      { length: 6 },
      (_, i) =>
        totals(periodTransactions(data, shiftMonth(month, i - 5)))[kind],
    );
    return (
      <Card className={`metric-card ${kind}`}>
        <div className="metric-title">
          <span>{kind === "income" ? "Доходы" : "Расходы"}</span>
          <FlowIcon kind={kind} />
        </div>
        <div className="metric-value">
          <strong>{<Money amount={sum[kind]} />}</strong>
          <Sparkline expense={kind === "expense"} values={values} />
        </div>
        <p className="metric-change">
          {change !== null ? (
            <>
              <span
                className={
                  (kind === "income" ? change >= 0 : change <= 0)
                    ? "positive"
                    : "warm"
                }
              >
                {change > 0 ? "+" : ""}
                {change}%
              </span>{" "}
              к прошлому {period.length === 4 ? "году" : "месяцу"}
            </>
          ) : (
            <>
              За{" "}
              {period.length === 4
                ? `${period} год`
                : monthName(month).toLocaleLowerCase("ru")}
            </>
          )}
        </p>
      </Card>
    );
  };
  const reminderRow = (reminder: Reminder, compact = false) => (
    <div
      className={`reminder-row ${reminder.done ? "done" : ""}`}
      key={reminder.id}
    >
      <ReminderIcon type={reminder.type} />
      <button
        className="reminder-info"
        onClick={() => setModal({ type: "reminder", reminder })}
      >
        <strong>{reminder.title}</strong>
        <span
          className={reminder.date < dateKey() && !reminder.done ? "warm" : ""}
        >
          {new Date(`${reminder.date}T12:00:00`).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
          })}
          {!compact && ` · ${reminder.time}`}
          {reminder.date < dateKey() && !reminder.done ? " · просрочено" : ""}
        </span>
      </button>
      {reminder.amount > 0 && (
        <strong className="reminder-amount">
          {<Money amount={reminder.amount} />}
        </strong>
      )}
      {!compact && (
        <button
          className={`icon-button completion ${reminder.done ? "completed" : ""}`}
          aria-label={
            reminder.done
              ? `Вернуть: ${reminder.title}`
              : `Готово: ${reminder.title}`
          }
          onClick={() =>
            commit((d) => ({
              ...d,
              reminders: d.reminders.map((r) =>
                r.id === reminder.id ? { ...r, done: !r.done } : r,
              ),
            })).catch(showError)
          }
        >
          <Check size={17} />
        </button>
      )}
      {!compact && (
        <button
          className="icon-button subtle"
          aria-label={`Удалить напоминание: ${reminder.title}`}
          onClick={() => {
            if (window.confirm(`Удалить напоминание «${reminder.title}»?`))
              commit((d) => ({
                ...d,
                reminders: d.reminders.filter((r) => r.id !== reminder.id),
              })).catch(showError);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className="sidebar glass">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
          aria-label="finacc — на главную"
        >
          <span className="brand-icon">
            <DollarSign size={28} strokeWidth={2} />
          </span>
          <span>
            finacc<span className="brand-dot">.</span>
            <small>личные финансы</small>
          </span>
        </a>
        <span className="nav-label">ВАШЕ ПРОСТРАНСТВО</span>
        <nav aria-label="Основная навигация">
          {navigation.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{title}</span>
              {id === "reminders" && upcoming.length > 0 && (
                <span className="nav-count">{upcoming.length}</span>
              )}
              {page === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="help-link"
            onClick={() => setModal({ type: "help" })}
          >
            <CircleHelp size={18} />
            Как устроен finacc
            <ArrowRight size={14} />
          </button>
          <button
            className="profile"
            onClick={() => setModal({ type: "settings" })}
          >
            <span className="avatar">
              {(data.name || "Я").slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{data.name || "Мой finacc"}</strong>
              <small>Личное пространство</small>
            </span>
            <Settings2 size={18} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-context">
            <span className="status-dot" />
            <span>Ваше финансовое пространство</span>
          </div>
          <div className="topbar-actions">
            <span className="local-badge">
              <LockKeyhole size={13} />
              Только на вашем устройстве
            </span>
            <button
              className={`icon-button notification-button ${page === "reminders" ? "selected" : ""}`}
              aria-label="Напоминания"
              onClick={() => navigate("reminders")}
            >
              <Bell size={20} strokeWidth={1.6} />
              {upcoming.length > 0 && <i />}
            </button>
            <button
              className="icon-button mobile-settings"
              aria-label="Настройки"
              onClick={() => setModal({ type: "settings" })}
            >
              <Settings2 size={20} />
            </button>
          </div>
        </header>
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {page === "overview"
                ? "ЧУТЬ БОЛЬШЕ ЯСНОСТИ КАЖДЫЙ ДЕНЬ"
                : navigation.find((n) => n.id === page)?.title.toUpperCase()}
            </span>
            <h1>
              {titles[page][0]}
              <span className="title-dot">.</span>
            </h1>
            <p>{titles[page][1]}</p>
          </div>
          <button
            className="button primary add-operation"
            aria-label="Добавить операцию"
            onClick={() => setModal({ type: "transaction" })}
          >
            <Plus size={18} />
            <span>Добавить операцию</span>
          </button>
        </div>
        <div className="period-toolbar">
          <div className="period-selector glass">
            <button
              className="icon-button"
              aria-label="Предыдущий месяц"
              disabled={month <= "1900-01"}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <label className="month-input-label">
              <span>{monthName(month)}</span>
              <input
                aria-label="Отчетный месяц"
                type="month"
                value={month}
                min="1900-01"
                max={monthKey()}
                onChange={(e) => {
                  if (
                    /^\d{4}-\d{2}$/.test(e.target.value) &&
                    e.target.value >= "1900-01" &&
                    e.target.value <= monthKey()
                  )
                    setMonth(e.target.value);
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="Следующий месяц"
              disabled={month >= monthKey()}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <span className="period-caption">
            {month === monthKey()
              ? "Ваш ритм в этом месяце"
              : "Ваша финансовая история"}
          </span>
          <button
            className="export-link"
            disabled={exportBusy}
            onClick={() => exportFile()}
          >
            <Download size={16} />
            <span>Экспорт данных</span>
          </button>
        </div>
        <ExchangeRateBar />
        {data.demo && (
          <div className="demo-banner">
            <span>
              <Sparkles size={15} />
              <span>
                Знакомьтесь с finacc{" "}
                <span className="demo-detail">
                  · сейчас показаны демоданные
                </span>
              </span>
            </span>
            <button onClick={() => setModal({ type: "start" })}>
              Начать свой учет
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {page === "overview" && (
          <div className="overview-grid">
            <section className="balance-card glass">
              <div className="balance-top">
                <span>
                  <span className="balance-wallet">
                    <Wallet size={18} />
                  </span>
                  Доступный остаток
                </span>
                <button
                  className="icon-button"
                  aria-label={hidden ? "Показать остаток" : "Скрыть остаток"}
                  onClick={() => setHidden(!hidden)}
                >
                  {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <strong className="balance-value">
                {hidden ? "••• ••• ₽" : <Money amount={balance.cash} />}
              </strong>
              <p className="balance-date">
                {balance.overdraft > 0
                  ? "Перерасход учтён как долг"
                  : month === monthKey()
                    ? "Деньги, которыми можно распоряжаться"
                    : `На конец ${monthName(month).toLocaleLowerCase("ru")}`}
              </p>
              <div className="balance-bottom">
                <span>
                  <i />
                  <span>В вашем ритме</span>
                </span>
                <DollarSign size={32} strokeWidth={1.1} />
              </div>
              <div className="balance-orb orb-one" />
              <div className="balance-orb orb-two" />
            </section>
            {metric("income")}
            {metric("expense")}
            <div className="wealth-strip glass">
              <div>
                <span className="wealth-icon savings">
                  <Target size={19} />
                </span>
                <span>
                  <small>В накоплениях</small>
                  <strong>
                    {hidden ? "••• ₽" : <Money amount={balance.saved} />}
                  </strong>
                </span>
                <ArrowUpRight size={17} />
              </div>
              <span className="strip-divider" />
              <div>
                <span className="wealth-icon debt">
                  <CreditCard size={19} />
                </span>
                <span>
                  <small>Осталось вернуть</small>
                  <strong>
                    {hidden ? "••• ₽" : <Money amount={balance.debt} />}
                  </strong>
                </span>
                <ArrowUpRight size={17} />
              </div>
              <span className="strip-divider" />
              <div className="wealth-insight">
                <span className="wealth-icon">
                  <Leaf size={20} />
                </span>
                <span>
                  <strong>
                    {sum.income
                      ? `Вы сохранили ${Math.max(0, rate)}% доходов`
                      : "Начните с маленького шага"}
                  </strong>
                  <small>
                    {sum.income
                      ? rate >= 20
                        ? "Хорошая основа для ваших будущих планов"
                        : "Каждый месяц — возможность найти свой баланс"
                      : "Добавьте первую операцию, и картина начнет складываться"}
                  </small>
                </span>
              </div>
            </div>
            <Card className="flow-card">
              <CardHeading
                title="Движение денег"
                subtitle="Доходы и расходы за полгода"
              />
              <div className="chart-legend">
                <span>
                  <i className="income-dot" />
                  Доходы
                </span>
                <span>
                  <i className="expense-dot" />
                  Расходы
                </span>
                <span className="chart-period">
                  Последние 6 месяцев
                  <ChevronRight size={13} />
                </span>
              </div>
              <CashChart data={data} month={month} />
            </Card>
            <Card className="expenses-card">
              <CardHeading
                title="Куда уходят деньги"
                action="Подробнее"
                onAction={() => navigate("reports")}
              />
              <ExpenseChart data={data} period={month} />
            </Card>
            <Card className="recent-card">
              <CardHeading
                title="Последние операции"
                subtitle="Все начинается с простых записей"
                action="Все операции"
                onAction={() => navigate("transactions")}
              />
              <TransactionList
                transactions={sortedTransactions.slice(0, 5)}
                data={data}
                onEdit={editTransaction}
                compact
              />
            </Card>
            <Card className="goals-preview">
              <CardHeading
                title="К вашим мечтам"
                action="Все цели"
                onAction={() => navigate("goals")}
              />
              {data.savings.length ? (
                data.savings.slice(0, 2).map((goal) => (
                  <button
                    className="goal-preview-button"
                    key={goal.id}
                    onClick={() =>
                      setModal({ type: "transfer", debt: false, entity: goal })
                    }
                  >
                    <GoalCard
                      goal={goal}
                      data={data}
                      onTransfer={() => {}}
                      compact
                    />
                  </button>
                ))
              ) : (
                <Empty
                  title="Мечта становится планом"
                  description="Создайте первую цель накоплений."
                  action="Создать цель"
                  onAction={() => setModal({ type: "entity", debt: false })}
                  icon={Target}
                />
              )}
            </Card>
            <div className="insight-panel glass">
              <span className="insight-symbol">
                <Sparkles size={23} strokeWidth={1.5} />
              </span>
              <div>
                <span className="eyebrow">FINACC ЗАМЕЧАЕТ</span>
                <h3>{allInsights[0]?.title ?? "Все спокойно. Так держать!"}</h3>
                <p>
                  {allInsights[0]?.description ??
                    "Необычных расходов не обнаружено. Продолжайте записывать операции — это полезная привычка."}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="Посмотреть финансовые подсказки"
                onClick={() => {
                  setShowAllInsights(true);
                  navigate(allInsights[0]?.page ?? "reports");
                }}
              >
                <ArrowRight size={20} />
              </button>
            </div>
            <Card className="reminders-preview">
              <CardHeading
                title="Скоро по плану"
                action="Все напоминания"
                onAction={() => navigate("reminders")}
              />
              {upcoming.length ? (
                <div className="upcoming-list">
                  {upcoming.slice(0, 3).map((r) => reminderRow(r, true))}
                </div>
              ) : (
                <div className="quiet-reminder">
                  <CheckCheck size={20} />
                  <span>Все дела под контролем. Новых напоминаний нет.</span>
                </div>
              )}
            </Card>
          </div>
        )}

        {page === "transactions" && (
          <>
            <div className="two-metrics">
              <div className="mini-metric glass">
                <FlowIcon kind="income" />
                <span>
                  Поступило<strong>{<Money amount={sum.income} />}</strong>
                </span>
              </div>
              <div className="mini-metric glass">
                <FlowIcon kind="expense" />
                <span>
                  Потрачено<strong>{<Money amount={sum.expense} />}</strong>
                </span>
              </div>
            </div>
            <Card className="operations-card">
              <div className="filters">
                <label className="search-input">
                  <Search size={18} />
                  <input
                    aria-label="Поиск операций"
                    placeholder="Найти операцию…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="segmented operation-filter">
                  <button
                    className={kindFilter === "all" ? "active" : ""}
                    onClick={() => setKindFilter("all")}
                  >
                    Все
                  </button>
                  <button
                    className={kindFilter === "expense" ? "active" : ""}
                    onClick={() => setKindFilter("expense")}
                  >
                    Расходы
                  </button>
                  <button
                    className={kindFilter === "income" ? "active" : ""}
                    onClick={() => setKindFilter("income")}
                  >
                    Доходы
                  </button>
                </div>
                <label className="category-filter">
                  <SlidersHorizontal size={16} />
                  <select
                    aria-label="Фильтр по категории"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">Все категории</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <CardHeading
                title="История операций"
                subtitle={`${filtered.length} записей · ${monthName(month)}`}
              />
              {filtered.length ? (
                <TransactionList
                  transactions={filtered}
                  data={data}
                  onEdit={editTransaction}
                />
              ) : (
                <Empty
                  title={
                    selected.length
                      ? "Ничего не нашлось"
                      : "Начните свою историю"
                  }
                  description={
                    selected.length
                      ? "Измените запрос или выберите другую категорию."
                      : "Добавьте первую операцию за этот месяц."
                  }
                  action={selected.length ? undefined : "Добавить операцию"}
                  onAction={() => setModal({ type: "transaction" })}
                />
              )}
            </Card>
            {allInsights.some((i) => i.id.startsWith("duplicate")) && (
              <Card className="insights-list">
                <CardHeading title="Стоит проверить" />
                {allInsights
                  .filter((i) => i.id.startsWith("duplicate"))
                  .map((i) => (
                    <div className="analysis-row" key={i.id}>
                      <Activity size={19} />
                      <div>
                        <h3>{i.title}</h3>
                        <p>{i.description}</p>
                      </div>
                    </div>
                  ))}
              </Card>
            )}
          </>
        )}

        {page === "budget" && (
          <>
            <div className="budget-summary glass">
              <div>
                <span className="eyebrow">ВАШ ПЛАН НА МЕСЯЦ</span>
                <h2>
                  {<Money amount={budgetSpent} />}
                  <span> / {<Money amount={budgetTotal} />}</span>
                </h2>
                <p>
                  {budgetTotal
                    ? budgetSpent > budgetTotal
                      ? `Выше общего плана на ${money(budgetSpent - budgetTotal)}`
                      : `В пределах лимитов осталось ${money(budgetTotal - budgetSpent)}`
                    : "Задайте первый лимит, чтобы держать расходы в фокусе"}
                </p>
              </div>
              <div className="budget-summary-progress">
                <span>
                  {budgetTotal
                    ? Math.round((budgetSpent / budgetTotal) * 100)
                    : 0}
                  % плана использовано
                </span>
                <Progress
                  value={budgetTotal ? (budgetSpent / budgetTotal) * 100 : 0}
                  color={budgetSpent > budgetTotal ? "#ff9f9f" : undefined}
                  label="Использование бюджета"
                />
              </div>
            </div>
            <div className="section-intro">
              <h2>У каждой категории свой план</h2>
              <p>Ежемесячные лимиты · предупреждение при 80% и перерасходе</p>
            </div>
            <div className="budget-grid">
              {categories.map((c) => {
                const percent = c.limit ? (c.amount / c.limit) * 100 : 0;
                return (
                  <Card
                    className={`budget-card ${percent >= 100 ? "over-budget" : ""}`}
                    key={c.id}
                  >
                    <div className="budget-card-heading">
                      <CategoryIcon category={c} />
                      <h3>{c.name}</h3>
                      <button
                        className="icon-button"
                        aria-label={`Лимит: ${c.name}`}
                        onClick={() =>
                          setModal({ type: "budget", category: c })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                    <div className="budget-amount">
                      <strong>{<Money amount={c.amount} />}</strong>
                      <span>
                        {c.limit ? `из ${money(c.limit)}` : "лимит не задан"}
                      </span>
                    </div>
                    <Progress
                      value={percent}
                      color={
                        percent >= 100
                          ? "#ff9f9f"
                          : percent >= 80
                            ? "#f3be77"
                            : c.color
                      }
                      label={`Лимит ${c.name}`}
                    />
                    <div className="budget-caption">
                      {c.limit ? (
                        <>
                          <span>
                            {percent > 100
                              ? `Перерасход ${money(c.amount - c.limit)}`
                              : percent === 100
                                ? "Лимит использован"
                                : `Осталось ${money(c.limit - c.amount)}`}
                          </span>
                          <strong>{Math.round(percent)}%</strong>
                        </>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() =>
                            setModal({ type: "budget", category: c })
                          }
                        >
                          <Plus size={14} />
                          Задать лимит
                        </button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
            <p className="page-footnote">
              <ShieldCheck size={15} />
              Лимиты помогают планировать, а не ограничивают внесение операций.
              Расходы без лимита не входят в общий план.
            </p>
          </>
        )}

        {page === "goals" && (
          <>
            <div className="two-metrics">
              <div className="mini-metric glass">
                <span className="wealth-icon savings">
                  <Target size={22} />
                </span>
                <span>
                  Всего накоплено
                  <strong>{<Money amount={currentBalance.saved} />}</strong>
                </span>
              </div>
              <div className="mini-metric glass">
                <span className="wealth-icon debt">
                  <CreditCard size={22} />
                </span>
                <span>
                  Осталось вернуть
                  <strong>{<Money amount={currentBalance.debt} />}</strong>
                </span>
              </div>
            </div>
            <div className="section-toolbar">
              <div className="segmented">
                <button
                  className={goalTab === "saving" ? "active" : ""}
                  onClick={() => setGoalTab("saving")}
                >
                  <Target size={16} />
                  Накопления
                </button>
                <button
                  className={goalTab === "debt" ? "active" : ""}
                  onClick={() => setGoalTab("debt")}
                >
                  <CreditCard size={16} />
                  Долги
                </button>
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  setModal({ type: "entity", debt: goalTab === "debt" })
                }
              >
                <Plus size={16} />
                {goalTab === "saving" ? "Новая цель" : "Добавить долг"}
              </button>
            </div>
            <div className="goals-grid">
              {goalTab === "debt" && currentBalance.overdraft > 0 && (
                <Card>
                  <div className="goal-card">
                    <div className="goal-heading">
                      <span className="wealth-icon debt">
                        <CreditCard size={22} />
                      </span>
                      <div>
                        <h3>Долг по перерасходу</h3>
                        <p>Учтён автоматически</p>
                      </div>
                    </div>
                    <div className="goal-amount">
                      <strong>
                        <Money amount={currentBalance.overdraft} />
                      </strong>
                      <span>осталось погасить</span>
                    </div>
                    <p className="muted">
                      Поступления денег уменьшают этот долг. Исправление или
                      удаление операций пересчитывает его.
                    </p>
                  </div>
                </Card>
              )}
              {(goalTab === "saving" ? data.savings : data.debts).map(
                (entity) => (
                  <Card key={entity.id}>
                    <div className="entity-tools">
                      <button
                        className="icon-button"
                        aria-label={`Изменить: ${entity.name}`}
                        onClick={() =>
                          setModal({
                            type: "entity",
                            debt: goalTab === "debt",
                            entity,
                          })
                        }
                      >
                        <Pencil size={15} />
                      </button>
                    </div>
                    <GoalCard
                      goal={entity}
                      debt={goalTab === "debt"}
                      data={data}
                      onTransfer={() =>
                        setModal({
                          type: "transfer",
                          debt: goalTab === "debt",
                          entity,
                        })
                      }
                    />
                  </Card>
                ),
              )}
            </div>
            {(goalTab === "saving"
              ? data.savings.length === 0
              : data.debts.length === 0 && currentBalance.overdraft === 0) && (
              <Card>
                <Empty
                  title={
                    goalTab === "saving"
                      ? "Дайте мечте название"
                      : "Без долгов — тоже хороший план"
                  }
                  description={
                    goalTab === "saving"
                      ? "На поездку, подушку безопасности или что-то свое."
                      : "Добавьте текущий долг и отмечайте платежи."
                  }
                  icon={goalTab === "saving" ? Target : CreditCard}
                  action={
                    goalTab === "saving" ? "Создать цель" : "Добавить долг"
                  }
                  onAction={() =>
                    setModal({ type: "entity", debt: goalTab === "debt" })
                  }
                />
              </Card>
            )}
            <Card className="movement-history">
              <CardHeading
                title="История переводов"
                subtitle="Взносы и выплаты хранятся отдельно от повседневных расходов"
              />
              {data.movements.filter((m) => m.entityType === goalTab).length ? (
                [...data.movements]
                  .reverse()
                  .filter((m) => m.entityType === goalTab)
                  .map((m) => (
                    <div className="movement-row" key={m.id}>
                      <span className="wealth-icon">
                        <ArrowUpRight size={18} />
                      </span>
                      <div>
                        <strong>
                          {
                            (goalTab === "saving"
                              ? data.savings
                              : data.debts
                            ).find((e) => e.id === m.entityId)?.name
                          }
                        </strong>
                        <span>
                          {m.entityType === "saving"
                            ? m.amount > 0
                              ? "Пополнение"
                              : "Снятие"
                            : m.amount > 0
                              ? "Платеж"
                              : "Получение"}{" "}
                          ·{" "}
                          {new Date(`${m.date}T12:00:00`).toLocaleDateString(
                            "ru-RU",
                          )}
                        </span>
                      </div>
                      <strong>{<Money amount={Math.abs(m.amount)} />}</strong>
                      <button
                        className="icon-button subtle"
                        aria-label={`Удалить перевод ${money(Math.abs(m.amount))}`}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Удалить перевод? Остатки будут пересчитаны.",
                            )
                          )
                            commit((d) => ({
                              ...d,
                              movements: d.movements.filter(
                                (item) => item.id !== m.id,
                              ),
                            })).catch(showError);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
              ) : (
                <p className="muted history-empty">
                  Здесь появятся ваши пополнения и платежи.
                </p>
              )}
            </Card>
            <p className="page-footnote">
              <LockKeyhole size={15} />
              Здесь показаны текущие остатки за все время. Снимок на конец
              выбранного месяца доступен в отчете.
            </p>
          </>
        )}

        {page === "reports" && (
          <>
            <div className="section-toolbar report-toolbar">
              <div className="segmented">
                <button
                  className={!annual ? "active" : ""}
                  onClick={() => setAnnual(false)}
                >
                  За месяц
                </button>
                <button
                  className={annual ? "active" : ""}
                  onClick={() => setAnnual(true)}
                >
                  За год
                </button>
              </div>
              <span className="muted">
                {annual ? `${period} год` : monthName(month)} · в сравнении с{" "}
                {annual ? "прошлым годом" : "прошлым месяцем"}
              </span>
            </div>
            <div className="report-metrics">
              {metric("income")}
              {metric("expense")}
              <Card className="metric-card">
                <div className="metric-title">
                  <span>Разница</span>
                  <span className="flow-icon income">
                    <TrendingUp size={18} />
                  </span>
                </div>
                <div className="metric-value">
                  <strong>{<Money amount={sum.income - sum.expense} />}</strong>
                </div>
                <p className="metric-change">
                  {sum.income > 0
                    ? `${Math.abs(rate)}% от доходов ${rate >= 0 ? "сохранено" : "сверх доходов потрачено"}`
                    : "Доходы минус расходы"}
                </p>
              </Card>
            </div>
            <div className="report-charts">
              <Card className="flow-card">
                <CardHeading
                  title="Доходы и расходы"
                  subtitle={
                    annual
                      ? "Как менялся ваш ритм в течение года"
                      : "Шесть месяцев в одной картине"
                  }
                />
                <div className="chart-legend">
                  <span>
                    <i className="income-dot" />
                    Доходы
                  </span>
                  <span>
                    <i className="expense-dot" />
                    Расходы
                  </span>
                </div>
                <CashChart data={data} month={month} year={annual} />
              </Card>
              <Card>
                <CardHeading title="Структура расходов" />
                <ExpenseChart data={data} period={period} />
              </Card>
            </div>
            <Card className="comparison-card">
              <CardHeading
                title="Что изменилось"
                subtitle="Сравнение выбранных календарных периодов"
              />
              <div className="comparison-table-wrap">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Показатель</th>
                      <th>{annual ? period : monthName(month)}</th>
                      <th>
                        {annual
                          ? previousPeriod(period)
                          : monthName(previousPeriod(period))}
                      </th>
                      <th>Изменение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Доходы", sum.income, prior.income],
                      ["Расходы", sum.expense, prior.expense],
                      [
                        "Разница",
                        sum.income - sum.expense,
                        prior.income - prior.expense,
                      ],
                    ].map(([label, current, before]) => {
                      const change = changePercent(
                        Number(current),
                        Number(before),
                      );
                      return (
                        <tr key={label}>
                          <td>{label}</td>
                          <td>{<Money amount={Number(current)} />}</td>
                          <td>{<Money amount={Number(before)} />}</td>
                          <td>
                            {change === null
                              ? "Нет базы сравнения"
                              : `${change > 0 ? "+" : ""}${change}%`}
                          </td>
                        </tr>
                      );
                    })}
                    {(["saved", "debt"] as const).map((key) => {
                      const before = balances(
                        data,
                        periodEnd(previousPeriod(period)),
                      )[key];
                      return (
                        <tr key={key}>
                          <td>
                            {key === "saved"
                              ? "Накопления на конец периода"
                              : "Долги на конец периода"}
                          </td>
                          <td>{<Money amount={balance[key]} />}</td>
                          <td>{<Money amount={before} />}</td>
                          <td>
                            {balance[key] - before > 0 ? "+" : ""}
                            {<Money amount={balance[key] - before} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="insights-list">
              <CardHeading
                title="Внимание к деталям"
                subtitle="Подсказки по операциям выбранного месяца"
                action={
                  allInsights.length > 3
                    ? showAllInsights
                      ? "Свернуть"
                      : "Показать все"
                    : undefined
                }
                onAction={() => setShowAllInsights(!showAllInsights)}
              />
              {allInsights.length ? (
                allInsights
                  .slice(0, showAllInsights ? undefined : 3)
                  .map((i) => (
                    <button
                      className="analysis-row"
                      key={i.id}
                      onClick={() => navigate(i.page)}
                    >
                      <span className={`analysis-icon ${i.severity}`}>
                        <Activity size={19} />
                      </span>
                      <div>
                        <h3>{i.title}</h3>
                        <p>{i.description}</p>
                      </div>
                      <ArrowRight size={17} />
                    </button>
                  ))
              ) : (
                <div className="quiet-reminder">
                  <ShieldCheck size={22} />
                  <span>Необычных операций не обнаружено.</span>
                </div>
              )}
              <p className="analysis-note">
                Повторы: одинаковые сумма, описание и категория за 48 часов.
                Рост: от 50% и 3 000 ₽ к прошлому месяцу. Крупные платежи: от 10
                000 ₽ и трех средних прошлых расходов.
              </p>
            </Card>
            <div className="backup-panel glass">
              <span className="wealth-icon">
                <FileText size={24} />
              </span>
              <div>
                <h3>Ваши данные всегда с вами</h3>
                <p>
                  CSV — для таблиц. JSON — полная копия операций, целей, лимитов
                  и напоминаний.
                </p>
              </div>
              <div className="backup-actions">
                <button
                  className="button secondary"
                  disabled={exportBusy}
                  onClick={() => exportFile(true)}
                >
                  <Download size={16} />
                  Сохранить копию
                </button>
                <button className="button ghost" onClick={importFile}>
                  <Upload size={16} />
                  Восстановить
                </button>
              </div>
            </div>
          </>
        )}

        {page === "reminders" && (
          <>
            <div className="notification-settings glass">
              <span className="notification-settings-icon">
                <Bell size={24} strokeWidth={1.5} />
              </span>
              <div>
                <h3>
                  {data.notifications
                    ? "Напоминания включены"
                    : "Пусть важное приходит вовремя"}
                </h3>
                <p>
                  {android
                    ? data.demo
                      ? "Сначала начните свой учет. Демоуведомления не отправляются."
                      : "Android напомнит о платежах, даже когда приложение закрыто."
                    : "В браузере напоминания видны здесь. Фоновые уведомления доступны на Android."}
                </p>
              </div>
              <button
                className={`button ${data.notifications ? "secondary" : "primary"}`}
                disabled={data.demo || !android}
                onClick={async () => {
                  try {
                    if (!data.notifications) await enableNotifications();
                    await commit((d) => ({
                      ...d,
                      notifications: !d.notifications,
                    }));
                  } catch (e) {
                    showError(e);
                  }
                }}
              >
                {data.notifications ? "Отключить" : "Включить"}
              </button>
            </div>
            <div className="section-toolbar">
              <div className="segmented">
                <button
                  className={!showDone ? "active" : ""}
                  onClick={() => setShowDone(false)}
                >
                  Предстоящие <span>{upcoming.length}</span>
                </button>
                <button
                  className={showDone ? "active" : ""}
                  onClick={() => setShowDone(true)}
                >
                  Готово <span>{doneCount}</span>
                </button>
              </div>
              <button
                className="button secondary"
                onClick={() => setModal({ type: "reminder" })}
              >
                <Plus size={17} />
                Напоминание
              </button>
            </div>
            <Card className="reminder-page-list">
              {(showDone ? data.reminders.filter((r) => r.done) : upcoming)
                .length ? (
                (showDone
                  ? data.reminders.filter((r) => r.done)
                  : upcoming
                ).map((r) => reminderRow(r))
              ) : (
                <Empty
                  title={
                    showDone ? "Все еще впереди" : "Можно спокойно выдохнуть"
                  }
                  description={
                    showDone
                      ? "Выполненные напоминания появятся здесь."
                      : "Добавьте важный счет, платеж по кредиту или взнос в накопления."
                  }
                  icon={Bell}
                  action={showDone ? undefined : "Создать напоминание"}
                  onAction={() => setModal({ type: "reminder" })}
                />
              )}
            </Card>
            <p className="page-footnote">
              <CheckCheck size={16} />
              Отметка о выполнении не создает финансовую операцию. Внесите
              платеж или взнос отдельно.
            </p>
          </>
        )}
        <footer className="page-footer">
          <span>
            <DollarSign size={15} />
            finacc — больше ясности, меньше забот
          </span>
          <span>
            <LockKeyhole size={12} />
            Ваши финансы остаются вашими
          </span>
        </footer>
      </main>
      <nav className="mobile-nav glass" aria-label="Мобильная навигация">
        {navigation
          .filter((n) => n.id !== "reminders")
          .map(({ id, short, icon: Icon }) => (
            <button
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              key={id}
              onClick={() => navigate(id)}
            >
              <Icon size={21} strokeWidth={1.7} />
              <span>{short}</span>
            </button>
          ))}
      </nav>
      {toast && (
        <div
          className={`toast glass ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Закрыть сообщение"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && renderModal()}
    </div>
  );

  function renderModal() {
    if (!modal || !data) return null;
    let title = "",
      description = "";
    let content: ReactNode;
    switch (modal.type) {
      case "transaction":
        title = modal.transaction ? "Детали операции" : "Новая операция";
        description = "Пара деталей — и все на своих местах.";
        content = (
          <TransactionForm
            data={data}
            transaction={modal.transaction}
            commit={commit}
            close={close}
          />
        );
        break;
      case "budget":
        title = modal.category.name;
        description = "Сколько комфортно потратить за месяц?";
        content = (
          <BudgetForm
            category={modal.category}
            data={data}
            commit={commit}
            close={close}
          />
        );
        break;
      case "entity":
        title = modal.entity
          ? "Изменить план"
          : modal.debt
            ? "Добавить долг"
            : "Начнем с мечты";
        content = (
          <EntityForm
            debt={modal.debt}
            entity={modal.entity}
            commit={commit}
            close={close}
          />
        );
        break;
      case "transfer":
        title = modal.entity.name;
        description = modal.debt
          ? "Еще один шаг к свободе от долгов."
          : "Каждый взнос приближает к цели.";
        content = (
          <TransferForm
            data={data}
            entity={modal.entity}
            debt={modal.debt}
            commit={commit}
            close={close}
          />
        );
        break;
      case "reminder":
        title = modal.reminder ? "Изменить напоминание" : "Напомнить о важном";
        content = (
          <ReminderForm
            reminder={modal.reminder}
            commit={commit}
            close={close}
          />
        );
        break;
      case "settings":
        title = "Ваше пространство";
        content = (
          <>
            <SettingsForm data={data} commit={commit} close={close} />
            <div className="settings-backup">
              <h3>Резервные копии</h3>
              <p>
                Сохраните JSON-копию, чтобы перенести учет на другое устройство.
              </p>
              <button
                className="button secondary full-width"
                disabled={exportBusy}
                onClick={() => exportFile(true)}
              >
                <Download size={16} />
                Сохранить резервную копию
              </button>
              <button className="button ghost full-width" onClick={importFile}>
                <Upload size={16} />
                Восстановить из файла
              </button>
            </div>
          </>
        );
        break;
      case "start":
        title = "Ваш finacc начинается здесь";
        description =
          "Демооперации, цели и напоминания будут убраны. Стандартные категории останутся.";
        content = (
          <SubmitForm
            label="Начать с чистого листа"
            onSubmit={async () => {
              await commit(() => emptyData());
              setMonth(monthKey());
              close();
            }}
          >
            <p className="form-hint">
              <Leaf size={20} />
              После старта укажите начальный остаток в настройках и добавьте
              первую операцию. Все данные сохраняются на вашем устройстве.
            </p>
          </SubmitForm>
        );
        break;
      case "import": {
        const backup = modal.data;
        title = "Восстановить учет";
        description =
          "Текущие данные будут полностью заменены содержимым файла. Сначала сохраните копию, если хотите их оставить.";
        content = (
          <SubmitForm
            label="Заменить данные"
            onSubmit={async () => {
              await commit(() => ({ ...backup, notifications: false }));
              close();
            }}
          >
            <div className="import-summary">
              <span>
                Операции<strong>{backup.transactions.length}</strong>
              </span>
              <span>
                Цели и долги
                <strong>{backup.savings.length + backup.debts.length}</strong>
              </span>
              <span>
                Напоминания<strong>{backup.reminders.length}</strong>
              </span>
            </div>
            <button
              className="button secondary full-width"
              type="button"
              disabled={exportBusy}
              onClick={() => exportFile(true)}
            >
              <Download size={16} />
              Сначала сохранить текущую копию
            </button>
            <p className="form-hint">
              После восстановления уведомления нужно включить заново.
            </p>
          </SubmitForm>
        );
        break;
      }
      case "help":
        title = "Деньги любят ясность";
        content = (
          <div className="help-content">
            <p>
              finacc помогает вести личный учет в рублях без регистрации и
              подключения банков.
            </p>
            <div>
              <Wallet size={21} />
              <span>
                <strong>Записывайте как удобно</strong>Выбирайте категорию,
                указывайте сумму и описание. Собственную категорию можно
                добавить прямо при вводе.
              </span>
            </div>
            <div>
              <Flag size={21} />
              <span>
                <strong>Разделяйте расходы и планы</strong>Взносы в накопления и
                выплаты долгов меняют доступный остаток, но не дублируют
                повседневные доходы и расходы. Если денег не хватает, перерасход
                учитывается как долг и погашается новыми поступлениями.
              </span>
            </div>
            <div>
              <ShieldCheck size={21} />
              <span>
                <strong>Сохраняйте свою историю</strong>Данные находятся на
                устройстве. Делайте JSON-копии в настройках; CSV-отчеты
                открываются в электронных таблицах.
              </span>
            </div>
            <div>
              <Bell size={21} />
              <span>
                <strong>Помните о важном</strong>В Android можно включить
                системные уведомления. Время доставки зависит от разрешений и
                режима энергосбережения устройства.
              </span>
            </div>
          </div>
        );
        break;
    }
    return (
      <Modal
        key={modal.type + ("entity" in modal ? (modal.entity?.id ?? "") : "")}
        title={title}
        description={description}
        onClose={close}
      >
        {content}
      </Modal>
    );
  }
}
