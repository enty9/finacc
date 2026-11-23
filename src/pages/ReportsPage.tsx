import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Download,
  FileText,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { CashChart, ExpenseChart, Sparkline, SpendingHeatmap } from "../charts";
import { Card, CardHeading, FlowIcon } from "../components";
import { Money, useMoney } from "../currency";
import {
  balances,
  changePercent,
  insights,
  monthName,
  periodBounds,
  periodEnd,
  periodTransactions,
  previousPeriod,
  shiftMonth,
  totals,
  type Data,
  type Page,
} from "../domain";
import type { Commit } from "../forms";

export function ReportsPage({
  data,
  month,
  annual,
  onAnnualChange,
  exportBusy,
  onExportBackup,
  onExportEncrypted,
  onImportBackup,
  onImportCsv,
  onSelectCategory,
  onNavigate,
  commit,
  onError,
}: {
  data: Data;
  month: string;
  annual: boolean;
  onAnnualChange: (next: boolean) => void;
  exportBusy: boolean;
  onExportBackup: () => void;
  onExportEncrypted: () => void;
  onImportBackup: () => void;
  onImportCsv: () => void;
  onSelectCategory: (categoryId: string) => void;
  onNavigate: (page: Page) => void;
  commit: Commit;
  onError: (e: unknown) => void;
}) {
  const formatDual = useMoney();
  const [showAllInsights, setShowAllInsights] = useState(false);

  const period = annual ? month.slice(0, 4) : month;
  const selected = periodTransactions(data, period);
  const sum = totals(selected);
  const prior = totals(periodTransactions(data, previousPeriod(period)));
  const balance = balances(
    data,
    periodEnd(period, data.preferences.paydayDay),
  );
  const priorBalance = balances(
    data,
    periodEnd(previousPeriod(period), data.preferences.paydayDay),
  );
  const savingRate =
    sum.income > 0
      ? Math.round(((sum.income - sum.expense) / sum.income) * 100)
      : 0;
  const bounds = periodBounds(period, data.preferences.paydayDay);
  const reportInsights = insights(data, period, formatDual, annual);

  const renderMetric = (kind: "income" | "expense") => {
    const change = changePercent(sum[kind], prior[kind]);
    const values = annual
      ? Array.from(
          { length: 12 },
          (_, i) =>
            totals(
              periodTransactions(
                data,
                `${period}-${String(i + 1).padStart(2, "0")}`,
              ),
            )[kind],
        )
      : Array.from(
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
          <strong>
            <Money amount={sum[kind]} />
          </strong>
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
              к прошлому {annual ? "году" : "периоду"}
            </>
          ) : (
            <>За {bounds.label.toLocaleLowerCase("ru")}</>
          )}
        </p>
      </Card>
    );
  };

  const rowsToCompare: [string, number, number][] = [
    ["Доходы", sum.income, prior.income],
    ["Расходы", sum.expense, prior.expense],
    ["Разница", sum.income - sum.expense, prior.income - prior.expense],
  ];

  const balanceKeys: { key: "saved" | "debt" | "receivable"; label: string }[] = [
    { key: "saved", label: "Накопления на конец периода" },
    { key: "debt", label: "Долги на конец периода" },
    ...(balance.receivable > 0 || priorBalance.receivable > 0
      ? [{ key: "receivable" as const, label: "Мне должны на конец периода" }]
      : []),
  ];

  return (
    <>
      <div className="section-toolbar report-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={!annual ? "active" : ""}
            onClick={() => onAnnualChange(false)}
          >
            За период
          </button>
          <button
            type="button"
            className={annual ? "active" : ""}
            onClick={() => onAnnualChange(true)}
          >
            За год
          </button>
        </div>
        <span className="muted">
          {annual ? `${period} год` : bounds.label} · в сравнении с{" "}
          {annual ? "прошлым годом" : "предыдущим периодом"}
        </span>
      </div>

      <div className="report-metrics">
        {renderMetric("income")}
        {renderMetric("expense")}
        <Card className="metric-card">
          <div className="metric-title">
            <span>Разница</span>
            <span className="flow-icon income">
              <TrendingUp size={18} />
            </span>
          </div>
          <div className="metric-value">
            <strong>
              <Money amount={sum.income - sum.expense} />
            </strong>
          </div>
          <p className="metric-change">
            {sum.income > 0
              ? `${Math.abs(savingRate)}% от доходов ${savingRate >= 0 ? "сохранено" : "сверх доходов потрачено"}`
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
                ? "Динамика по месяцам выбранного года"
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
          <ExpenseChart
            data={data}
            period={period}
            onSelectCategory={onSelectCategory}
          />
        </Card>
      </div>

      {!annual && (
        <Card className="heatmap-card">
          <CardHeading
            title="Тепловая карта расходов"
            subtitle={`Ежедневная интенсивность трат · ${bounds.label}`}
          />
          <SpendingHeatmap data={data} month={month} />
        </Card>
      )}

      <Card className="comparison-card">
        <CardHeading
          title="Что изменилось"
          subtitle="Сравнение выбранных периодов"
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
              {rowsToCompare.map(([label, current, before]) => {
                const change = changePercent(current, before);
                return (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>
                      <Money amount={current} />
                    </td>
                    <td>
                      <Money amount={before} />
                    </td>
                    <td>
                      {change === null
                        ? "Нет базы сравнения"
                        : `${change > 0 ? "+" : ""}${change}%`}
                    </td>
                  </tr>
                );
              })}
              {balanceKeys.map(({ key, label }) => {
                const diff = balance[key] - priorBalance[key];
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      <Money amount={balance[key]} />
                    </td>
                    <td>
                      <Money amount={priorBalance[key]} />
                    </td>
                    <td>
                      {diff > 0 ? "+" : ""}
                      <Money amount={diff} />
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
          subtitle={`Подсказки по операциям за ${annual ? `${period} год` : bounds.label}`}
          action={
            reportInsights.length > 3
              ? showAllInsights
                ? "Свернуть"
                : "Показать все"
              : undefined
          }
          onAction={() => setShowAllInsights(!showAllInsights)}
        />
        {reportInsights.length ? (
          reportInsights
            .slice(0, showAllInsights ? undefined : 3)
            .map((i) => (
              <div className="analysis-row-wrap" key={i.id}>
                <button
                  type="button"
                  className="analysis-row"
                  onClick={() => onNavigate(i.page)}
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
                <button
                  type="button"
                  className="icon-button subtle"
                  aria-label={`Скрыть подсказку: ${i.title}`}
                  title="Скрыть подсказку"
                  onClick={() =>
                    commit((d) => ({
                      ...d,
                      preferences: {
                        ...d.preferences,
                        dismissedInsights: [
                          ...d.preferences.dismissedInsights,
                          i.id,
                        ],
                      },
                    })).catch(onError)
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))
        ) : (
          <div className="quiet-reminder">
            <ShieldCheck size={22} />
            <span>Необычных операций не обнаружено.</span>
          </div>
        )}
        <p className="analysis-note">
          Пороги подсказок (рост %, минимум и крупные платежи) можно настроить в
          профиле.
        </p>
      </Card>

      <div className="backup-panel glass-surface">
        <span className="wealth-icon">
          <FileText size={22} />
        </span>
        <div>
          <h3>Ваши данные всегда с вами</h3>
          <p>
            Обычный или зашифрованный JSON — полная копия. CSV — экспорт и
            импорт банковских выписок.
          </p>
        </div>
        <div className="backup-actions">
          <button
            type="button"
            className="button secondary small"
            disabled={exportBusy}
            onClick={onExportBackup}
          >
            <Download size={15} />
            JSON копия
          </button>
          <button
            type="button"
            className="button secondary small"
            disabled={exportBusy}
            onClick={onExportEncrypted}
          >
            <LockKeyhole size={15} />
            С паролем
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={onImportBackup}
          >
            <Upload size={15} />
            Восстановить
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={onImportCsv}
          >
            <Upload size={15} />
            Импорт CSV
          </button>
        </div>
      </div>
    </>
  );
}
