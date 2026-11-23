import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDownLeft,
  BarChart3,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  DollarSign,
  Download,
  Flag,
  LayoutDashboard,
  LockKeyhole,
  Plus,
  Settings2,
  ShieldCheck,
  Target,
  Upload,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Modal,
  PinLockScreen,
  QrScannerModal,
  ReminderIcon,
  SubmitForm,
} from "./components";
import { ExchangeRateBar, Money, useCurrency, useMoney } from "./currency";
import {
  balances,
  currentPeriodMonth,
  dateKey,
  decodeData,
  exportCsv,
  insights,
  monthKey,
  monthName,
  periodBounds,
  periodEnd,
  periodTransactions,
  previousPeriod,
  shiftMonth,
  totals,
  type Account,
  type Category,
  type Data,
  type Debt,
  type DebtDirection,
  type Page,
  type Reminder,
  type Saving,
  type Transaction,
} from "./domain";
import {
  AccountForm,
  AccountTransferForm,
  BudgetForm,
  CategoryManager,
  CsvImportForm,
  EncryptedExportForm,
  EncryptedRestoreForm,
  EntityForm,
  ReminderForm,
  SettingsForm,
  TransactionForm,
  TransferForm,
  type Commit,
  type TransactionDraft,
} from "./forms";
import { encryptBackup, isEncryptedBackup, type PinLockRecord } from "./crypto";
import { parseBankCsv, type BankCsvParseResult } from "./import";
import { BudgetPage } from "./pages/BudgetPage";
import { GoalsPage, type GoalTab } from "./pages/GoalsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RemindersPage } from "./pages/RemindersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import {
  android,
  clearPinLock,
  enableNotifications,
  hapticTap,
  loadData,
  loadPinLock,
  notifyBudget,
  persistData,
  pickBackupRaw,
  pickCsvText,
  saveFile,
  savePinLock,
  syncReminders,
} from "./platform";
import { checkForUpdate, type AppUpdate } from "./updates";

type ModalState =
  | { type: "transaction"; transaction?: Transaction; draft?: TransactionDraft }
  | { type: "qr" }
  | { type: "budget"; category: Category }
  | {
      type: "entity";
      debt: boolean;
      defaultDirection?: DebtDirection;
      entity?: Saving | Debt;
    }
  | { type: "transfer"; debt: boolean; entity: Saving | Debt }
  | { type: "account"; account?: Account }
  | { type: "account-transfer" }
  | { type: "categories" }
  | { type: "reminder"; reminder?: Reminder }
  | { type: "settings" }
  | { type: "help" }
  | { type: "import"; data: Data }
  | { type: "decrypt"; envelope: unknown }
  | { type: "encrypt-export" }
  | { type: "csv-import"; parsed: BankCsvParseResult };

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
    "Копите на мечты и управляйте долгами.",
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

const themeColors = {
  glass: "#050914",
  oled: "#000000",
  light: "#eef4fc",
} as const;

const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Не удалось выполнить действие. Попробуйте еще раз.";

