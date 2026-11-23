import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  KeyRound,
  Layers,
  LockKeyhole,
  Pencil,
  Plus,
  QrCode,
  ShieldCheck,
  Tag,
} from "lucide-react";
import {
  CategoryIcon,
  ConfirmInline,
  MoneyField,
  SubmitForm,
  categoryIcons,
} from "./components";
import { Money } from "./currency";
import {
  categoryIconIds,
  dateKey,
  deleteAccountSafe,
  deleteCategorySafe,
  deleteEntitySafe,
  entityBalance,
  inputMoney,
  money as formatRub,
  palette,
  parseMoney,
  uid,
  type Account,
  type AccountType,
  type Category,
  type CategoryIconId,
  type Data,
  type Debt,
  type DebtDirection,
  type Recurrence,
  type Reminder,
  type Saving,
  type ThemeMode,
  type Transaction,
} from "./domain";
import { CURRENCY_NAMES, type SecondaryCurrency } from "./exchange";
import { decryptBackup, hashPin, type PinLockRecord } from "./crypto";
import type { BankCsvParseResult } from "./import";

export type Commit = (update: (data: Data) => Data) => Promise<void>;

export type TransactionDraft = Partial<
  Pick<
    Transaction,
    "kind" | "amount" | "title" | "categoryId" | "date" | "note" | "accountId" | "tags"
  >
>;

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateKey(d);
}

function parseTagsInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, "").trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

function QuickDateField({
  value,
  onChange,
  min,
  max = dateKey(),
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
}) {
  const today = dateKey();
  const yesterday = yesterdayKey();
  const isCustom = value !== today && value !== yesterday;
  const [showCustom, setShowCustom] = useState(isCustom);

  return (
    <div className="quick-date-field">
      <div className="field-label">
        <span>Дата операции</span>
      </div>
      <div className="chip-row">
        <button
          type="button"
          className={`chip ${!showCustom && value === today ? "active" : ""}`}
          onClick={() => {
            setShowCustom(false);
            onChange(today);
          }}
        >
          Сегодня
        </button>
        {(!min || yesterday >= min) && (
          <button
            type="button"
            className={`chip ${!showCustom && value === yesterday ? "active" : ""}`}
            onClick={() => {
              setShowCustom(false);
              onChange(yesterday);
            }}
          >
            Вчера
          </button>
        )}
        <button
          type="button"
          className={`chip ${showCustom || isCustom ? "active" : ""}`}
          onClick={() => setShowCustom(true)}
        >
          Другая дата
        </button>
      </div>
      {(showCustom || isCustom) && (
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          required
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        />
      )}
    </div>
  );
}

