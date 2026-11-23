import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Money, useMoney } from "./currency";
import {
  categoryTotals,
  dateKey,
  formatDate,
  money as formatRub,
  monthName,
  periodBounds,
  periodTransactions,
  shiftMonth,
  totals,
  type Data,
} from "./domain";

export function Sparkline({
  expense = false,
  color,
  values,
}: {
  expense?: boolean;
  color?: string;
  values: number[];
}) {
  const safeValues = values.length ? values : [0, 0];
  const min = Math.min(...safeValues);
  const range = Math.max(...safeValues) - min;
  const points = safeValues
    .map(
      (value, i) =>
        `${2 + (i * 96) / Math.max(1, safeValues.length - 1)},${range ? 35 - ((value - min) / range) * 28 : 20}`,
    )
    .join(" ");
  const stroke = color ?? (expense ? "var(--expense)" : "var(--income)");
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
        stroke={stroke}
        strokeWidth="2.2"
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
  const formatDual = useMoney();
  const id = useId().replaceAll(":", "");
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

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
  const width = 660;
  const height = 215;
  const left = 52;
  const bottom = 30;
  const top = 12;
  const chartHeight = height - bottom - top;
  const slot = (width - left - 10) / points.length;
  const bar = year ? 12 : 22;

  const activePoint =
    points.find((p) => p.period === selectedPeriod) ?? null;

  return (
    <div className="cash-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Доходы и расходы по месяцам. ${points
          .map(
            (p) =>
              `${monthName(p.period)}: доходы ${formatDual(p.income)}, расходы ${formatDual(p.expense)}`,
          )
          .join("; ")}`}
      >
        <defs>
          <linearGradient id={`income-${id}`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
          <linearGradient id={`expense-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor="#e11d48" />
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
                x={left - 10}
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
          const selected = p.period === selectedPeriod;
          return (
            <g
              key={p.period}
              className={`chart-group ${selected ? "selected" : ""}`}
              onClick={() =>
                setSelectedPeriod((prev) =>
                  prev === p.period ? null : p.period,
                )
              }
            >
              <title>
                {`${monthName(p.period)}: доходы ${formatRub(p.income)}, расходы ${formatRub(p.expense)}`}
              </title>
              <rect
                className="chart-hover"
                x={x - slot / 2 + 4}
                y="0"
                width={slot - 8}
                height={height}
                rx="8"
                fill={selected ? "var(--surface-soft)" : "transparent"}
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
                fill={
                  selected || p.period === month
                    ? "var(--text)"
                    : "var(--muted)"
                }
                fontWeight={selected || p.period === month ? "600" : "400"}
                fontSize="11"
              >
                {monthName(p.period, true).replace(".", "")}
              </text>
            </g>
          );
        })}
      </svg>
      {activePoint && (
        <div className="chart-detail-pill">
          <strong>{monthName(activePoint.period)}</strong>
          <span className="positive">
            Доходы: {formatRub(activePoint.income)}
          </span>
          <span className="expense-text">
            Расходы: {formatRub(activePoint.expense)}
          </span>
          <span>
            Разница:{" "}
            {activePoint.income - activePoint.expense >= 0 ? "+" : ""}
            {formatRub(activePoint.income - activePoint.expense)}
          </span>
        </div>
      )}
    </div>
  );
}

