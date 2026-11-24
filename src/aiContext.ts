import {
  accountBalance,
  balances,
  categoryTotals,
  changePercent,
  dateKey,
  entityBalance,
  money,
  periodBounds,
  periodTransactions,
  previousPeriod,
  safeToSpend,
  totals,
  type Data,
  type Page,
} from "./domain.ts";

export interface AiQuickPrompt {
  label: string;
  prompt: string;
}

const sanitizeText = (value: string, maxLen = 48): string =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);

/**
 * Builds a compact, deterministic Russian summary of the user's finances
 * for local LLM context without sending raw database dumps or bulky history.
 */
export function buildFinancialContext(
  data: Data,
  month: string,
  today = dateKey(),
): string {
  const bounds = periodBounds(month, data.preferences.paydayDay);
  const currentTx = periodTransactions(data, month);
  const currentFlow = totals(currentTx);
  const prevMonth = previousPeriod(month);
  const prevFlow = totals(periodTransactions(data, prevMonth));

  const bal = balances(data);
  const safe = safeToSpend(data, month, today);
  const netFlow = currentFlow.income - currentFlow.expense;
  const savingsRate =
    currentFlow.income > 0
      ? Math.round((netFlow / currentFlow.income) * 100)
      : null;

  const expDiff = changePercent(currentFlow.expense, prevFlow.expense);
  const incDiff = changePercent(currentFlow.income, prevFlow.income);

  const lines: string[] = [
    `Период: ${bounds.label} (${bounds.start} — ${bounds.end}), сегодня ${today}`,
    `Свободные средства: ${money(bal.cash)}${bal.overdraft > 0 ? `, овердрафт: ${money(bal.overdraft)}` : ""}`,
    `Накопления: ${money(bal.saved)} | Долги (я должен): ${money(bal.debt)}${bal.receivable > 0 ? ` | Мне должны: ${money(bal.receivable)}` : ""}`,
    `Поток за период: доход ${money(currentFlow.income)}${incDiff !== null ? ` (${incDiff >= 0 ? "+" : ""}${incDiff}% к пред.)` : ""}, расход ${money(currentFlow.expense)}${expDiff !== null ? ` (${expDiff >= 0 ? "+" : ""}${expDiff}% к пред.)` : ""}, итог ${money(netFlow)}${savingsRate !== null ? `, норма сбережений ${savingsRate}%` : ""}`,
    `Безопасно тратить в день: ${money(safe.dailySafe)} (осталось дней: ${safe.daysLeft}, доступный лимит: ${money(safe.remainingPool)}, прогноз расхода: ${money(safe.projectedExpense)}, источник: ${safe.source === "budget" ? "бюджет" : "остаток на счетах"})`,
  ];

  const activeAccounts = data.accounts
    .filter((a) => !a.archived)
    .slice(0, 6)
    .map((a) => `${sanitizeText(a.name)}: ${money(accountBalance(data, a.id))}`);
  if (activeAccounts.length > 0) {
    lines.push(`Счета: ${activeAccounts.join("; ")}`);
  }

  const topCategories = categoryTotals(data, month)
    .filter((c) => c.amount > 0 || c.limit > 0)
    .slice(0, 6)
    .map((c) => {
      const name = sanitizeText(c.name);
      if (c.limit > 0) {
        const pct = Math.round((c.amount / c.limit) * 100);
        return `${name}: ${money(c.amount)} / лимит ${money(c.limit)} (${pct}%)`;
      }
      return `${name}: ${money(c.amount)}`;
    });
  if (topCategories.length > 0) {
    lines.push(`Топ категорий расходов: ${topCategories.join("; ")}`);
  } else {
    lines.push("Расходов по категориям за выбранный период пока нет.");
  }

  const activeGoals = data.savings
    .filter((s) => !s.archived)
    .slice(0, 5)
    .map((s) => {
      const cur = entityBalance(data, s, "saving");
      const pct = s.target > 0 ? Math.round((cur / s.target) * 100) : 0;
      return `${sanitizeText(s.name)}: ${money(cur)} из ${money(s.target)} (${pct}%)`;
    });
  if (activeGoals.length > 0) {
    lines.push(`Финансовые цели: ${activeGoals.join("; ")}`);
  }

  const activeDebts = data.debts
    .filter((d) => !d.archived)
    .map((d) => ({ d, bal: entityBalance(data, d, "debt") }))
    .filter((item) => item.bal > 0)
    .slice(0, 5)
    .map(({ d, bal: debtBal }) => {
      const dir = d.direction === "owed" ? "мне должны" : "мой долг";
      const rate = d.interestRate ? `, ${d.interestRate}%` : "";
      const due = d.dueDate ? `, до ${d.dueDate}` : "";
      return `${sanitizeText(d.name)} (${dir}): ${money(debtBal)}${rate}${due}`;
    });
  if (activeDebts.length > 0) {
    lines.push(`Активные долги: ${activeDebts.join("; ")}`);
  }

  const upcomingBills = data.reminders
    .filter((r) => !r.done)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map((r) => `${r.date} ${sanitizeText(r.title)}: ${money(r.amount)}`);
  if (upcomingBills.length > 0) {
    lines.push(
      `Ближайшие платежи (всего непогашено в периоде ${money(safe.upcomingBills)}): ${upcomingBills.join("; ")}`,
    );
  }

  return lines.join("\n");
}