export function TransactionForm({
  data,
  transaction,
  draft,
  commit,
  close,
  onOpenQr,
  onDeleted,
}: {
  data: Data;
  transaction?: Transaction;
  draft?: TransactionDraft;
  commit: Commit;
  close: () => void;
  onOpenQr?: () => void;
  onDeleted?: (deleted: Transaction) => void;
}) {
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const accountOptions = activeAccounts.length ? activeAccounts : data.accounts;

  const initialKind = transaction?.kind ?? draft?.kind ?? "expense";
  const [kind, setKind] = useState(initialKind);
  const [categoryId, setCategoryId] = useState(
    transaction?.categoryId ??
      draft?.categoryId ??
      data.categories.find((c) => c.kind === initialKind)?.id ??
      "",
  );
  const [title, setTitle] = useState(transaction?.title ?? draft?.title ?? "");
  const [dateValue, setDateValue] = useState(
    transaction?.date ?? draft?.date ?? dateKey(),
  );
  const [accountId, setAccountId] = useState(
    transaction?.accountId ??
      draft?.accountId ??
      accountOptions[0]?.id ??
      "main",
  );
  const [tagsRaw, setTagsRaw] = useState(
    (transaction?.tags ?? draft?.tags ?? []).join(", "),
  );
  const [addCategory, setAddCategory] = useState(false);
  const [newCatColor, setNewCatColor] = useState(
    palette[data.categories.length % palette.length],
  );
  const [newCatIcon, setNewCatIcon] = useState<CategoryIconId>("grid");

  const categories = data.categories.filter((c) => c.kind === kind);

  const suggestions = useMemo(() => {
    const query = title.trim().toLocaleLowerCase("ru");
    const seen = new Map<string, Transaction>();
    for (let i = data.transactions.length - 1; i >= 0; i--) {
      const tx = data.transactions[i];
      if (tx.kind !== kind) continue;
      const key = tx.title.trim().toLocaleLowerCase("ru");
      if (!key) continue;
      if (query && !key.includes(query)) continue;
      if (!seen.has(key)) seen.set(key, tx);
      if (seen.size >= 5) break;
    }
    return [...seen.values()];
  }, [data.transactions, kind, title]);

  const initialAmountStr = transaction
    ? inputMoney(transaction.amount)
    : draft?.amount
      ? inputMoney(draft.amount)
      : "";

  return (
    <SubmitForm
      label={transaction ? "Сохранить изменения" : "Добавить операцию"}
      onSubmit={async (form) => {
        const amount = parseMoney(String(form.get("amount")));
        const cleanTitle = title.trim();
        if (!cleanTitle)
          throw new Error(
            "Укажите, на что потрачены или откуда получены деньги.",
          );
        if (!dateValue || dateValue > dateKey())
          throw new Error("Дата операции не может быть в будущем.");

        let newCategory: Category | undefined;
        if (addCategory) {
          const name = String(form.get("categoryName")).trim();
          if (!name) throw new Error("Введите название категории.");
          if (
            data.categories.some(
              (c) =>
                c.kind === kind &&
                c.name.toLocaleLowerCase("ru") ===
                  name.toLocaleLowerCase("ru"),
            )
          )
            throw new Error("Такая категория уже есть. Выберите ее в списке.");
          newCategory = {
            id: uid(),
            name,
            kind,
            color: newCatColor,
            icon: newCatIcon,
          };
        }

        const tags = parseTagsInput(tagsRaw);
        const entry: Transaction = {
          id: transaction?.id ?? uid(),
          kind,
          amount,
          title: cleanTitle,
          categoryId: newCategory?.id ?? categoryId,
          date: dateValue,
          note: String(form.get("note")).trim(),
          accountId,
          ...(tags.length ? { tags } : {}),
          createdAt: transaction?.createdAt ?? Date.now(),
        };

        await commit((current) => ({
          ...current,
          categories: newCategory
            ? [...current.categories, newCategory]
            : current.categories,
          transactions: transaction
            ? current.transactions.map((t) =>
                t.id === transaction.id ? entry : t,
              )
            : [...current.transactions, entry],
        }));
        close();
      }}
      footer={
        transaction ? (
          <ConfirmInline
            label="Удалить"
            confirmLabel="Да, удалить"
            onConfirm={async () => {
              await commit((current) => ({
                ...current,
                transactions: current.transactions.filter(
                  (t) => t.id !== transaction.id,
                ),
              }));
              onDeleted?.(transaction);
              close();
            }}
          />
        ) : onOpenQr ? (
          <button
            type="button"
            className="button secondary small"
            onClick={onOpenQr}
          >
            <QrCode size={15} />
            Скан QR чека
          </button>
        ) : undefined
      }
    >
      <div className="segmented type-switch">
        <button
          type="button"
          className={kind === "expense" ? "active expense-text" : ""}
          onClick={() => {
            setKind("expense");
            setCategoryId(
              data.categories.find((c) => c.kind === "expense")?.id ?? "",
            );
          }}
        >
          <ArrowUpRight size={16} />
          Расход
        </button>
        <button
          type="button"
          className={kind === "income" ? "active positive" : ""}
          onClick={() => {
            setKind("income");
            setCategoryId(
              data.categories.find((c) => c.kind === "income")?.id ?? "",
            );
          }}
        >
          <ArrowDownLeft size={16} />
          Доход
        </button>
      </div>

      <MoneyField defaultValue={initialAmountStr} />

      <label>
        {kind === "expense" ? "На что потрачено" : "Откуда получено"}
        <input
          name="title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            kind === "expense"
              ? "Например, продукты во ВкусВилле"
              : "Например, зарплата за месяц"
          }
        />
      </label>

      {suggestions.length > 0 && !transaction && (
        <div className="chip-row" aria-label="Быстрая подстановка названия">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.id}
              className="chip"
              onClick={() => {
                setTitle(s.title);
                setCategoryId(s.categoryId);
                if (s.accountId) setAccountId(s.accountId);
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      <div className="field-label">
        <span>Категория</span>
        <button
          type="button"
          className="text-button"
          onClick={() => setAddCategory(!addCategory)}
        >
          {addCategory ? (
            "Выбрать из списка"
          ) : (
            <>
              <Plus size={14} />
              Новая категория
            </>
          )}
        </button>
      </div>

      {addCategory ? (
        <div className="new-cat-box">
          <input
            name="categoryName"
            aria-label="Название новой категории"
            placeholder="Например, образование"
            maxLength={120}
            required
          />
          <div className="color-swatches" style={{ marginTop: 10 }}>
            {palette.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`Цвет ${c}`}
                className={`color-swatch ${newCatColor === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setNewCatColor(c)}
              />
            ))}
          </div>
          <div className="icon-picker-grid" style={{ marginTop: 10 }}>
            {categoryIconIds.map((id) => {
              const Icon = categoryIcons[id];
              return (
                <button
                  type="button"
                  key={id}
                  className={`icon-pick-btn ${newCatIcon === id ? "active" : ""}`}
                  onClick={() => setNewCatIcon(id)}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="category-chip-grid" role="radiogroup" aria-label="Категория">
          {categories.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`cat-chip ${categoryId === c.id ? "active" : ""}`}
              onClick={() => setCategoryId(c.id)}
            >
              <CategoryIcon category={c} small />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      )}

      <QuickDateField value={dateValue} onChange={setDateValue} />

      {accountOptions.length > 1 && (
        <label>
          Счет
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accountOptions.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        <span>
          <Tag size={12} style={{ marginRight: 5, verticalAlign: "middle" }} />
          Теги <span className="optional">через запятую, необязательно</span>
        </span>
        <input
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="отпуск, работа, кэшбэк"
          maxLength={160}
        />
      </label>

      <label>
        Заметка <span className="optional">необязательно</span>
        <textarea
          name="note"
          maxLength={500}
          rows={2}
          placeholder="Что хочется запомнить"
          defaultValue={transaction?.note ?? draft?.note ?? ""}
        />
      </label>
    </SubmitForm>
  );
}

export function AccountForm({
  data,
  account,
  commit,
  close,
}: {
  data: Data;
  account?: Account;
  commit: Commit;
  close: () => void;
}) {
  const [type, setType] = useState<AccountType>(account?.type ?? "card");
  const [color, setColor] = useState(
    account?.color ?? palette[data.accounts.length % palette.length],
  );
  const [deleteErr, setDeleteErr] = useState("");
  const canArchive =
    Boolean(account) &&
    (account?.archived || data.accounts.filter((a) => !a.archived).length > 1);

  return (
    <SubmitForm
      label={account ? "Сохранить счет" : "Добавить счет"}
      onSubmit={async (form) => {
        const name = String(form.get("name")).trim();
        if (!name) throw new Error("Введите название счета.");
        const initialBalance = parseMoney(
          String(form.get("initialBalance")),
          true,
        );
        const next: Account = {
          id: account?.id ?? uid(),
          name,
          type,
          initialBalance,
          color,
          ...(account?.archived ? { archived: true } : {}),
        };
        await commit((current) => {
          const accounts = account
            ? current.accounts.map((a) => (a.id === next.id ? next : a))
            : [...current.accounts, next];
          return {
            ...current,
            accounts,
            openingBalance: accounts.reduce(
              (s, a) => s + a.initialBalance,
              0,
            ),
          };
        });
        close();
      }}
      footer={
        account && (
          <div className="chip-row">
            {canArchive && (
              <button
                type="button"
                className="button ghost small"
                onClick={async () => {
                  await commit((current) => ({
                    ...current,
                    accounts: current.accounts.map((a) =>
                      a.id === account.id
                        ? { ...a, archived: !a.archived }
                        : a,
                    ),
                  }));
                  close();
                }}
              >
                {account.archived ? (
                  <>
                    <ArchiveRestore size={15} />
                    Вернуть
                  </>
                ) : (
                  <>
                    <Archive size={15} />
                    В архив
                  </>
                )}
              </button>
            )}
            {data.accounts.length > 1 && (
              <ConfirmInline
                label="Удалить"
                confirmLabel="Удалить"
                onConfirm={async () => {
                  try {
                    await commit((current) =>
                      deleteAccountSafe(current, account.id),
                    );
                    close();
                  } catch (e) {
                    setDeleteErr(
                      e instanceof Error ? e.message : "Не удалось удалить.",
                    );
                  }
                }}
              />
            )}
          </div>
        )
      }
    >
      {deleteErr && (
        <p className="form-error" role="alert">
          {deleteErr}
        </p>
      )}
      <label>
        Название счета
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={account?.name}
          placeholder="Например, Т-Банк, Наличные, Кредитка"
        />
      </label>
      <label>
        Тип счета
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AccountType)}
        >
          <option value="card">Банковская карта</option>
          <option value="cash">Наличные</option>
          <option value="credit">Кредитная карта</option>
          <option value="savings">Накопительный счет</option>
        </select>
      </label>
      <MoneyField
        name="initialBalance"
        label="Начальный остаток на счете, ₽"
        defaultValue={inputMoney(account?.initialBalance ?? 0)}
        zero
      />
      <div className="field-label">
        <span>Цвет счета</span>
      </div>
      <div className="color-swatches">
        {palette.map((c) => (
          <button
            type="button"
            key={c}
            className={`color-swatch ${color === c ? "active" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
    </SubmitForm>
  );
}

export function AccountTransferForm({
  data,
  commit,
  close,
}: {
  data: Data;
  commit: Commit;
  close: () => void;
}) {
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const list = activeAccounts.length >= 2 ? activeAccounts : data.accounts;
  const [fromId, setFromId] = useState(list[0]?.id ?? "");
  const [toId, setToId] = useState(list[1]?.id ?? list[0]?.id ?? "");
  const [dateValue, setDateValue] = useState(dateKey());

  return (
    <SubmitForm
      label="Перевести между счетами"
      onSubmit={async (form) => {
        if (fromId === toId)
          throw new Error("Выберите два разных счета для перевода.");
        const amount = parseMoney(String(form.get("amount")));
        if (!dateValue || dateValue > dateKey())
          throw new Error("Дата перевода не может быть в будущем.");
        await commit((current) => ({
          ...current,
          transfers: [
            ...current.transfers,
            {
              id: uid(),
              fromAccountId: fromId,
              toAccountId: toId,
              amount,
              date: dateValue,
              note: String(form.get("note")).trim(),
              createdAt: Date.now(),
            },
          ],
        }));
        close();
      }}
    >
      <div className="two-fields">
        <label>
          Откуда
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Куда
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MoneyField />
      <QuickDateField value={dateValue} onChange={setDateValue} />
      <label>
        Примечание <span className="optional">необязательно</span>
        <input
          name="note"
          maxLength={500}
          placeholder="Например, снятие наличных"
        />
      </label>
      <p className="form-hint">
        <Info size={16} />
        Перевод меняет остатки выбранных счетов, но не меняет общие доходы и
        расходы.
      </p>
    </SubmitForm>
  );
}

export function CategoryManager({
  data,
  commit,
}: {
  data: Data;
  commit: Commit;
}) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(palette[0]);
  const [icon, setIcon] = useState<CategoryIconId>("grid");
  const [err, setErr] = useState("");

  const list = data.categories.filter((c) => c.kind === kind);

  const startEdit = (cat?: Category) => {
    setErr("");
    if (cat) {
      setEditing(cat);
      setName(cat.name);
      setColor(cat.color);
      setIcon((cat.icon as CategoryIconId) || "grid");
    } else {
      setEditing({
        id: "",
        name: "",
        kind,
        color: palette[data.categories.length % palette.length],
        icon: "grid",
      });
      setName("");
      setColor(palette[data.categories.length % palette.length]);
      setIcon("grid");
    }
  };

  return (
    <div className="form">
      <div className="section-toolbar" style={{ marginBottom: 12 }}>
        <div className="segmented">
          <button
            type="button"
            className={kind === "expense" ? "active" : ""}
            onClick={() => {
              setKind("expense");
              setEditing(null);
            }}
          >
            Расходы
          </button>
          <button
            type="button"
            className={kind === "income" ? "active" : ""}
            onClick={() => {
              setKind("income");
              setEditing(null);
            }}
          >
            Доходы
          </button>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={() => startEdit()}
        >
          <Plus size={15} />
          Добавить
        </button>
      </div>

      {err && <p className="form-error">{err}</p>}

      {editing && (
        <div
          className="glass-surface card"
          style={{ padding: 16, marginBottom: 14 }}
        >
          <label>
            {editing.id ? "Переименовать категорию" : "Новая категория"}
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Название категории"
            />
          </label>
          <div className="color-swatches" style={{ marginTop: 10 }}>
            {palette.map((c) => (
              <button
                type="button"
                key={c}
                className={`color-swatch ${color === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="icon-picker-grid" style={{ marginTop: 10 }}>
            {categoryIconIds.map((id) => {
              const Icon = categoryIcons[id];
              return (
                <button
                  type="button"
                  key={id}
                  className={`icon-pick-btn ${icon === id ? "active" : ""}`}
                  onClick={() => setIcon(id)}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
          <div className="form-footer" style={{ marginTop: 12, paddingTop: 12 }}>
            <button
              type="button"
              className="button ghost small"
              onClick={() => setEditing(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="button primary small"
              onClick={async () => {
                const clean = name.trim();
                if (!clean) {
                  setErr("Введите название категории.");
                  return;
                }
                const duplicate = data.categories.some(
                  (c) =>
                    c.id !== editing.id &&
                    c.kind === kind &&
                    c.name.toLocaleLowerCase("ru") ===
                      clean.toLocaleLowerCase("ru"),
                );
                if (duplicate) {
                  setErr("Такая категория уже существует.");
                  return;
                }
                try {
                  await commit((current) => ({
                    ...current,
                    categories: editing.id
                      ? current.categories.map((c) =>
                          c.id === editing.id
                            ? { ...c, name: clean, color, icon }
                            : c,
                        )
                      : [
                          ...current.categories,
                          { id: uid(), name: clean, kind, color, icon },
                        ],
                  }));
                  setEditing(null);
                  setErr("");
                } catch (e) {
                  setErr(
                    e instanceof Error ? e.message : "Не удалось сохранить.",
                  );
                }
              }}
            >
              Сохранить
            </button>
          </div>
        </div>
      )}

      <div>
        {list.map((c) => (
          <div className="category-manager-row" key={c.id}>
            <CategoryIcon category={c} small />
            <span>{c.name}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Изменить: ${c.name}`}
              onClick={() => startEdit(c)}
            >
              <Pencil size={15} />
            </button>
            <ConfirmInline
              iconOnly
              ariaLabel={`Удалить категорию: ${c.name}`}
              onConfirm={async () => {
                try {
                  await commit((current) => deleteCategorySafe(current, c.id));
                  setErr("");
                } catch (e) {
                  setErr(
                    e instanceof Error ? e.message : "Не удалось удалить.",
                  );
                }
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BudgetForm({
  category,
  data,
  commit,
  close,
}: {
  category: Category;
  data: Data;
  commit: Commit;
  close: () => void;
}) {
  return (
    <SubmitForm
      onSubmit={async (form) => {
        const amount = parseMoney(String(form.get("amount")), true);
        await commit((current) => ({
          ...current,
          limits: { ...current.limits, [category.id]: amount },
        }));
        close();
      }}
    >
      <MoneyField
        label="Лимит на период, ₽"
        defaultValue={inputMoney(data.limits[category.id] ?? 0)}
        zero
      />
      <p className="form-hint">
        <Info size={16} />
        Лимит повторяется каждый расчетный период. При достижении 80% появится
        предупреждение. Введите 0, чтобы убрать лимит.
      </p>
    </SubmitForm>
  );
}

export function EntityForm({
  debt,
  entity,
  defaultDirection = "owe",
  commit,
  close,
}: {
  debt: boolean;
  entity?: Saving | Debt;
  defaultDirection?: DebtDirection;
  commit: Commit;
  close: () => void;
}) {
  const existingDebt = entity && "dueDate" in entity ? entity : undefined;
  const [direction, setDirection] = useState<DebtDirection>(
    existingDebt?.direction ?? defaultDirection,
  );
  const [color, setColor] = useState(
    entity && "color" in entity ? entity.color : palette[0],
  );

  return (
    <SubmitForm
      label={entity ? "Сохранить" : debt ? "Добавить долг" : "Создать цель"}
      onSubmit={async (form) => {
        const name = String(form.get("name")).trim();
        if (!name) throw new Error("Введите название.");
        const initial =
          entity?.initial ?? parseMoney(String(form.get("initial")), true);
        const common = {
          id: entity?.id ?? uid(),
          name,
          initial,
          startDate: entity?.startDate ?? dateKey(),
          ...(entity?.archived ? { archived: true } : {}),
        };
        if (debt) {
          const rateRaw = String(form.get("interestRate") ?? "")
            .trim()
            .replace(",", ".");
          let interestRate: number | undefined;
          if (rateRaw) {
            const parsedRate = Number(rateRaw);
            if (
              !Number.isFinite(parsedRate) ||
              parsedRate < 0 ||
              parsedRate > 1000
            )
              throw new Error("Укажите ставку от 0 до 1000% годовых.");
            interestRate = parsedRate;
          }
          const entry: Debt = {
            ...common,
            dueDate: String(form.get("dueDate")),
            direction,
            ...(interestRate !== undefined ? { interestRate } : {}),
          };
          await commit((current) => ({
            ...current,
            debts: entity
              ? current.debts.map((d) => (d.id === entry.id ? entry : d))
              : [...current.debts, entry],
          }));
        } else {
          const entry: Saving = {
            ...common,
            target: parseMoney(String(form.get("target"))),
            color,
          };
          await commit((current) => ({
            ...current,
            savings: entity
              ? current.savings.map((s) => (s.id === entry.id ? entry : s))
              : [...current.savings, entry],
          }));
        }
        close();
      }}
      footer={
        entity && (
          <div className="chip-row">
            <button
              type="button"
              className="button ghost small"
              onClick={async () => {
                await commit((current) => ({
                  ...current,
                  savings: debt
                    ? current.savings
                    : current.savings.map((s) =>
                        s.id === entity.id
                          ? { ...s, archived: !s.archived }
                          : s,
                      ),
                  debts: debt
                    ? current.debts.map((d) =>
                        d.id === entity.id
                          ? { ...d, archived: !d.archived }
                          : d,
                      )
                    : current.debts,
                }));
                close();
              }}
            >
              {entity.archived ? (
                <>
                  <ArchiveRestore size={15} />
                  Из архива
                </>
              ) : (
                <>
                  <Archive size={15} />
                  В архив
                </>
              )}
            </button>
            <ConfirmInline
              label="Удалить"
              confirmLabel="Удалить"
              onConfirm={async () => {
                await commit((current) =>
                  deleteEntitySafe(
                    current,
                    entity.id,
                    debt ? "debt" : "saving",
                  ),
                );
                close();
              }}
            />
          </div>
        )
      }
    >
      {debt && (
        <div className="segmented type-switch">
          <button
            type="button"
            className={direction === "owe" ? "active" : ""}
            onClick={() => setDirection("owe")}
          >
            Я должен
          </button>
          <button
            type="button"
            className={direction === "owed" ? "active" : ""}
            onClick={() => setDirection("owed")}
          >
            Мне должны
          </button>
        </div>
      )}

      <label>
        {debt
          ? direction === "owed"
            ? "Кто и за что должен вам"
            : "Кому или за что должны"
          : "На что копим"}
        <input
          name="name"
          maxLength={120}
          required
          defaultValue={entity?.name}
          placeholder={
            debt
              ? direction === "owed"
                ? "Например, одолжил Алексею"
                : "Например, кредит на ноутбук"
              : "Например, путешествие к морю"
          }
        />
      </label>

      {!debt && (
        <>
          <MoneyField
            name="target"
            label="Хочу накопить, ₽"
            defaultValue={
              entity && "target" in entity ? inputMoney(entity.target) : ""
            }
          />
          <div className="field-label">
            <span>Цвет цели</span>
          </div>
          <div className="color-swatches">
            {palette.map((c) => (
              <button
                type="button"
                key={c}
                className={`color-swatch ${color === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </>
      )}

      {!entity && (
        <MoneyField
          name="initial"
          label={
            debt ? "Текущая сумма долга, ₽" : "Уже накоплено отдельно, ₽"
          }
          defaultValue="0"
          zero
        />
      )}

      {debt && (
        <div className="two-fields">
          <label>
            Вернуть до
            <input
              name="dueDate"
              type="date"
              required
              min={entity?.startDate ?? dateKey()}
              max="2199-12-31"
              defaultValue={existingDebt?.dueDate ?? dateKey()}
            />
          </label>
          <label>
            Ставка, % годовых <span className="optional">необязательно</span>
            <input
              name="interestRate"
              inputMode="decimal"
              defaultValue={
                existingDebt?.interestRate !== undefined
                  ? String(existingDebt.interestRate)
                  : ""
              }
              placeholder="0"
            />
          </label>
        </div>
      )}

      <p className="form-hint">
        <ShieldCheck size={17} />
        {debt
          ? "Существующий долг не меняет доступный остаток. Платежи и возвраты вносятся отдельно."
          : "Уже накопленная сумма хранится отдельно от доступных денег. Новые взносы уменьшат доступный остаток."}
      </p>
    </SubmitForm>
  );
}

export function TransferForm({
  data,
  entity,
  debt,
  commit,
  close,
}: {
  data: Data;
  entity: Saving | Debt;
  debt: boolean;
  commit: Commit;
  close: () => void;
}) {
  const isOwed = debt && "direction" in entity && entity.direction === "owed";
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const accountOptions = activeAccounts.length ? activeAccounts : data.accounts;
  const [direction, setDirection] = useState(1);
  const [dateValue, setDateValue] = useState(dateKey());
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "main");
  const balance = entityBalance(data, entity, debt ? "debt" : "saving");

  const cashWillIncrease =
    (isOwed && direction === 1) || (!isOwed && direction === -1);

  return (
    <SubmitForm
      label="Подтвердить перевод"
      onSubmit={async (form) => {
        const amount = parseMoney(String(form.get("amount")));
        if (dateValue < entity.startDate)
          throw new Error("Дата перевода не может быть раньше даты создания.");
        if (dateValue > dateKey())
          throw new Error("Дата перевода не может быть в будущем.");
        if (debt && direction === 1 && amount > balance)
          throw new Error(
            isOwed
              ? "Возврат не может превышать остаток долга."
              : "Платеж не может быть больше остатка долга.",
          );
        if (!debt && direction === -1 && amount > balance)
          throw new Error("Нельзя снять больше, чем накоплено.");
        const note = String(form.get("note") ?? "").trim();
        await commit((current) => ({
          ...current,
          movements: [
            ...current.movements,
            {
              id: uid(),
              entityId: entity.id,
              entityType: debt ? "debt" : "saving",
              amount: amount * direction,
              date: dateValue,
              accountId,
              ...(note ? { note } : {}),
              createdAt: Date.now(),
            },
          ],
        }));
        close();
      }}
    >
      <div className="segmented type-switch">
        <button
          type="button"
          className={direction === 1 ? "active" : ""}
          onClick={() => setDirection(1)}
        >
          {isOwed ? "Мне вернули" : debt ? "Погасить" : "Пополнить"}
        </button>
        <button
          type="button"
          className={direction === -1 ? "active" : ""}
          onClick={() => setDirection(-1)}
        >
          {isOwed ? "Одолжить еще" : debt ? "Получить еще" : "Снять"}
        </button>
      </div>
      <div className="transfer-summary">
        <span>
          {isOwed
            ? "Должны вернуть"
            : debt
              ? "Остаток долга"
              : "Уже накоплено"}
        </span>
        <strong>
          <Money amount={balance} />
        </strong>
      </div>
      <MoneyField />
      <QuickDateField
        value={dateValue}
        onChange={setDateValue}
        min={entity.startDate}
      />
      {accountOptions.length > 1 && (
        <label>
          Счет
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Примечание <span className="optional">необязательно</span>
        <input
          name="note"
          maxLength={500}
          placeholder="Комментарий к переводу"
        />
      </label>
      <p className="form-hint">
        <Info size={17} />
        Перевод {cashWillIncrease ? "увеличит" : "уменьшит"} доступный остаток.
        В доходах и расходах он не дублируется.
      </p>
    </SubmitForm>
  );
}

export function ReminderForm({
  data,
  reminder,
  commit,
  close,
}: {
  data: Data;
  reminder?: Reminder;
  commit: Commit;
  close: () => void;
}) {
  const [type, setType] = useState<Reminder["type"]>(reminder?.type ?? "bill");
  const [recurrence, setRecurrence] = useState<Recurrence>(
    reminder?.recurrence ?? "none",
  );
  const [categoryId, setCategoryId] = useState(
    reminder?.categoryId ??
      data.categories.find((c) => c.kind === "expense" && c.id === "home")?.id ??
      "",
  );
  const [entityId, setEntityId] = useState(reminder?.entityId ?? "");
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const accountOptions = activeAccounts.length ? activeAccounts : data.accounts;
  const [accountId, setAccountId] = useState(
    reminder?.accountId ?? accountOptions[0]?.id ?? "main",
  );

  const expenseCategories = data.categories.filter((c) => c.kind === "expense");
  const linkedEntities =
    type === "saving"
      ? data.savings.filter((s) => !s.archived)
      : data.debts.filter((d) => !d.archived && d.direction !== "owed");

  return (
    <SubmitForm
      label={reminder ? "Сохранить" : "Создать напоминание"}
      onSubmit={async (form) => {
        const title = String(form.get("title")).trim();
        if (!title) throw new Error("Введите название напоминания.");
        const entry: Reminder = {
          id: reminder?.id ?? uid(),
          title,
          amount: parseMoney(String(form.get("amount")), true),
          date: String(form.get("date")),
          time: String(form.get("time")),
          type,
          done: reminder?.done ?? false,
          recurrence,
          accountId,
          ...(type === "bill" && categoryId ? { categoryId } : {}),
          ...(type !== "bill" && entityId ? { entityId } : {}),
        };
        await commit((current) => ({
          ...current,
          reminders: reminder
            ? current.reminders.map((r) => (r.id === entry.id ? entry : r))
            : [...current.reminders, entry],
        }));
        close();
      }}
    >
      <label>
        О чем напомнить
        <input
          name="title"
          required
          maxLength={120}
          defaultValue={reminder?.title}
          placeholder="Например, оплатить интернет"
        />
      </label>
      <div className="two-fields">
        <label>
          Тип
          <select
            name="type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as Reminder["type"]);
              setEntityId("");
            }}
          >
            <option value="bill">Счет или подписка</option>
            <option value="credit">Платеж по кредиту</option>
            <option value="saving">Взнос в накопления</option>
          </select>
        </label>
        <label>
          Повторение
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as Recurrence)}
          >
            <option value="none">Один раз</option>
            <option value="weekly">Еженедельно</option>
            <option value="monthly">Ежемесячно</option>
            <option value="yearly">Ежегодно</option>
          </select>
        </label>
      </div>
      <MoneyField
        defaultValue={reminder ? inputMoney(reminder.amount) : "0"}
        zero
        label="Сумма (0 — без суммы), ₽"
      />
      <div className="two-fields">
        <label>
          Дата
          <input
            name="date"
            type="date"
            min={reminder?.date ?? dateKey()}
            max="2199-12-31"
            defaultValue={reminder?.date ?? dateKey()}
            required
          />
        </label>
        <label>
          Время
          <input
            name="time"
            type="time"
            defaultValue={reminder?.time ?? "10:00"}
            required
          />
        </label>
      </div>
      {type === "bill" ? (
        <label>
          Категория для быстрой оплаты
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        linkedEntities.length > 0 && (
          <label>
            {type === "credit" ? "Связанный долг" : "Связанная цель"}
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">Без привязки (как обычный расход)</option>
              {linkedEntities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )
      )}
      {accountOptions.length > 1 && (
        <label>
          Счет для оплаты
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="form-hint">
        <Info size={17} />
        Нажмите «Оплатить» в списке напоминаний, чтобы сразу записать платеж и
        перенести повторяющееся напоминание на следующий цикл.
      </p>
    </SubmitForm>
  );
}

export function SettingsForm({
  data,
  commit,
  close,
  hasPinLock,
  onSavePin,
  onClearPin,
  onManageCategories,
}: {
  data: Data;
  commit: Commit;
  close: () => void;
  hasPinLock: boolean;
  onSavePin: (record: PinLockRecord) => Promise<void>;
  onClearPin: () => Promise<void>;
  onManageCategories: () => void;
}) {
  const [theme, setTheme] = useState<ThemeMode>(data.preferences.theme);
  const [secondaryCurrency, setSecondaryCurrency] = useState<SecondaryCurrency>(
    data.preferences.secondaryCurrency,
  );
  const [paydayDay, setPaydayDay] = useState(
    String(data.preferences.paydayDay),
  );
  const [hideOnStart, setHideOnStart] = useState(
    data.preferences.hideBalancesOnStart,
  );
  const [pinInput, setPinInput] = useState("");
  const [pinMsg, setPinMsg] = useState("");

  const singleAccount = data.accounts.length === 1;

  return (
    <>
      <SubmitForm
        onSubmit={async (form) => {
          const parsedPayday = Number.parseInt(paydayDay, 10);
          if (
            !Number.isSafeInteger(parsedPayday) ||
            parsedPayday < 1 ||
            parsedPayday > 28
          ) {
            throw new Error("День начала периода должен быть от 1 до 28.");
          }
          const growthPercent = Number.parseInt(
            String(form.get("growthPercent")),
            10,
          );
          if (
            !Number.isSafeInteger(growthPercent) ||
            growthPercent < 10 ||
            growthPercent > 500
          ) {
            throw new Error("Порог роста категории: от 10% до 500%.");
          }
          const growthMinAmount = parseMoney(
            String(form.get("growthMinAmount")),
            true,
          );
          const largeMinAmount = parseMoney(
            String(form.get("largeMinAmount")),
            true,
          );

          const singleBalance = singleAccount
            ? parseMoney(String(form.get("openingBalance")), true)
            : null;

          await commit((current) => {
            const accounts =
              singleBalance !== null && current.accounts.length === 1
                ? [{ ...current.accounts[0], initialBalance: singleBalance }]
                : current.accounts;
            return {
              ...current,
              name: String(form.get("name")).trim(),
              accounts,
              openingBalance: accounts.reduce(
                (s, a) => s + a.initialBalance,
                0,
              ),
              preferences: {
                ...current.preferences,
                theme,
                secondaryCurrency,
                paydayDay: parsedPayday,
                hideBalancesOnStart: hideOnStart,
                insightThresholds: {
                  growthPercent,
                  growthMinAmount,
                  largeMinAmount,
                },
              },
            };
          });
          close();
        }}
      >
        <label>
          Как к вам обращаться
          <input
            name="name"
            maxLength={50}
            defaultValue={data.name}
            placeholder="Ваше имя"
          />
        </label>

        {singleAccount ? (
          <MoneyField
            name="openingBalance"
            label="Начальный доступный остаток, ₽"
            defaultValue={inputMoney(data.accounts[0]?.initialBalance ?? 0)}
            zero
          />
        ) : (
          <p className="form-hint">
            <Info size={16} />
            У вас {data.accounts.length} счетов. Суммарный начальный остаток:{" "}
            {formatRub(
              data.accounts.reduce((s, a) => s + a.initialBalance, 0),
            )}
            . Начальные суммы меняются в карточке каждого счета.
          </p>
        )}

        <label>
          Оформление
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeMode)}
          >
            <option value="glass">Слоистый Glassmorphism (рекомендуется)</option>
            <option value="oled">OLED-строгий (чистый черный, без blur)</option>
            <option value="light">Светлое матовое стекло</option>
          </select>
        </label>

        <div className="two-fields">
          <label>
            Справочная валюта
            <select
              value={secondaryCurrency}
              onChange={(e) =>
                setSecondaryCurrency(e.target.value as SecondaryCurrency)
              }
            >
              {(Object.keys(CURRENCY_NAMES) as SecondaryCurrency[]).map(
                (code) => (
                  <option key={code} value={code}>
                    {CURRENCY_NAMES[code]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            День старта периода (1–28)
            <input
              type="number"
              min={1}
              max={28}
              value={paydayDay}
              onChange={(e) => setPaydayDay(e.target.value)}
              required
            />
          </label>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hideOnStart}
            onChange={(e) => setHideOnStart(e.target.checked)}
          />
          <span>Скрывать балансы при открытии приложения</span>
        </label>

        <div className="two-fields">
          <label>
            Сигнал роста категории (%)
            <input
              name="growthPercent"
              type="number"
              min={10}
              max={500}
              defaultValue={data.preferences.insightThresholds.growthPercent}
              required
            />
          </label>
          <label>
            Мин. разница роста (₽)
            <input
              name="growthMinAmount"
              inputMode="decimal"
              defaultValue={inputMoney(
                data.preferences.insightThresholds.growthMinAmount,
              )}
              required
            />
          </label>
        </div>

        <label>
          Порог крупного платежа (₽)
          <input
            name="largeMinAmount"
            inputMode="decimal"
            defaultValue={inputMoney(
              data.preferences.insightThresholds.largeMinAmount,
            )}
            required
          />
        </label>
      </SubmitForm>

      <div className="settings-section">
        <h3>
          <Layers size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Категории
        </h3>
        <button
          type="button"
          className="button secondary full-width"
          onClick={onManageCategories}
        >
          Управление категориями и иконками
        </button>
      </div>

      <div className="settings-section">
        <h3>
          <LockKeyhole
            size={15}
            style={{ marginRight: 6, verticalAlign: "middle" }}
          />
          PIN-блокировка приложения
        </h3>
        <p>
          {hasPinLock
            ? "PIN-код включен. Запрашивается при запуске приложения."
            : "Задайте 4–8 цифр, чтобы закрыть доступ к финансам."}
        </p>
        <div className="two-fields">
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="4–8 цифр"
            value={pinInput}
            onChange={(e) => {
              setPinMsg("");
              setPinInput(e.target.value.replace(/\D/g, ""));
            }}
          />
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              try {
                const record = await hashPin(pinInput);
                await onSavePin(record);
                setPinInput("");
                setPinMsg("PIN-код сохранен.");
              } catch (e) {
                setPinMsg(
                  e instanceof Error ? e.message : "Ошибка сохранения PIN.",
                );
              }
            }}
          >
            <KeyRound size={15} />
            {hasPinLock ? "Сменить PIN" : "Включить PIN"}
          </button>
        </div>
        {hasPinLock && (
          <button
            type="button"
            className="button ghost danger-text full-width"
            onClick={async () => {
              await onClearPin();
              setPinMsg("PIN-блокировка отключена.");
            }}
          >
            Отключить PIN-код
          </button>
        )}
        {pinMsg && <p className="muted">{pinMsg}</p>}
      </div>
    </>
  );
}

export function CsvImportForm({
  data,
  parsed,
  commit,
  close,
  onImported,
}: {
  data: Data;
  parsed: BankCsvParseResult;
  commit: Commit;
  close: () => void;
  onImported: (count: number) => void;
}) {
  const activeAccounts = data.accounts.filter((a) => !a.archived);
  const accountOptions = activeAccounts.length ? activeAccounts : data.accounts;
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "main");

  return (
    <SubmitForm
      label={`Импортировать (${parsed.items.length})`}
      onSubmit={async () => {
        if (!parsed.items.length)
          throw new Error("В файле не найдено подходящих операций.");
        const now = Date.now();
        const nextEntries: Transaction[] = parsed.items.map((item, idx) => ({
          ...item,
          id: uid(),
          accountId,
          createdAt: now + idx,
        }));
        await commit((current) => ({
          ...current,
          transactions: [...current.transactions, ...nextEntries],
        }));
        onImported(nextEntries.length);
        close();
      }}
    >
      <div className="import-summary">
        <span>
          Найдено операций<strong>{parsed.items.length}</strong>
        </span>
        <span>
          Пропущено строк / переводов<strong>{parsed.skipped}</strong>
        </span>
      </div>
      {accountOptions.length > 1 && (
        <label>
          Зачислить на счет
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {parsed.items.slice(0, 3).map((item, i) => (
        <div className="qr-preview glass-surface" key={i}>
          <div>
            <strong>
              {item.kind === "income" ? "+" : "−"} {formatRub(item.amount)}
            </strong>
            <span>
              {item.date} · {item.title}
            </span>
          </div>
        </div>
      ))}
    </SubmitForm>
  );
}

export function EncryptedRestoreForm({
  envelope,
  onDecrypted,
}: {
  envelope: unknown;
  onDecrypted: (data: Data) => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  return (
    <SubmitForm
      label="Расшифровать копию"
      onSubmit={async () => {
        const restored = await decryptBackup(envelope, passphrase);
        onDecrypted(restored);
      }}
    >
      <label>
        Пароль резервной копии
        <input
          type="password"
          required
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Введите пароль, заданный при сохранении"
        />
      </label>
    </SubmitForm>
  );
}

export function EncryptedExportForm({
  data,
  onExportEncrypted,
}: {
  data: Data;
  onExportEncrypted: (passphrase: string) => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <SubmitForm
      label="Сохранить зашифрованную копию"
      onSubmit={async () => {
        if (passphrase.length < 4)
          throw new Error("Пароль должен быть не короче 4 символов.");
        if (passphrase !== confirm)
          throw new Error("Пароли не совпадают.");
        await onExportEncrypted(passphrase);
      }}
    >
      <p className="muted">
        Операций: {data.transactions.length}. Данные шифруются локально
        алгоритмом AES-GCM-256 (PBKDF2).
      </p>
      <label>
        Пароль для шифрования
        <input
          type="password"
          required
          minLength={4}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Минимум 4 символа"
        />
      </label>
      <label>
        Повторите пароль
        <input
          type="password"
          required
          minLength={4}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Повторите пароль"
        />
      </label>
    </SubmitForm>
  );
}
