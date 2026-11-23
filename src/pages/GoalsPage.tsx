import { useState } from "react";
import {
  Archive,
  ArrowUpRight,
  CreditCard,
  Landmark,
  LockKeyhole,
  Pencil,
  Plus,
  Target,
} from "lucide-react";
import { Card, CardHeading, ConfirmInline, Empty, GoalCard } from "../components";
import { Money, useMoney } from "../currency";
import type { Data, Debt, DebtDirection, Saving } from "../domain";
import type { Commit } from "../forms";

export type GoalTab = "saving" | "debt" | "owed";

export function GoalsPage({
  data,
  currentBalance,
  goalTab,
  onGoalTabChange,
  onNewEntity,
  onEditEntity,
  onTransfer,
  commit,
  onError,
}: {
  data: Data;
  currentBalance: {
    cash: number;
    overdraft: number;
    saved: number;
    debt: number;
    receivable: number;
  };
  goalTab: GoalTab;
  onGoalTabChange: (tab: GoalTab) => void;
  onNewEntity: (debt: boolean, defaultDirection: DebtDirection) => void;
  onEditEntity: (debt: boolean, entity: Saving | Debt) => void;
  onTransfer: (debt: boolean, entity: Saving | Debt) => void;
  commit: Commit;
  onError: (e: unknown) => void;
}) {
  const formatDual = useMoney();
  const [showArchived, setShowArchived] = useState(false);

  const isDebtTab = goalTab !== "saving";
  const tabEntities =
    goalTab === "saving"
      ? data.savings
      : data.debts.filter((d) =>
          goalTab === "owed" ? d.direction === "owed" : d.direction !== "owed",
        );

  const archivedCount = tabEntities.filter((e) => e.archived).length;
  const visibleEntities = tabEntities.filter((e) =>
    showArchived ? true : !e.archived,
  );

  const tabEntityIds = new Set(tabEntities.map((e) => e.id));
  const entityType = isDebtTab ? "debt" : "saving";
  const tabMovements = [...data.movements]
    .reverse()
    .filter((m) => m.entityType === entityType && tabEntityIds.has(m.entityId));

  return (
    <>
      <div className="two-metrics">
        <div className="mini-metric glass-surface">
          <span className="wealth-icon savings">
            <Target size={22} />
          </span>
          <span>
            Всего накоплено
            <strong>
              <Money amount={currentBalance.saved} />
            </strong>
          </span>
        </div>
        <div className="mini-metric glass-surface">
          <span className="wealth-icon debt">
            <CreditCard size={22} />
          </span>
          <span>
            {currentBalance.receivable > 0 && goalTab === "owed"
              ? "Мне должны"
              : "Осталось вернуть"}
            <strong>
              <Money
                amount={
                  currentBalance.receivable > 0 && goalTab === "owed"
                    ? currentBalance.receivable
                    : currentBalance.debt
                }
              />
            </strong>
          </span>
        </div>
      </div>

      <div className="section-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={goalTab === "saving" ? "active" : ""}
            onClick={() => onGoalTabChange("saving")}
          >
            <Target size={15} />
            Накопления
          </button>
          <button
            type="button"
            className={goalTab === "debt" ? "active" : ""}
            onClick={() => onGoalTabChange("debt")}
          >
            <CreditCard size={15} />
            Долги
          </button>
          <button
            type="button"
            className={goalTab === "owed" ? "active" : ""}
            onClick={() => onGoalTabChange("owed")}
          >
            <Landmark size={15} />
            Мне должны
          </button>
        </div>

        <div className="chip-row">
          {archivedCount > 0 && (
            <button
              type="button"
              className={`chip ${showArchived ? "active" : ""}`}
              onClick={() => setShowArchived(!showArchived)}
            >
              <Archive size={14} />
              Архив ({archivedCount})
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              onNewEntity(isDebtTab, goalTab === "owed" ? "owed" : "owe")
            }
          >
            <Plus size={16} />
            {goalTab === "saving"
              ? "Новая цель"
              : goalTab === "owed"
                ? "Мне должны"
                : "Добавить долг"}
          </button>
        </div>
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
                Поступления денег уменьшают этот долг. Исправление или удаление
                операций пересчитывает его.
              </p>
            </div>
          </Card>
        )}

        {visibleEntities.map((entity) => (
          <Card key={entity.id}>
            <div className="entity-tools">
              <button
                type="button"
                className="icon-button"
                aria-label={`Изменить: ${entity.name}`}
                onClick={() => onEditEntity(isDebtTab, entity)}
              >
                <Pencil size={15} />
              </button>
            </div>
            <GoalCard
              goal={entity}
              debt={isDebtTab}
              data={data}
              onTransfer={() => onTransfer(isDebtTab, entity)}
            />
          </Card>
        ))}
      </div>

      {visibleEntities.length === 0 &&
        !(goalTab === "debt" && currentBalance.overdraft > 0) && (
          <Card>
            <Empty
              title={
                goalTab === "saving"
                  ? "Дайте мечте название"
                  : goalTab === "owed"
                    ? "Никто не должен — всё ровно"
                    : "Без долгов — тоже хороший план"
              }
              description={
                goalTab === "saving"
                  ? "На поездку, подушку безопасности или что-то свое."
                  : goalTab === "owed"
                    ? "Записывайте суммы, которые вы одолжили другим, и отмечайте возвраты."
                    : "Добавьте текущий долг и отмечайте платежи."
              }
              icon={
                goalTab === "saving"
                  ? Target
                  : goalTab === "owed"
                    ? Landmark
                    : CreditCard
              }
              action={
                goalTab === "saving"
                  ? "Создать цель"
                  : goalTab === "owed"
                    ? "Добавить запись"
                    : "Добавить долг"
              }
              onAction={() =>
                onNewEntity(isDebtTab, goalTab === "owed" ? "owed" : "owe")
              }
            />
          </Card>
        )}

      <Card className="movement-history">
        <CardHeading
          title="История переводов"
          subtitle="Взносы и выплаты хранятся отдельно от повседневных расходов"
        />
        {tabMovements.length ? (
          tabMovements.map((m) => {
            const name =
              (isDebtTab ? data.debts : data.savings).find(
                (e) => e.id === m.entityId,
              )?.name ?? "";
            const label =
              m.entityType === "saving"
                ? m.amount > 0
                  ? "Пополнение"
                  : "Снятие"
                : goalTab === "owed"
                  ? m.amount > 0
                    ? "Возврат мне"
                    : "Одолжил"
                  : m.amount > 0
                    ? "Платеж"
                    : "Получение";
            return (
              <div className="movement-row" key={m.id}>
                <span className="wealth-icon">
                  <ArrowUpRight size={18} />
                </span>
                <div>
                  <strong>{name}</strong>
                  <span>
                    {label} ·{" "}
                    {new Date(`${m.date}T12:00:00`).toLocaleDateString("ru-RU")}
                    {m.note ? ` · ${m.note}` : ""}
                  </span>
                </div>
                <strong>
                  <Money amount={Math.abs(m.amount)} />
                </strong>
                <ConfirmInline
                  iconOnly
                  ariaLabel={`Удалить перевод ${formatDual(Math.abs(m.amount))}`}
                  onConfirm={async () => {
                    try {
                      await commit((d) => ({
                        ...d,
                        movements: d.movements.filter(
                          (item) => item.id !== m.id,
                        ),
                      }));
                    } catch (e) {
                      onError(e);
                    }
                  }}
                />
              </div>
            );
          })
        ) : (
          <p className="muted history-empty">
            Здесь появятся ваши пополнения и платежи.
          </p>
        )}
      </Card>

      <p className="page-footnote">
        <LockKeyhole size={15} />
        Здесь показаны текущие остатки за все время. Снимок на конец выбранного
        периода доступен в отчете.
      </p>
    </>
  );
}
