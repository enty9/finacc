import { Money } from "./currency";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Trash2,
  ShieldCheck,
  Info,
} from "lucide-react";
import {
  dateKey,
  entityBalance,
  formatDate,
  inputMoney,
  palette,
  parseMoney,
  parseTransactionDate,
  uid,
  type Category,
  type Data,
  type Debt,
  type Reminder,
  type Saving,
  type Transaction,
} from "./domain";
import { MoneyField, SubmitForm } from "./components";

export type Commit = (update: (data: Data) => Data) => Promise<void>;
export function TransactionForm({
  data,
  transaction,
  commit,
  close,
}: {
  data: Data;
  transaction?: Transaction;
  commit: Commit;
  close: () => void;
}) {
  const [kind, setKind] = useState(transaction?.kind ?? "expense");
  const [categoryId, setCategoryId] = useState(
    transaction?.categoryId ??
      data.categories.find((c) => c.kind === kind)?.id ??
      "",
  );
  const [addCategory, setAddCategory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const categories = data.categories.filter((c) => c.kind === kind);
  return (
    <SubmitForm
      label={transaction ? "Сохранить изменения" : "Добавить операцию"}
      onSubmit={async (form) => {
        const amount = parseMoney(String(form.get("amount")));
        const title = String(form.get("title")).trim();
        const date = parseTransactionDate(String(form.get("date")));
        if (!title)
          throw new Error(
            "Укажите, на что потрачены или откуда получены деньги.",
          );
        let newCategory: Category | undefined;
        if (addCategory) {
          const name = String(form.get("categoryName")).trim();
          if (!name) throw new Error("Введите название категории.");
          if (
            data.categories.some(
              (c) =>
                c.kind === kind &&
                c.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"),
            )
          )
            throw new Error("Такая категория уже есть. Выберите ее в списке.");
          newCategory = {
            id: uid(),
            name,
            kind,
            color: palette[data.categories.length % palette.length],
            icon: "grid",
          };
        }
        const entry: Transaction = {
          id: transaction?.id ?? uid(),
          kind,
          amount,
          title,
          categoryId: newCategory?.id ?? categoryId,
          date,
          note: String(form.get("note")).trim(),
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
        transaction && (
          <button
            type="button"
            className={`button ${confirmDelete ? "danger" : "ghost danger-text"}`}
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              try {
                await commit((current) => ({
                  ...current,
                  transactions: current.transactions.filter(
                    (t) => t.id !== transaction.id,
                  ),
                }));
                close();
              } catch (e) {
                setDeleteError(
                  e instanceof Error
                    ? e.message
                    : "Не удалось удалить операцию. Попробуйте еще раз.",
                );
                setConfirmDelete(false);
              }
            }}
          >
            <Trash2 size={16} />
            {confirmDelete ? "Да, удалить" : "Удалить"}
          </button>
        )
      }
    >
      {deleteError && (
        <p className="form-error" role="alert">
          {deleteError}
        </p>
      )}
      <div className="segmented type-switch">
        <button
          type="button"
          className={kind === "expense" ? "active" : ""}
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
          className={kind === "income" ? "active" : ""}
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
      <MoneyField
        defaultValue={transaction ? inputMoney(transaction.amount) : ""}
      />
      <label>
        {kind === "expense" ? "На что потрачено" : "Откуда получено"}
        <input
          name="title"
          required
          maxLength={120}
          placeholder={
            kind === "expense"
              ? "Например, продукты во ВкусВилле"
              : "Например, зарплата за месяц"
          }
          defaultValue={transaction?.title}
        />
      </label>
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
        <input
          name="categoryName"
          aria-label="Название новой категории"
          placeholder="Например, образование"
          maxLength={120}
          required
        />
      ) : (
        <select
          aria-label="Категория"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
        >
          <option value="" disabled>
            Выберите категорию
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <label>
        Дата операции (ДД.ММ.ГГГГ)
        <input
          type="text"
          name="date"
          required
          placeholder="ДД.ММ.ГГГГ"
          pattern="[0-9]{2}\.[0-9]{2}\.[0-9]{4}"
          maxLength={10}
          defaultValue={formatDate(transaction?.date ?? dateKey())}
        />
      </label>
      <label>
        Заметка <span className="optional">необязательно</span>
        <textarea
          name="note"
          maxLength={500}
          rows={2}
          placeholder="Что хочется запомнить"
          defaultValue={transaction?.note}
        />
      </label>
    </SubmitForm>
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
        label="Лимит на месяц, ₽"
        defaultValue={inputMoney(data.limits[category.id] ?? 0)}
        zero
      />
      <p className="form-hint">
        <Info size={16} />
        Лимит повторяется каждый месяц. При достижении 80% появится
        предупреждение. Введите 0, чтобы убрать лимит.
      </p>
    </SubmitForm>
  );
}
export function EntityForm({
  debt,
  entity,
  commit,
  close,
}: {
  debt: boolean;
  entity?: Saving | Debt;
  commit: Commit;
  close: () => void;
}) {
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
        };
        if (debt) {
          const entry: Debt = {
            ...common,
            dueDate: String(form.get("dueDate")),
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
            color: entity && "color" in entity ? entity.color : palette[0],
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
    >
      <label>
        {debt ? "Кому или за что должны" : "На что копим"}
        <input
          name="name"
          maxLength={120}
          required
          defaultValue={entity?.name}
          placeholder={
            debt
              ? "Например, кредит на ноутбук"
              : "Например, путешествие к морю"
          }
        />
      </label>
      {!debt && (
        <MoneyField
          name="target"
          label="Хочу накопить, ₽"
          defaultValue={
            entity && "target" in entity ? inputMoney(entity.target) : ""
          }
        />
      )}
      {!entity && (
        <MoneyField
          name="initial"
          label={
            debt ? "Текущий остаток долга, ₽" : "Уже накоплено отдельно, ₽"
          }
          defaultValue="0"
          zero
        />
      )}
      {debt && (
        <label>
          Вернуть до
          <input
            name="dueDate"
            type="date"
            required
            min={entity?.startDate ?? dateKey()}
            max="2199-12-31"
            defaultValue={
              entity && "dueDate" in entity ? entity.dueDate : undefined
            }
          />
        </label>
      )}
      <p className="form-hint">
        <ShieldCheck size={17} />
        {debt
          ? "Существующий долг не меняет доступный остаток. Получение новых денег и платежи вносятся отдельно."
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
  const [direction, setDirection] = useState(1);
  const balance = entityBalance(data, entity, debt ? "debt" : "saving");
  return (
    <SubmitForm
      label="Подтвердить перевод"
      onSubmit={async (form) => {
        const amount = parseMoney(String(form.get("amount")));
        if (debt && direction === 1 && amount > balance)
          throw new Error("Платеж не может быть больше остатка долга.");
        if (!debt && direction === -1 && amount > balance)
          throw new Error("Нельзя снять больше, чем накоплено.");
        await commit((current) => ({
          ...current,
          movements: [
            ...current.movements,
            {
              id: uid(),
              entityId: entity.id,
              entityType: debt ? "debt" : "saving",
              amount: amount * direction,
              date: dateKey(),
            },
          ],
        }));
        close();
      }}
    >
      <div className="segmented">
        <button
          type="button"
          className={direction === 1 ? "active" : ""}
          onClick={() => setDirection(1)}
        >
          {debt ? "Погасить" : "Пополнить"}
        </button>
        <button
          type="button"
          className={direction === -1 ? "active" : ""}
          onClick={() => setDirection(-1)}
        >
          {debt ? "Получить еще" : "Снять"}
        </button>
      </div>
      <div className="transfer-summary">
        <span>{debt ? "Остаток долга" : "Уже накоплено"}</span>
        <strong>{<Money amount={balance} />}</strong>
      </div>
      <MoneyField />
      <p className="form-hint">
        <Info size={17} />
        Перевод за сегодня {direction === 1 ? "уменьшит" : "увеличит"} доступный
        остаток. В доходах и расходах он не дублируется.
      </p>
    </SubmitForm>
  );
}
export function ReminderForm({
  reminder,
  commit,
  close,
}: {
  reminder?: Reminder;
  commit: Commit;
  close: () => void;
}) {
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
          type: String(form.get("type")) as Reminder["type"],
          done: reminder?.done ?? false,
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
      <label>
        Тип
        <select name="type" defaultValue={reminder?.type ?? "bill"}>
          <option value="bill">Счет или подписка</option>
          <option value="credit">Платеж по кредиту</option>
          <option value="saving">Взнос в накопления</option>
        </select>
      </label>
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
      <p className="form-hint">
        <Info size={17} />
        Отметка «Готово» закрывает напоминание. Сам платеж или взнос нужно
        внести отдельно.
      </p>
    </SubmitForm>
  );
}
export function SettingsForm({
  data,
  commit,
  close,
}: {
  data: Data;
  commit: Commit;
  close: () => void;
}) {
  return (
    <SubmitForm
      onSubmit={async (form) => {
        await commit((current) => ({
          ...current,
          name: String(form.get("name")).trim(),
          openingBalance: parseMoney(String(form.get("openingBalance")), true),
        }));
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
      <MoneyField
        name="openingBalance"
        label="Начальный доступный остаток, ₽"
        defaultValue={inputMoney(data.openingBalance)}
        zero
      />
      <p className="form-hint">
        <Info size={17} />
        Деньги, которые были у вас до первой операции. Накопления, уже
        отложенные отдельно, сюда не включайте. Валюта учета — российский рубль.
      </p>
    </SubmitForm>
  );
}
