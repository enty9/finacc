import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CreditCard,
  DollarSign,
  Eye,
  EyeOff,
  Gauge,
  Landmark,
  Leaf,
  Plus,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react";
import { CashChart, ExpenseChart, Sparkline } from "../charts";
import {
  Card,
  CardHeading,
  Empty,
  FlowIcon,
  GoalCard,
  TransactionList,
} from "../components";
import { Money, useMoney } from "../currency";
import {
  accountBalance,
  changePercent,
  currentPeriodMonth,
  monthName,
  periodBounds,
  periodTransactions,
  safeToSpend,
  shiftMonth,
  totals,
  type Account,
  type Data,
  type Insight,
  type Page,
  type Reminder,
  type Saving,
  type Transaction,
} from "../domain";

export function OverviewPage({
  data,
  month,
  hidden,
  onToggleHidden,
  balance,
  sum,
  prior,
  sortedTransactions,
  allInsights,
  upcoming,
  onNavigate,
  onOpenGoals,
  onSelectCategory,
  onAddTransaction,
  onEditTransaction,
  onAddAccount,
  onEditAccount,
  onTransferAccounts,
  onNewGoal,
  onTransferGoal,
  onShowAllInsights,
  renderReminderRow,
}: {
  data: Data;
  month: string;
  hidden: boolean;
  onToggleHidden: () => void;
  balance: {
    cash: number;
    overdraft: number;
    saved: number;
    debt: number;
    receivable: number;
  };
  sum: { income: number; expense: number };
  prior: { income: number; expense: number };
  sortedTransactions: Transaction[];
  allInsights: Insight[];
  upcoming: Reminder[];
  onNavigate: (page: Page) => void;
  onOpenGoals: (tab: "saving" | "debt" | "owed") => void;
  onSelectCategory: (categoryId: string) => void;
  onAddTransaction: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onAddAccount: () => void;
  onEditAccount: (acc: Account) => void;
  onTransferAccounts: () => void;
  onNewGoal: () => void;
  onTransferGoal: (goal: Saving) => void;
  onShowAllInsights: (page: Page) => void;
  renderReminderRow: (r: Reminder, compact?: boolean) => React.ReactNode;
}) {
  const formatDual = useMoney();
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const activeSavings = data.savings.filter((s) => !s.archived);
  const currentCycle = currentPeriodMonth(data.preferences.paydayDay);
  const bounds = periodBounds(month, data.preferences.paydayDay);
  const safe = safeToSpend(data, month);
  const savingRate =
    sum.income > 0
      ? Math.round(((sum.income - sum.expense) / sum.income) * 100)
      : 0;

  const renderMetric = (kind: "income" | "expense") => {
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
          <strong>{hidden ? "••• ₽" : <Money amount={sum[kind]} />}</strong>
          <Sparkline expense={kind === "expense"} values={values} />
        </div>
        <p className="metric-change">
          {change !== null ? (
            <>
              <span
                className={
                  (kind === "income" ? change >= 0 : change <= 0)
                    ? "positive"
                    : "expense-text"
                }
              >
                {change > 0 ? "+" : ""}
                {change}%
              </span>{" "}
              к прошлому периоду
            </>
          ) : (
            <>За {bounds.label.toLocaleLowerCase("ru")}</>
          )}
        </p>
      </Card>
    );
  };

  return (
    <div className="overview-grid">
      <section className="balance-card glass-floating">
        <div className="balance-top">
          <span>
            <span className="balance-wallet">
              <Wallet size={18} />
            </span>
            Доступный остаток
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={hidden ? "Показать остаток" : "Скрыть остаток"}
            onClick={onToggleHidden}
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
            : month === currentCycle
              ? data.preferences.paydayDay > 1
                ? `Цикл ${bounds.label}`
                : "Деньги, которыми можно распоряжаться"
              : `На конец ${monthName(month).toLocaleLowerCase("ru")}`}
        </p>
        <div className="balance-bottom">
          <span>
            <i />
            <span>В вашем ритме</span>
          </span>
          <DollarSign size={30} strokeWidth={1.1} />
        </div>
        <div className="balance-orb orb-one" />
        <div className="balance-orb orb-two" />
      </section>

      {renderMetric("income")}
      {renderMetric("expense")}

      <div className="safe-spend-card glass-surface">
        <div className="safe-spend-main">
          <span className="wealth-icon">
            <Gauge size={20} />
          </span>
          <div>
            <small className="muted">
              Можно тратить в день ({safe.source === "budget" ? "по лимитам" : "по остатку"})
            </small>
            <strong>
              {hidden ? "••• ₽" : <Money amount={safe.dailySafe} />}
            </strong>
          </div>
        </div>
        <div className="safe-spend-meta">
          <span>
            Осталось дней: <strong>{safe.daysLeft}</strong>
          </span>
          {safe.upcomingBills > 0 && (
            <span>
              Счета в периоде:{" "}
              <strong>
                {hidden ? "•••" : formatDual(safe.upcomingBills)}
              </strong>
            </span>
          )}
          {safe.projectedExpense > 0 && (
            <span>
              Прогноз расходов:{" "}
              <strong>
                {hidden ? "•••" : formatDual(safe.projectedExpense)}
              </strong>
            </span>
          )}
        </div>
      </div>

      <div className="accounts-strip" aria-label="Счета">
        {activeAccounts.map((acc) => {
          const accBal = accountBalance(data, acc.id);
          return (
            <button
              type="button"
              key={acc.id}
              className="account-pill glass-surface"
              onClick={() => onEditAccount(acc)}
            >
              <span className="account-pill-head">
                <i
                  className="account-dot"
                  style={{ background: acc.color }}
                />
                <span>{acc.name}</span>
              </span>
              <strong className={accBal < 0 ? "expense-text" : ""}>
                {hidden ? "••• ₽" : <Money amount={accBal} />}
              </strong>
            </button>
          );
        })}
        <div className="account-pill-actions">
          <button
            type="button"
            className="button secondary small"
            onClick={onAddAccount}
          >
            <Plus size={14} />
            Счет
          </button>
          {activeAccounts.length >= 2 && (
            <button
              type="button"
              className="button secondary small"
              onClick={onTransferAccounts}
            >
              <ArrowLeftRight size={14} />
              Перевод
            </button>
          )}
        </div>
      </div>

      <div className="wealth-strip glass-surface">
        <button
          type="button"
          className="wealth-strip-item"
          onClick={() => onOpenGoals("saving")}
        >
          <span className="wealth-icon savings">
            <Target size={19} />
          </span>
          <span>
            <small>В накоплениях</small>
            <strong>
              {hidden ? "••• ₽" : <Money amount={balance.saved} />}
            </strong>
          </span>
          <ArrowUpRight size={16} />
        </button>
        <span className="strip-divider" />
        <button
          type="button"
          className="wealth-strip-item"
          onClick={() => onOpenGoals("debt")}
        >
          <span className="wealth-icon debt">
            <CreditCard size={19} />
          </span>
          <span>
            <small>Осталось вернуть</small>
            <strong>
              {hidden ? "••• ₽" : <Money amount={balance.debt} />}
            </strong>
          </span>
          <ArrowUpRight size={16} />
        </button>
        {balance.receivable > 0 && (
          <>
            <span className="strip-divider" />
            <button
              type="button"
              className="wealth-strip-item"
              onClick={() => onOpenGoals("owed")}
            >
              <span className="wealth-icon receivable">
                <Landmark size={19} />
              </span>
              <span>
                <small>Мне должны</small>
                <strong>
                  {hidden ? "••• ₽" : <Money amount={balance.receivable} />}
                </strong>
              </span>
              <ArrowUpRight size={16} />
            </button>
          </>
        )}
        <span className="strip-divider" />
        <div className="wealth-strip-item wealth-insight">
          <span className="wealth-icon">
            <Leaf size={19} />
          </span>
          <span>
            <strong>
              {sum.income
                ? `Вы сохранили ${Math.max(0, savingRate)}% доходов`
                : "Начните с маленького шага"}
            </strong>
            <small>
              {sum.income
                ? savingRate >= 20
                  ? "Хорошая основа для будущих планов"
                  : "Каждый период — шаг к балансу"
                : "Добавьте первую операцию, чтобы увидеть динамику"}
            </small>
          </span>
        </div>
      </div>

      <Card className="flow-card">
        <CardHeading
          title="Движение денег"
          subtitle="Нажмите на месяц, чтобы увидеть точные суммы"
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
          <span className="chart-period">Последние 6 месяцев</span>
        </div>
        <CashChart data={data} month={month} />
      </Card>

      <Card className="expenses-card">
        <CardHeading
          title="Куда уходят деньги"
          action="Подробнее"
          onAction={() => onNavigate("reports")}
        />
        <ExpenseChart
          data={data}
          period={month}
          onSelectCategory={onSelectCategory}
        />
      </Card>

      <Card className="recent-card">
        <CardHeading
          title="Последние операции"
          subtitle="Все начинается с простых записей"
          action="Все операции"
          onAction={() => onNavigate("transactions")}
        />
        {sortedTransactions.length ? (
          <TransactionList
            transactions={sortedTransactions.slice(0, 5)}
            data={data}
            onEdit={onEditTransaction}
            compact
          />
        ) : (
          <Empty
            title="Пока нет операций"
            description="Добавьте доход или расход — здесь появится ваша история."
            action="Добавить операцию"
            onAction={onAddTransaction}
          />
        )}
      </Card>

      <Card className="goals-preview">
        <CardHeading
          title="К вашим мечтам"
          action="Все цели"
          onAction={() => onOpenGoals("saving")}
        />
        {activeSavings.length ? (
          activeSavings.slice(0, 2).map((goal) => (
            <button
              type="button"
              className="goal-preview-button"
              key={goal.id}
              onClick={() => onTransferGoal(goal)}
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
            onAction={onNewGoal}
            icon={Target}
          />
        )}
      </Card>

      <div className="insight-panel glass-surface">
        <span className="insight-symbol">
          <Sparkles size={22} strokeWidth={1.6} />
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
          type="button"
          className="icon-button"
          aria-label="Посмотреть финансовые подсказки"
          onClick={() => onShowAllInsights(allInsights[0]?.page ?? "reports")}
        >
          <ArrowRight size={20} />
        </button>
      </div>

      <Card className="reminders-preview">
        <CardHeading
          title="Скоро по плану"
          action="Все напоминания"
          onAction={() => onNavigate("reminders")}
        />
        {upcoming.length ? (
          <div className="upcoming-list">
            {upcoming.slice(0, 3).map((r) => renderReminderRow(r, true))}
          </div>
        ) : (
          <div className="quiet-reminder">
            <CheckCheck size={20} />
            <span>Все дела под контролем. Новых напоминаний нет.</span>
          </div>
        )}
      </Card>
    </div>
  );
}