export default function App() {
  const formatDual = useMoney();
  const { rate: exchangeRate, setSecondaryCurrency } = useCurrency();

  const [data, setData] = useState<Data | null>(null);
  const dataRef = useRef<Data | null>(null);
  const saving = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [pinLock, setPinLock] = useState<PinLockRecord | null>(null);
  const [unlocked, setUnlocked] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  const [page, setPage] = useState<Page>("overview");
  const [month, setMonth] = useState(monthKey());
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    error: boolean;
    undo?: () => Promise<void>;
  } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [goalTab, setGoalTab] = useState<GoalTab>("saving");
  const [annual, setAnnual] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  const modalRef = useRef<ModalState | null>(null);
  const pageRef = useRef<Page>("overview");
  const suppressNextPopRef = useRef(false);
  const initFlagsDoneRef = useRef(false);

  modalRef.current = modal;
  pageRef.current = page;

  const showError = useCallback(
    (error: unknown) => setToast({ text: errorMessage(error), error: true }),
    [],
  );

  const openModal = useCallback((next: ModalState) => {
    if (!window.history.state?.finaccModal) {
      window.history.pushState({ finaccModal: true }, "");
    }
    setModal(next);
  }, []);

  const close = useCallback(() => {
    setModal(null);
    if (window.history.state?.finaccModal) {
      suppressNextPopRef.current = true;
      window.history.back();
    }
  }, []);

  const navigate = useCallback((next: Page) => {
    hapticTap();
    if (next === "overview") {
      if (pageRef.current !== "overview" && window.history.state?.finaccPage) {
        suppressNextPopRef.current = true;
        window.history.back();
      }
    } else if (pageRef.current === "overview") {
      window.history.pushState({ finaccPage: next }, "");
    } else if (window.history.state?.finaccPage) {
      window.history.replaceState({ finaccPage: next }, "");
    } else {
      window.history.pushState({ finaccPage: next }, "");
    }
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false;
        return;
      }
      if (modalRef.current !== null) {
        setModal(null);
        return;
      }
      if (pageRef.current !== "overview") {
        setPage("overview");
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkForUpdate(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setUpdate(result);
      })
      .catch(() => {
        /* An offline release check must not interrupt local accounting. */
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadData(), loadPinLock()])
      .then(([result, lock]) => {
        if (!active) return;
        dataRef.current = result;
        setData(result);
        setPinLock(lock);
        setUnlocked(!lock);
        setAuthReady(true);
        if (!initFlagsDoneRef.current) {
          initFlagsDoneRef.current = true;
          setHidden(result.preferences.hideBalancesOnStart);
          setMonth(currentPeriodMonth(result.preferences.paydayDay));
        }
      })
      .catch((e) => {
        if (active) {
          setLoadError(errorMessage(e));
          setAuthReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    setSecondaryCurrency(data.preferences.secondaryCurrency);
    document.documentElement.dataset.theme = data.preferences.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", themeColors[data.preferences.theme]);
    }
  }, [data, setSecondaryCurrency]);

  useEffect(() => {
    if (!toast) return;
    const duration = toast.error ? 10000 : toast.undo ? 6000 : 4000;
    const timer = window.setTimeout(() => setToast(null), duration);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!data) return;
    syncReminders(data).catch(showError);
  }, [data?.reminders, data?.notifications, data?.demo, showError]);

  const commit: Commit = useCallback(
    async (updateFn) => {
      if (!dataRef.current || saving.current)
        throw new Error("Дождитесь сохранения предыдущего изменения.");
      saving.current = true;
      const before = dataRef.current;
      try {
        const next = updateFn(before);
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

  const period = annual && page === "reports" ? month.slice(0, 4) : month;
  const selected = useMemo(
    () => (data ? periodTransactions(data, period) : []),
    [data, period],
  );
  const sum = useMemo(() => totals(selected), [selected]);
  const prior = useMemo(
    () => (data ? totals(periodTransactions(data, previousPeriod(period))) : { income: 0, expense: 0 }),
    [data, period],
  );
  const balance = useMemo(
    () =>
      data
        ? balances(data, periodEnd(period, data.preferences.paydayDay))
        : { cash: 0, overdraft: 0, saved: 0, debt: 0, receivable: 0 },
    [data, period],
  );
  const currentBalance = useMemo(
    () =>
      data
        ? balances(data)
        : { cash: 0, overdraft: 0, saved: 0, debt: 0, receivable: 0 },
    [data],
  );
  const allInsights = useMemo(
    () => (data ? insights(data, month, formatDual, false) : []),
    [data, month, formatDual],
  );
  const upcoming = useMemo(
    () =>
      data
        ? data.reminders
            .filter((r) => !r.done)
            .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
        : [],
    [data],
  );
  const sortedTransactions = useMemo(() => {
    if (!data) return [];
    const orderMap = new Map(data.transactions.map((t, i) => [t.id, i]));
    return [...selected].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
        (orderMap.get(b.id) ?? 0) - (orderMap.get(a.id) ?? 0),
    );
  }, [data, selected]);

  if (loadError) {
    return (
      <div className="loading-screen">
        <div className="brand-icon">
          <DollarSign />
        </div>
        <h1>Не удалось прочитать данные</h1>
        <p>{loadError}</p>
        <p>Сохраненные данные не перезаписаны.</p>
        <button
          type="button"
          className="button primary"
          onClick={() => location.reload()}
        >
          Попробовать снова
        </button>
      </div>
    );
  }

  if (!data || !authReady) {
    return (
      <div className="loading-screen">
        <div className="brand-icon loading">
          <DollarSign />
        </div>
        <h1>finacc</h1>
        <p>Собираем вашу финансовую картину…</p>
      </div>
    );
  }

  if (pinLock && !unlocked) {
    return (
      <PinLockScreen
        lockRecord={pinLock}
        onUnlock={() => setUnlocked(true)}
      />
    );
  }

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
      const raw = await pickBackupRaw();
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (isEncryptedBackup(parsed)) {
        openModal({ type: "decrypt", envelope: parsed });
        return;
      }
      openModal({ type: "import", data: decodeData(parsed) });
    } catch (e) {
      showError(e);
    }
  }

  async function startCsvImport() {
    if (!data) return;
    try {
      const text = await pickCsvText();
      if (!text) return;
      const defaultAcc =
        data.accounts.find((a) => !a.archived)?.id ??
        data.accounts[0]?.id ??
        "main";
      const parsed = parseBankCsv(text, data.categories, defaultAcc);
      openModal({ type: "csv-import", parsed });
    } catch (e) {
      showError(e);
    }
  }

  const maxPeriodMonth = currentPeriodMonth(data.preferences.paydayDay);
  const periodLabel =
    data.preferences.paydayDay > 1
      ? periodBounds(month, data.preferences.paydayDay).label
      : monthName(month);

  const renderReminderCompact = (reminder: Reminder) => (
    <div className="reminder-row" key={reminder.id}>
      <ReminderIcon type={reminder.type} />
      <button
        type="button"
        className="reminder-info"
        onClick={() => openModal({ type: "reminder", reminder })}
      >
        <strong>{reminder.title}</strong>
        <span
          className={reminder.date < dateKey() && !reminder.done ? "warm" : ""}
        >
          {new Date(`${reminder.date}T12:00:00`).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
          })}
          {reminder.date < dateKey() && !reminder.done ? " · просрочено" : ""}
        </span>
      </button>
      {reminder.amount > 0 && (
        <strong className="reminder-amount">
          <Money amount={reminder.amount} />
        </strong>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar glass-floating">
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
            <DollarSign size={26} strokeWidth={2} />
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
              type="button"
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
            type="button"
            className="help-link"
            onClick={() => openModal({ type: "help" })}
          >
            <CircleHelp size={18} />
            Как устроен finacc
          </button>
          <button
            type="button"
            className="profile"
            onClick={() => openModal({ type: "settings" })}
          >
            <span className="avatar">
              {(data.name || "Я").slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{data.name || "Мой finacc"}</strong>
              <small>Настройки</small>
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
            {pinLock && (
              <button
                type="button"
                className="icon-button"
                aria-label="Заблокировать экран"
                title="Заблокировать"
                onClick={() => setUnlocked(false)}
              >
                <LockKeyhole size={19} strokeWidth={1.7} />
              </button>
            )}
            <button
              type="button"
              className="icon-button mobile-only-btn"
              aria-label="Как устроен finacc"
              onClick={() => openModal({ type: "help" })}
            >
              <CircleHelp size={20} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className={`icon-button notification-button ${page === "reminders" ? "selected" : ""}`}
              aria-label="Напоминания"
              onClick={() => navigate("reminders")}
            >
              <Bell size={20} strokeWidth={1.6} />
              {upcoming.length > 0 && <i />}
            </button>
            <button
              type="button"
              className="icon-button mobile-only-btn"
              aria-label="Настройки"
              onClick={() => openModal({ type: "settings" })}
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
            type="button"
            className="button primary add-operation"
            aria-label="Добавить операцию"
            onClick={() => openModal({ type: "transaction" })}
          >
            <Plus size={18} />
            <span>Добавить операцию</span>
          </button>
        </div>

        <div className="period-toolbar">
          <div className="period-selector glass-surface">
            <button
              type="button"
              className="icon-button"
              aria-label="Предыдущий период"
              disabled={month <= "1900-01"}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <label className="month-input-label">
              <span>{periodLabel}</span>
              <input
                aria-label="Отчетный месяц"
                type="month"
                value={month}
                min="1900-01"
                max={maxPeriodMonth}
                onChange={(e) => {
                  if (
                    /^\d{4}-\d{2}$/.test(e.target.value) &&
                    e.target.value >= "1900-01" &&
                    e.target.value <= maxPeriodMonth
                  )
                    setMonth(e.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label="Следующий период"
              disabled={month >= maxPeriodMonth}
              onClick={() => {
                const next = shiftMonth(month, 1);
                if (next <= maxPeriodMonth) setMonth(next);
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <span className="period-caption">
            {month === maxPeriodMonth
              ? "Ваш ритм в текущем периоде"
              : "Ваша финансовая история"}
          </span>
          <button
            type="button"
            className="export-link"
            disabled={exportBusy}
            onClick={() => void exportFile(false)}
          >
            <Download size={16} />
            <span>Экспорт CSV</span>
          </button>
        </div>

        <ExchangeRateBar />

        {update && (
          <div className="update-banner glass-surface" role="status">
            <span>Доступна новая версия finacc {update.version}</span>
            <a
              className="button primary small"
              href={update.url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (isTauri()) {
                  event.preventDefault();
                  openUrl(update.url).catch(showError);
                }
              }}
            >
              <Download size={15} />
              Скачать обновление
            </a>
          </div>
        )}

        {page === "overview" && (
          <OverviewPage
            data={data}
            month={month}
            hidden={hidden}
            onToggleHidden={() => setHidden((v) => !v)}
            balance={balance}
            sum={sum}
            prior={prior}
            sortedTransactions={sortedTransactions}
            allInsights={allInsights}
            upcoming={upcoming}
            onNavigate={navigate}
            onOpenGoals={(tab) => {
              setGoalTab(tab);
              navigate("goals");
            }}
            onSelectCategory={(categoryId) => {
              setCategoryFilter(categoryId);
              navigate("transactions");
            }}
            onAddTransaction={() => openModal({ type: "transaction" })}
            onEditTransaction={(transaction) =>
              openModal({ type: "transaction", transaction })
            }
            onAddAccount={() => openModal({ type: "account" })}
            onEditAccount={(account) => openModal({ type: "account", account })}
            onTransferAccounts={() => openModal({ type: "account-transfer" })}
            onNewGoal={() => openModal({ type: "entity", debt: false })}
            onTransferGoal={(entity) =>
              openModal({ type: "transfer", debt: false, entity })
            }
            onShowAllInsights={(targetPage) => navigate(targetPage)}
            renderReminderRow={renderReminderCompact}
          />
        )}

        {page === "transactions" && (
          <TransactionsPage
            data={data}
            month={month}
            sortedPeriodTransactions={sortedTransactions}
            allInsights={allInsights}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            onAddTransaction={(draft) =>
              openModal({ type: "transaction", draft })
            }
            onEditTransaction={(transaction) =>
              openModal({ type: "transaction", transaction })
            }
            onOpenQr={() => openModal({ type: "qr" })}
            onImportCsv={() => void startCsvImport()}
          />
        )}

        {page === "budget" && (
          <BudgetPage
            data={data}
            month={month}
            onSetLimit={(category) => openModal({ type: "budget", category })}
            onManageCategories={() => openModal({ type: "categories" })}
          />
        )}

        {page === "goals" && (
          <GoalsPage
            data={data}
            currentBalance={currentBalance}
            goalTab={goalTab}
            onGoalTabChange={setGoalTab}
            onNewEntity={(debt, defaultDirection) =>
              openModal({ type: "entity", debt, defaultDirection })
            }
            onEditEntity={(debt, entity) =>
              openModal({ type: "entity", debt, entity })
            }
            onTransfer={(debt, entity) =>
              openModal({ type: "transfer", debt, entity })
            }
            commit={commit}
            onError={showError}
          />
        )}

        {page === "reports" && (
          <ReportsPage
            data={data}
            month={month}
            annual={annual}
            onAnnualChange={setAnnual}
            exportBusy={exportBusy}
            onExportBackup={() => void exportFile(true)}
            onExportEncrypted={() => openModal({ type: "encrypt-export" })}
            onImportBackup={() => void importFile()}
            onImportCsv={() => void startCsvImport()}
            onSelectCategory={(categoryId) => {
              setCategoryFilter(categoryId);
              navigate("transactions");
            }}
            onNavigate={navigate}
            commit={commit}
            onError={showError}
          />
        )}

        {page === "reminders" && (
          <RemindersPage
            data={data}
            upcoming={upcoming}
            android={android}
            onEnableNotifications={enableNotifications}
            onEditReminder={(reminder) =>
              openModal({ type: "reminder", reminder })
            }
            onNewReminder={() => openModal({ type: "reminder" })}
            commit={commit}
            onError={showError}
            onPaid={(title) =>
              setToast({ text: `Оплачено: «${title}».`, error: false })
            }
          />
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

      <button
        type="button"
        className="button primary mobile-add-operation"
        aria-label="Добавить операцию"
        onClick={() => {
          hapticTap();
          openModal({ type: "transaction" });
        }}
      >
        <Plus size={24} />
      </button>

      <nav
        className="mobile-nav glass-floating"
        aria-label="Мобильная навигация"
      >
        {navigation
          .filter((n) => n.id !== "reminders")
          .map(({ id, short, icon: Icon }) => (
            <button
              type="button"
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              key={id}
              onClick={() => navigate(id)}
            >
              <Icon size={20} strokeWidth={1.75} />
              <span>{short}</span>
            </button>
          ))}
      </nav>

      {toast && (
        <div
          className={`toast glass-floating ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className="toast-undo"
              onClick={() => {
                const undoFn = toast.undo;
                setToast(null);
                undoFn?.().catch(showError);
              }}
            >
              Отменить
            </button>
          )}
          <button
            type="button"
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

    if (modal.type === "qr") {
      return (
        <QrScannerModal
          onClose={close}
          onApply={(qr) => {
            setModal({
              type: "transaction",
              draft: {
                kind: "expense",
                amount: qr.amount,
                date: qr.date,
                title: qr.title,
                note: qr.note,
              },
            });
          }}
        />
      );
    }

    let title = "";
    let description = "";
    let content: ReactNode;

    switch (modal.type) {
      case "transaction":
        title = modal.transaction ? "Детали операции" : "Новая операция";
        description = "Пара деталей — и все на своих местах.";
        content = (
          <TransactionForm
            data={data}
            transaction={modal.transaction}
            draft={modal.draft}
            commit={commit}
            close={close}
            onOpenQr={() => setModal({ type: "qr" })}
            onDeleted={(deleted) =>
              setToast({
                text: `Удалена операция «${deleted.title}».`,
                error: false,
                undo: () =>
                  commit((d) => ({
                    ...d,
                    transactions: [...d.transactions, deleted],
                  })),
              })
            }
          />
        );
        break;
      case "account":
        title = modal.account ? "Настройки счета" : "Новый счет";
        description = "Разделяйте карты, наличные и накопительные счета.";
        content = (
          <AccountForm
            data={data}
            account={modal.account}
            commit={commit}
            close={close}
          />
        );
        break;
      case "account-transfer":
        title = "Перевод между счетами";
        description = "Перемещение ваших денег без учета в расходах.";
        content = (
          <AccountTransferForm data={data} commit={commit} close={close} />
        );
        break;
      case "categories":
        title = "Категории операций";
        description = "Меняйте названия, цвета и иконки или удаляйте лишнее.";
        content = <CategoryManager data={data} commit={commit} />;
        break;
      case "budget":
        title = modal.category.name;
        description = "Сколько комфортно потратить за период?";
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
            ? "Запись о долге"
            : "Начнем с мечты";
        content = (
          <EntityForm
            debt={modal.debt}
            defaultDirection={modal.defaultDirection}
            entity={modal.entity}
            commit={commit}
            close={close}
          />
        );
        break;
      case "transfer":
        title = modal.entity.name;
        description = modal.debt
          ? "Операция изменит остаток долга и доступный баланс."
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
            data={data}
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
            <SettingsForm
              data={data}
              commit={commit}
              close={close}
              hasPinLock={Boolean(pinLock)}
              onSavePin={async (record) => {
                await savePinLock(record);
                setPinLock(record);
              }}
              onClearPin={async () => {
                await clearPinLock();
                setPinLock(null);
              }}
              onManageCategories={() => setModal({ type: "categories" })}
            />
            <div className="settings-backup">
              <h3>Резервные копии и импорт</h3>
              <p>
                Сохраните JSON-копию (обычную или с паролем) для переноса на
                другое устройство.
              </p>
              <button
                type="button"
                className="button secondary full-width"
                disabled={exportBusy}
                onClick={() => void exportFile(true)}
              >
                <Download size={16} />
                Сохранить JSON-копию
              </button>
              <button
                type="button"
                className="button secondary full-width"
                disabled={exportBusy}
                onClick={() => setModal({ type: "encrypt-export" })}
              >
                <LockKeyhole size={16} />
                Зашифрованная копия (с паролем)
              </button>
              <button
                type="button"
                className="button ghost full-width"
                onClick={() => void importFile()}
              >
                <Upload size={16} />
                Восстановить из JSON-файла
              </button>
              <button
                type="button"
                className="button ghost full-width"
                onClick={() => void startCsvImport()}
              >
                <Upload size={16} />
                Импорт операций из CSV
              </button>
            </div>
          </>
        );
        break;
      case "encrypt-export":
        title = "Зашифрованная копия";
        description = "Защитите резервную копию перед отправкой в облако.";
        content = (
          <EncryptedExportForm
            data={data}
            onExportEncrypted={async (passphrase) => {
              const json = await encryptBackup(data, passphrase);
              const saved = await saveFile(
                `finacc-encrypted-${dateKey()}.json`,
                json,
                "json",
              );
              if (saved) {
                setToast({
                  text: "Зашифрованная копия сохранена.",
                  error: false,
                });
                close();
              }
            }}
          />
        );
        break;
      case "decrypt":
        title = "Зашифрованная копия";
        description = "Введите пароль для проверки и просмотра содержимого.";
        content = (
          <EncryptedRestoreForm
            envelope={modal.envelope}
            onDecrypted={(restored) =>
              setModal({ type: "import", data: restored })
            }
          />
        );
        break;
      case "csv-import":
        title = "Импорт CSV";
        description = "Проверьте количество найденных операций перед записью.";
        content = (
          <CsvImportForm
            data={data}
            parsed={modal.parsed}
            commit={commit}
            close={close}
            onImported={(count) =>
              setToast({
                text: `Импортировано операций: ${count}.`,
                error: false,
              })
            }
          />
        );
        break;
      case "import": {
        const backup = modal.data;
        title = "Восстановить учет";
        description =
          "Текущие данные будут полностью заменены содержимым файла.";
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
                Счета<strong>{backup.accounts.length}</strong>
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
              onClick={() => void exportFile(true)}
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
              finacc помогает вести личный учет локально, без регистрации и
              передачи данных в облако.
            </p>
            <div>
              <Wallet size={21} />
              <span>
                <strong>Быстрый ввод и калькулятор</strong>Поле суммы понимает
                арифметику (`450+180`, `1200/2`), а чеки можно добавлять через
                QR-сканер ФНС или импорт CSV.
              </span>
            </div>
            <div>
              <Flag size={21} />
              <span>
                <strong>Счета, цели и долги</strong>Разделяйте карты и наличные,
                откладывайте на цели и учитывайте как свои долги, так и деньги,
                которые должны вам.
              </span>
            </div>
            <div>
              <ShieldCheck size={21} />
              <span>
                <strong>Приватность и резервные копии</strong>Можно включить
                PIN-код и сохранять зашифрованные AES-GCM резервные копии.
              </span>
            </div>
            <div>
              <Bell size={21} />
              <span>
                <strong>Повторяющиеся напоминания</strong>Создавайте регулярные
                счета и оплачивайте их в одно касание прямо из списка.
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
