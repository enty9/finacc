import { Money, useMoney } from "./currency";
import { useId } from "react";
import {
  categoryTotals,
  monthName,
  periodTransactions,
  shiftMonth,
  totals,
  type Data,
} from "./domain";

export function Sparkline({
  expense = false,
  values,
}: {
  expense?: boolean;
  values: number[];
}) {
  const min = Math.min(...values),
    range = Math.max(...values) - min;
  const points = values
    .map(
      (value, i) =>
        `${2 + (i * 96) / Math.max(1, values.length - 1)},${range ? 35 - ((value - min) / range) * 28 : 20}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      width="100"
      height="40"
      viewBox="0 0 100 40"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={expense ? "#a5c8ff" : "#60a5fa"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function CashChart({
  data,
  month,
  year = false,
}: {
  data: Data;
  month: string;
  year?: boolean;
}) {
  const money = useMoney();
  const id = useId().replaceAll(":", "");
  const periods = year
    ? Array.from(
        { length: 12 },
        (_, i) => `${month.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`,
      )
    : Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const points = periods.map((p) => ({
    period: p,
    ...totals(periodTransactions(data, p)),
  }));
  const max = Math.max(
    1_000_000,
    ...points.flatMap((p) => [p.income, p.expense]),
  );
  const step = Math.ceil(max / 4 / 500000) * 500000;
  const ceiling = step * 4;
  const width = 660,
    height = 215,
    left = 48,
    bottom = 30,
    top = 12;
  const chartHeight = height - bottom - top;
  const slot = (width - left - 10) / points.length;
  const bar = year ? 12 : 23;
  return (
    <div className="cash-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Доходы и расходы по месяцам. ${points.map((p) => `${monthName(p.period)}: доходы ${money(p.income)}, расходы ${money(p.expense)}`).join("; ")}`}
      >
        <defs>
          <linearGradient id={`income-${id}`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id={`expense-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a5c8ff" />
            <stop offset="100%" stopColor="#5b79aa" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }, (_, i) => {
          const y = top + (i * chartHeight) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={width}
                y1={y}
                y2={y}
                stroke="var(--line)"
                strokeDasharray="3 5"
              />
              <text
                x={left - 12}
                y={y + 4}
                textAnchor="end"
                fill="var(--muted)"
                fontSize="10"
              >
                {((ceiling * (4 - i)) / 4 / 100000).toLocaleString("ru-RU")}{" "}
                тыс.
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const x = left + slot * (i + 0.5);
          return (
            <g key={p.period} className="chart-group">
              <title>
                {monthName(p.period)}: доходы {<Money amount={p.income} />},
                расходы {<Money amount={p.expense} />}
              </title>
              <rect
                className="chart-hover"
                x={x - slot / 2 + 4}
                y="0"
                width={slot - 8}
                height={height}
                rx="8"
                fill="transparent"
              />
              <rect
                x={x - bar - 2}
                y={top + chartHeight - (p.income / ceiling) * chartHeight}
                width={bar}
                height={(p.income / ceiling) * chartHeight}
                fill={`url(#income-${id})`}
                rx="5"
              />
              <rect
                x={x + 2}
                y={top + chartHeight - (p.expense / ceiling) * chartHeight}
                width={bar}
                height={(p.expense / ceiling) * chartHeight}
                fill={`url(#expense-${id})`}
                rx="5"
              />
              <text
                x={x}
                y={height - 6}
                textAnchor="middle"
                fill={p.period === month ? "var(--text)" : "var(--muted)"}
                fontWeight={p.period === month ? "600" : "400"}
                fontSize="11"
              >
                {monthName(p.period, true).replace(".", "")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
export function ExpenseChart({ data, period }: { data: Data; period: string }) {
  const money = useMoney();
  const categories = categoryTotals(data, period).filter((c) => c.amount > 0);
  const total = categories.reduce((sum, c) => sum + c.amount, 0);
  const top = categories.slice(0, 4);
  if (categories.length > 4)
    top.push({
      ...categories[4],
      id: "remaining",
      name: "Остальное",
      color: "#94a3b8",
      amount: categories.slice(4).reduce((sum, c) => sum + c.amount, 0),
    });
  const circumference = 2 * Math.PI * 69;
  let offset = 0;
  return (
    <div className="expense-chart">
      <div className="donut-wrap">
        <svg
          viewBox="0 0 180 180"
          role="img"
          aria-label={
            total
              ? `Расходы по категориям: ${categories.map((c) => `${c.name} ${money(c.amount)}`).join(", ")}`
              : "Пока нет расходов"
          }
        >
          <circle
            cx="90"
            cy="90"
            r="69"
            fill="none"
            stroke="var(--surface-raised)"
            strokeWidth="18"
          />
          {top.map((c) => {
            const length = (c.amount / total) * circumference;
            const start = offset;
            offset += length;
            return (
              <circle
                key={c.id}
                cx="90"
                cy="90"
                r="69"
                fill="none"
                stroke={c.color}
                strokeWidth="18"
                strokeDasharray={`${Math.max(0, length - 5)} ${circumference - Math.max(0, length - 5)}`}
                strokeDashoffset={-start}
                transform="rotate(-90 90 90)"
              >
                <title>
                  {c.name}: {<Money amount={c.amount} />}
                </title>
              </circle>
            );
          })}
        </svg>
        <div className="donut-center">
          <span>Всего расходов</span>
          <strong>{<Money amount={total} />}</strong>
          <small>{categories.length} категорий</small>
        </div>
      </div>
      <div className="donut-legend">
        {top.length ? (
          top.map((c) => (
            <div key={c.id}>
              <span className="legend-label">
                <i style={{ background: c.color }} />
                {c.name}
              </span>
              <strong>
                {Math.round((c.amount / total) * 100)}
                <span>%</span>
              </strong>
            </div>
          ))
        ) : (
          <p className="muted">Добавьте расход, чтобы увидеть диаграмму.</p>
        )}
      </div>
    </div>
  );
}
