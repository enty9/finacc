import { useMemo, useState } from "react";
import {
  Activity,
  QrCode,
  Search,
  SlidersHorizontal,
  Tag,
  Upload,
} from "lucide-react";
import { Card, CardHeading, Empty, FlowIcon, TransactionList } from "../components";
import { Money } from "../currency";
import {
  frequentTemplates,
  periodBounds,
  pluralRu,
  totals,
  type Data,
  type Insight,
  type Transaction,
} from "../domain";
import type { TransactionDraft } from "../forms";

export function TransactionsPage({
  data,
  month,
  sortedPeriodTransactions,
  allInsights,
  categoryFilter,
  onCategoryFilterChange,
  onAddTransaction,
  onEditTransaction,
  onOpenQr,
  onImportCsv,
}: {
  data: Data;
  month: string;
  sortedPeriodTransactions: Transaction[];
  allInsights: Insight[];
  categoryFilter: string;
  onCategoryFilterChange: (next: string) => void;
  onAddTransaction: (draft?: TransactionDraft) => void;
  onEditTransaction: (tx: Transaction) => void;
  onOpenQr: () => void;
  onImportCsv: () => void;
}) {
  const [allHistory, setAllHistory] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");

  const baseList = useMemo(() => {
    if (!allHistory) return sortedPeriodTransactions;
    return [...data.transactions].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
  }, [allHistory, data.transactions, sortedPeriodTransactions]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of baseList) {
      for (const tag of t.tags ?? []) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [baseList]);

  const categoryNames = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c.name])),
    [data.categories],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru");
    const defaultAccId = data.accounts[0]?.id ?? "main";
    return baseList.filter((t) => {
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (categoryFilter !== "all" && t.categoryId !== categoryFilter)
        return false;
      if (
        accountFilter !== "all" &&
        (t.accountId ?? defaultAccId) !== accountFilter
      )
        return false;
      if (tagFilter !== "all" && !(t.tags ?? []).includes(tagFilter))
        return false;
      if (!query) return true;
      const haystack =
        `${t.title} ${t.note} ${categoryNames.get(t.categoryId) ?? ""} ${(t.tags ?? []).join(" ")}`.toLocaleLowerCase(
          "ru",
        );
      return haystack.includes(query);
    });
  }, [
    accountFilter,
    baseList,
    categoryFilter,
    categoryNames,
    data.accounts,
    kindFilter,
    search,
    tagFilter,
  ]);

  const summary = useMemo(() => totals(filtered), [filtered]);
  const templates = useMemo(() => frequentTemplates(data, 5), [data]);
  const bounds = periodBounds(month, data.preferences.paydayDay);
  const countWord = pluralRu(filtered.length, ["запись", "записи", "записей"]);

  return (
    <>
      <div className="two-metrics">
        <div className="mini-metric glass-surface">
          <FlowIcon kind="income" />
          <span>
            Поступило
            <strong>
              <Money amount={summary.income} />
            </strong>
          </span>
        </div>
        <div className="mini-metric glass-surface">
          <FlowIcon kind="expense" />
          <span>
            Потрачено
            <strong>
              <Money amount={summary.expense} />
            </strong>
          </span>
        </div>
      </div>

      <div className="section-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={!allHistory ? "active" : ""}
            onClick={() => setAllHistory(false)}
          >
            За период
          </button>
          <button
            type="button"
            className={allHistory ? "active" : ""}
            onClick={() => setAllHistory(true)}
          >
            Вся история
          </button>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className="button secondary small"
            onClick={onOpenQr}
          >
            <QrCode size={15} />
            QR чек
          </button>
          <button
            type="button"
            className="button secondary small"
            onClick={onImportCsv}
          >
            <Upload size={15} />
            Импорт CSV
          </button>
        </div>
      </div>

      {templates.length > 0 && (
        <div className="templates-bar" aria-label="Быстрые шаблоны">
          <span>Частые:</span>
          {templates.map((tpl) => (
            <button
              type="button"
              key={tpl.key}
              className="chip"
              onClick={() =>
                onAddTransaction({
                  kind: tpl.kind,
                  title: tpl.title,
                  categoryId: tpl.categoryId,
                  amount: tpl.amount,
                  accountId: tpl.accountId,
                })
              }
            >
              {tpl.title}
            </button>
          ))}
        </div>
      )}

      <Card className="operations-card">
        <div className="filters">
          <label className="search-input">
            <Search size={18} />
            <input
              aria-label="Поиск операций"
              placeholder="Найти по названию, заметке или #тегу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="segmented operation-filter">
            <button
              type="button"
              className={kindFilter === "all" ? "active" : ""}
              onClick={() => setKindFilter("all")}
            >
              Все
            </button>
            <button
              type="button"
              className={kindFilter === "expense" ? "active" : ""}
              onClick={() => setKindFilter("expense")}
            >
              Расходы
            </button>
            <button
              type="button"
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
              onChange={(e) => onCategoryFilterChange(e.target.value)}
            >
              <option value="all">Все категории</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {data.accounts.length > 1 && (
            <label className="category-filter">
              <select
                aria-label="Фильтр по счету"
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
              >
                <option value="all">Все счета</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="chip-row" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`chip ${tagFilter === "all" ? "active" : ""}`}
              onClick={() => setTagFilter("all")}
            >
              <Tag size={13} />
              Все теги
            </button>
            {allTags.map((tag) => (
              <button
                type="button"
                key={tag}
                className={`chip ${tagFilter === tag ? "active" : ""}`}
                onClick={() =>
                  setTagFilter((prev) => (prev === tag ? "all" : tag))
                }
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <CardHeading
          title="История операций"
          subtitle={`${filtered.length} ${countWord} · ${allHistory ? "за всё время" : bounds.label}`}
        />
        {filtered.length ? (
          <TransactionList
            transactions={filtered}
            data={data}
            onEdit={onEditTransaction}
          />
        ) : (
          <Empty
            title={
              baseList.length ? "Ничего не нашлось" : "Начните свою историю"
            }
            description={
              baseList.length
                ? "Измените запрос или сбросьте фильтры."
                : "Добавьте первую операцию за этот период."
            }
            action={baseList.length ? undefined : "Добавить операцию"}
            onAction={() => onAddTransaction()}
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
                <span className="analysis-icon warning">
                  <Activity size={19} />
                </span>
                <div>
                  <h3>{i.title}</h3>
                  <p>{i.description}</p>
                </div>
              </div>
            ))}
        </Card>
      )}
    </>
  );
}
