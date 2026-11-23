import { useState } from "react";
import { Bell, Check, CheckCheck, Play, Plus } from "lucide-react";
import { Card, ConfirmInline, Empty, ReminderIcon } from "../components";
import { Money } from "../currency";
import {
  dateKey,
  payReminder,
  type Data,
  type Recurrence,
  type Reminder,
} from "../domain";
import type { Commit } from "../forms";

const recurrenceLabel: Record<Recurrence, string> = {
  none: "",
  weekly: "Еженедельно",
  monthly: "Ежемесячно",
  yearly: "Ежегодно",
};

export function RemindersPage({
  data,
  upcoming,
  android,
  onEnableNotifications,
  onEditReminder,
  onNewReminder,
  commit,
  onError,
  onPaid,
}: {
  data: Data;
  upcoming: Reminder[];
  android: boolean;
  onEnableNotifications: () => Promise<void>;
  onEditReminder: (r: Reminder) => void;
  onNewReminder: () => void;
  commit: Commit;
  onError: (e: unknown) => void;
  onPaid: (title: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const doneList = data.reminders.filter((r) => r.done);
  const list = showDone ? doneList : upcoming;

  return (
    <>
      <div className="notification-settings glass-surface">
        <span className="notification-settings-icon">
          <Bell size={22} strokeWidth={1.6} />
        </span>
        <div>
          <h3>
            {data.notifications
              ? "Напоминания включены"
              : "Пусть важное приходит вовремя"}
          </h3>
          <p>
            {android
              ? "Android напомнит о платежах, даже когда приложение закрыто."
              : "В браузере напоминания видны здесь. Фоновые уведомления доступны на Android."}
          </p>
        </div>
        <button
          type="button"
          className={`button ${data.notifications ? "secondary" : "primary"}`}
          disabled={!android}
          onClick={async () => {
            try {
              if (!data.notifications) await onEnableNotifications();
              await commit((d) => ({
                ...d,
                notifications: !d.notifications,
              }));
            } catch (e) {
              onError(e);
            }
          }}
        >
          {data.notifications ? "Отключить" : "Включить"}
        </button>
      </div>

      <div className="section-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={!showDone ? "active" : ""}
            onClick={() => setShowDone(false)}
          >
            Предстоящие <span>{upcoming.length}</span>
          </button>
          <button
            type="button"
            className={showDone ? "active" : ""}
            onClick={() => setShowDone(true)}
          >
            Готово <span>{doneList.length}</span>
          </button>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={onNewReminder}
        >
          <Plus size={16} />
          Напоминание
        </button>
      </div>

      <Card className="reminder-page-list">
        {list.length ? (
          list.map((reminder) => {
            const overdue = reminder.date < dateKey() && !reminder.done;
            const rec = reminder.recurrence ?? "none";
            return (
              <div
                className={`reminder-row ${reminder.done ? "done" : ""}`}
                key={reminder.id}
              >
                <ReminderIcon type={reminder.type} />
                <button
                  type="button"
                  className="reminder-info"
                  onClick={() => onEditReminder(reminder)}
                >
                  <strong>{reminder.title}</strong>
                  <span className={overdue ? "warm" : ""}>
                    {new Date(`${reminder.date}T12:00:00`).toLocaleDateString(
                      "ru-RU",
                      { day: "numeric", month: "long" },
                    )}{" "}
                    · {reminder.time}
                    {overdue ? " · просрочено" : ""}
                    {rec !== "none" && (
                      <span className="recurrence-badge">
                        {recurrenceLabel[rec]}
                      </span>
                    )}
                  </span>
                </button>
                {reminder.amount > 0 && (
                  <strong className="reminder-amount">
                    <Money amount={reminder.amount} />
                  </strong>
                )}
                {!reminder.done && reminder.amount > 0 && (
                  <button
                    type="button"
                    className="button secondary small"
                    aria-label={`Оплатить: ${reminder.title}`}
                    onClick={async () => {
                      try {
                        await commit((d) => payReminder(d, reminder));
                        onPaid(reminder.title);
                      } catch (e) {
                        onError(e);
                      }
                    }}
                  >
                    <Play size={13} />
                    Оплатить
                  </button>
                )}
                <button
                  type="button"
                  className={`icon-button completion ${reminder.done ? "completed" : ""}`}
                  aria-label={
                    reminder.done
                      ? `Вернуть: ${reminder.title}`
                      : `Готово: ${reminder.title}`
                  }
                  onClick={() =>
                    commit((d) => ({
                      ...d,
                      reminders: d.reminders.map((r) =>
                        r.id === reminder.id ? { ...r, done: !r.done } : r,
                      ),
                    })).catch(onError)
                  }
                >
                  <Check size={17} />
                </button>
                <ConfirmInline
                  iconOnly
                  ariaLabel={`Удалить напоминание: ${reminder.title}`}
                  onConfirm={async () => {
                    try {
                      await commit((d) => ({
                        ...d,
                        reminders: d.reminders.filter(
                          (r) => r.id !== reminder.id,
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
          <Empty
            title={showDone ? "Все еще впереди" : "Можно спокойно выдохнуть"}
            description={
              showDone
                ? "Выполненные напоминания появятся здесь."
                : "Добавьте важный счет, платеж по кредиту или взнос в накопления."
            }
            icon={Bell}
            action={showDone ? undefined : "Создать напоминание"}
            onAction={onNewReminder}
          />
        )}
      </Card>

      <p className="page-footnote">
        <CheckCheck size={16} />
        Кнопка «Оплатить» сразу записывает расход или перевод и переносит
        повторяющееся напоминание. Отметка галочкой лишь закрывает напоминание.
      </p>
    </>
  );
}