export function ExpenseChart({
  data,
  period,
  onSelectCategory,
}: {
  data: Data;
  period: string;
  onSelectCategory?: (categoryId: string) => void;
}) {
  const formatDual = useMoney();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const categories = categoryTotals(data, period).filter((c) => c.amount > 0);
  const total = categories.reduce((sum, c) => sum + c.amount, 0);
  const top = categories.slice(0, 4);
  if (categories.length > 4) {
    top.push({
      ...categories[4],
      id: "remaining",
      name: "Остальное",
      color: "#94a3b8",
      amount: categories.slice(4).reduce((sum, c) => sum + c.amount, 0),
    });
  }

  const activeCategory = top.find((c) => c.id === selectedId) ?? null;
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
              ? `Расходы по категориям: ${categories.map((c) => `${c.name} ${formatDual(c.amount)}`).join(", ")}`
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
            const isSelected = selectedId === c.id;
            const dimmed = selectedId !== null && !isSelected;
            return (
              <circle
                key={c.id}
                cx="90"
                cy="90"
                r="69"
                fill="none"
                stroke={c.color}
                strokeWidth={isSelected ? "22" : "18"}
                strokeDasharray={`${Math.max(0, length - 5)} ${circumference - Math.max(0, length - 5)}`}
                strokeDashoffset={-start}
                transform="rotate(-90 90 90)"
                opacity={dimmed ? 0.35 : 1}
                style={{ cursor: "pointer", transition: "all 0.2s ease" }}
                onClick={() =>
                  setSelectedId((prev) => (prev === c.id ? null : c.id))
                }
              >
                <title>{`${c.name}: ${formatRub(c.amount)}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="donut-center">
          <span>
            {activeCategory ? activeCategory.name : "Всего расходов"}
          </span>
          <strong>
            <Money
              amount={activeCategory ? activeCategory.amount : total}
            />
          </strong>
          <small>
            {activeCategory && total > 0
              ? `${Math.round((activeCategory.amount / total) * 100)}% от расходов`
              : `${categories.length} категорий`}
          </small>
        </div>
      </div>
      <div className="donut-legend">
        {top.length ? (
          <>
            {top.map((c) => (
              <button
                type="button"
                className={`donut-legend-row ${selectedId === c.id ? "active" : ""}`}
                key={c.id}
                onClick={() =>
                  setSelectedId((prev) => (prev === c.id ? null : c.id))
                }
              >
                <span className="legend-label">
                  <i style={{ background: c.color }} />
                  {c.name}
                </span>
                <strong>
                  {Math.round((c.amount / total) * 100)}
                  <span>%</span>
                </strong>
              </button>
            ))}
            {activeCategory &&
              activeCategory.id !== "remaining" &&
              onSelectCategory && (
                <button
                  type="button"
                  className="text-button donut-filter-btn"
                  onClick={() => onSelectCategory(activeCategory.id)}
                >
                  Показать операции
                  <ArrowRight size={14} />
                </button>
              )}
          </>
        ) : (
          <p className="muted">Добавьте расход, чтобы увидеть диаграмму.</p>
        )}
      </div>
    </div>
  );
}

export function SpendingHeatmap({
  data,
  month,
}: {
  data: Data;
  month: string;
}) {
  const { start, end } = periodBounds(month, data.preferences.paydayDay);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const today = dateKey();

  const dailyTotals = new Map<string, { amount: number; count: number }>();
  for (const t of data.transactions) {
    if (t.kind === "expense" && t.date >= start && t.date <= end) {
      const cur = dailyTotals.get(t.date) ?? { amount: 0, count: 0 };
      cur.amount += t.amount;
      cur.count += 1;
      dailyTotals.set(t.date, cur);
    }
  }

  const days: { date: string; dayNum: number; amount: number; count: number }[] =
    [];
  const cursor = new Date(`${start}T12:00:00`);
  const endMs = new Date(`${end}T12:00:00`).getTime();
  while (cursor.getTime() <= endMs) {
    const key = dateKey(cursor);
    const info = dailyTotals.get(key) ?? { amount: 0, count: 0 };
    days.push({
      date: key,
      dayNum: cursor.getDate(),
      amount: info.amount,
      count: info.count,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const firstWeekday = (new Date(`${start}T12:00:00`).getDay() + 6) % 7;
  const maxAmount = Math.max(1, ...days.map((d) => d.amount));
  const zeroSpendDays = days.filter(
    (d) => d.date <= today && d.amount === 0,
  ).length;
  const activeDay = days.find((d) => d.date === selectedDay) ?? null;

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-meta">
        <span>Дней без трат: <strong>{zeroSpendDays}</strong></span>
        <div className="heatmap-scale" aria-hidden="true">
          <span>Меньше</span>
          <i className="heat-0" />
          <i className="heat-1" />
          <i className="heat-2" />
          <i className="heat-3" />
          <i className="heat-4" />
          <span>Больше</span>
        </div>
      </div>
      <div className="heatmap-weekdays">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="heatmap-grid">
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span className="heatmap-spacer" key={`sp-${i}`} />
        ))}
        {days.map((d) => {
          const ratio = d.amount / maxAmount;
          const level =
            d.amount === 0
              ? 0
              : ratio < 0.25
                ? 1
                : ratio < 0.5
                  ? 2
                  : ratio < 0.8
                    ? 3
                    : 4;
          return (
            <button
              type="button"
              key={d.date}
              className={`heatmap-cell heat-${level} ${selectedDay === d.date ? "selected" : ""} ${d.date === today ? "today" : ""}`}
              title={`${formatDate(d.date)}: ${formatRub(d.amount)}`}
              aria-label={`${formatDate(d.date)}: ${formatRub(d.amount)}`}
              onClick={() =>
                setSelectedDay((prev) => (prev === d.date ? null : d.date))
              }
            >
              {d.dayNum}
            </button>
          );
        })}
      </div>
      {activeDay && (
        <div className="chart-detail-pill">
          <strong>{formatDate(activeDay.date)}</strong>
          <span className="expense-text">
            Потрачено: {formatRub(activeDay.amount)}
          </span>
          <span>Операций: {activeDay.count}</span>
        </div>
      )}
    </div>
  );
}
