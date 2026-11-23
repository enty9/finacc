import { Layers, Plus, ShieldCheck } from "lucide-react";
import { Card, CategoryIcon, Progress } from "../components";
import { Money, useMoney } from "../currency";
import {
  categoryTotals,
  safeToSpend,
  type Category,
  type Data,
} from "../domain";

export function BudgetPage({
  data,
  month,
  onSetLimit,
  onManageCategories,
}: {
  data: Data;
  month: string;
  onSetLimit: (category: Category) => void;
  onManageCategories: () => void;
}) {
  const formatDual = useMoney();
  const categories = categoryTotals(data, month);
  const budgetTotal = categories.reduce((s, c) => s + c.limit, 0);
  const budgetSpent = categories
    .filter((c) => c.limit > 0)
    .reduce((s, c) => s + c.amount, 0);
  const safe = safeToSpend(data, month);
  const dailyPace =
    safe.elapsedDays > 0 ? Math.round(safe.spent / safe.elapsedDays) : 0;

  return (
    <>
      <div className="budget-summary glass-surface">
        <div>
          <span className="eyebrow">ВАШ ПЛАН НА ПЕРИОД</span>
          <h2>
            <Money amount={budgetSpent} />
            <span>
              {" "}
              / <Money amount={budgetTotal} />
            </span>
          </h2>
          <p>
            {budgetTotal
              ? budgetSpent > budgetTotal
                ? `Выше общего плана на ${formatDual(budgetSpent - budgetTotal)}`
                : `В пределах лимитов осталось ${formatDual(budgetTotal - budgetSpent)} · темп ${formatDual(dailyPace)}/день`
              : "Задайте первый лимит, чтобы держать расходы в фокусе"}
          </p>
        </div>
        <div className="budget-summary-progress">
          <span>
            {budgetTotal ? Math.round((budgetSpent / budgetTotal) * 100) : 0}%
            плана использовано
          </span>
          <Progress
            value={budgetTotal ? (budgetSpent / budgetTotal) * 100 : 0}
            color={budgetSpent > budgetTotal ? "var(--expense)" : undefined}
            label="Использование бюджета"
          />
        </div>
      </div>

      <div className="section-intro">
        <div>
          <h2>У каждой категории свой план</h2>
          <p>Лимиты на расчетный период · предупреждение при 80% и перерасходе</p>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={onManageCategories}
        >
          <Layers size={15} />
          Категории
        </button>
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
              </div>
              <div className="budget-amount">
                <strong>
                  <Money amount={c.amount} />
                </strong>
                <span>
                  {c.limit
                    ? `из ${formatDual(c.limit)}`
                    : "лимит не задан"}
                </span>
              </div>
              <Progress
                value={percent}
                color={
                  percent >= 100
                    ? "var(--expense)"
                    : percent >= 80
                      ? "var(--warning)"
                      : c.color
                }
                label={`Лимит ${c.name}`}
              />
              {!!c.limit && (
                <div className="budget-caption">
                  <span>
                    {percent > 100
                      ? `Перерасход ${formatDual(c.amount - c.limit)}`
                      : percent === 100
                        ? "Лимит использован"
                        : `Осталось ${formatDual(c.limit - c.amount)}`}
                  </span>
                  <strong>{Math.round(percent)}%</strong>
                </div>
              )}
              <button
                type="button"
                className="text-button budget-limit"
                aria-label={`Задать лимит: ${c.name}`}
                onClick={() => onSetLimit(c)}
              >
                <Plus size={14} />
                {c.limit ? "Изменить лимит" : "Задать лимит"}
              </button>
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
  );
}