/**
 * Builds the ChatML system prompt for the local Qwen2.5 financial assistant.
 */
export function buildSystemPrompt(contextText: string | null): string {
  const baseRules = [
    "Ты — локальный ИИ-помощник по личным финансам внутри приложения finacc.",
    "Отвечай на русском языке, кратко, структурированно (списками с конкретными цифрами) и по делу.",
    "НЕ придумывай транзакции, суммы, проценты или активы, которых нет в сводке пользователя.",
    "Помогай анализировать бюджет, искать категории для оптимизации расходов, оценивать долговую нагрузку и формировать подушку безопасности.",
    "В вопросах инвестиций обсуждай общие принципы диверсификации, горизонт, риск-профиль, инфляцию и инструменты (вклады, облигации, индексные фонды), без обещаний доходности. Подчёркивай, что ответ не является индивидуальной инвестиционной рекомендацией (ИИР).",
  ].join("\n");

  if (!contextText) {
    return `${baseRules}\n\nКонтекст с цифрами пользователя отключён по его выбору: давай общие практические рекомендации и уточняй нужные суммы вопросами.`;
  }

  return `${baseRules}\n\nАктуальная финансовая сводка пользователя (используй только эти данные):\n${contextText}`;
}

export function getQuickPrompts(page: Page): AiQuickPrompt[] {
  switch (page) {
    case "budget":
      return [
        {
          label: "Где перерасход?",
          prompt: "Посмотри мои категории и лимиты: где риск перерасхода и какие 2–3 траты проще всего сократить в этом месяце?",
        },
        {
          label: "План экономии 15%",
          prompt: "Составь конкретный план, как уменьшить текущие расходы на 15% без жёсткого дискомфорта.",
        },
        {
          label: "Лимиты на месяц",
          prompt: "Оцени текущий дневной лимит «безопасно тратить» и подскажи, как дотянуть до конца периода в плюсе.",
        },
      ];
    case "goals":
      return [
        {
          label: "Подушка или долги?",
          prompt: "Сравни мои накопления и долги: что выгоднее закрывать сначала — долги или копить подушку безопасности?",
        },
        {
          label: "Как ускорить цели",
          prompt: "Сколько нужно откладывать в месяц, чтобы быстрее достичь моих текущих финансовых целей?",
        },
        {
          label: "Куда вложить резерв",
          prompt: "Если у меня остаётся свободный остаток, как разумно распределить его между подушкой безопасности и низкорисковыми инструментами? (Помню, что это не ИИР)",
        },
      ];
    case "transactions":
      return [
        {
          label: "Разбор трат",
          prompt: "Проанализируй мои топ-категории расходов за период: какие выглядят завышенными?",
        },
        {
          label: "Поиск утечек",
          prompt: "По каким статьям чаще всего утекает бюджет и на чём сэкономить в первую очередь?",
        },
        {
          label: "Сравнить с прошлым",
          prompt: "Объясни динамику моих доходов и расходов по сравнению с предыдущим периодом.",
        },
      ];
    case "reports":
      return [
        {
          label: "Норма сбережений",
          prompt: "Оцени мою текущую норму сбережений и свободный денежный поток. Что можно улучшить?",
        },
        {
          label: "План на квартал",
          prompt: "Предложи финансовый план на ближайшие 3 месяца исходя из моих доходов, расходов и целей.",
        },
        {
          label: "Риски бюджета",
          prompt: "Какие главные финансовые риски ты видишь в моей текущей сводке?",
        },
      ];
    case "reminders":
      return [
        {
          label: "Нагрузка по платежам",
          prompt: "Хватит ли моих свободных средств на ближайшие обязательные платежи и как распределить нагрузку?",
        },
        {
          label: "Очередь долгов",
          prompt: "Посоветуй оптимальный порядок погашения моих активных долгов и кредитов.",
        },
        {
          label: "Резерв под счета",
          prompt: "Сколько денег лучше держать на текущем счёте под регулярные платежи, а сколько переводить в накопительный?",
        },
      ];
    case "overview":
    default:
      return [
        {
          label: "Где уменьшить траты?",
          prompt: "Проанализируй мои расходы и подскажи, какие траты стоит уменьшить в первую очередь и сколько это сэкономит.",
        },
        {
          label: "Куда инвестировать?",
          prompt: "Учитывая мою подушку безопасности, долги и свободный поток, с каких базовых вариантов инвестирования (вклады, облигации, фонды) стоит начать? (Не ИИР)",
        },
        {
          label: "Оценка бюджета",
          prompt: "Дай честную оценку моего финансового состояния за текущий период и 3 главных шага на этот месяц.",
        },
      ];
  }
}
