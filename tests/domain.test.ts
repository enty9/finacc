import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accountBalance,
  balances,
  currentPeriodMonth,
  dateKey,
  decodeData,
  deleteAccountSafe,
  deleteCategorySafe,
  emptyData,
  evaluateMoneyExpression,
  exportCsv,
  frequentTemplates,
  insights,
  nextRecurrenceDate,
  parseMoney,
  parseTransactionDate,
  payReminder,
  periodBounds,
  periodTransactions,
  pluralRu,
  safeToSpend,
  tomorrowKey,
} from "../src/domain.ts";

describe("money parsing and arithmetic", () => {
  it("parses plain amounts strictly", () => {
    assert.equal(parseMoney("1234,50"), 123450);
    assert.equal(parseMoney("1 000.05"), 100005);
    assert.equal(parseMoney("0", true), 0);
    assert.throws(() => parseMoney("0"));
    assert.throws(() => parseMoney("1.234"));
    assert.throws(() => parseMoney("1000000000.01"));
  });

  it("evaluates calculator expressions safely", () => {
    assert.equal(evaluateMoneyExpression("450+180"), 63000);
    assert.equal(evaluateMoneyExpression("1200/2"), 60000);
    assert.equal(evaluateMoneyExpression("3*299,50"), 89850);
    assert.equal(evaluateMoneyExpression("(100+50)*2−50"), 25000);
    assert.equal(evaluateMoneyExpression("1000 ÷ 4 × 2"), 50000);
    assert.throws(() => evaluateMoneyExpression("100/0"));
    assert.throws(() => evaluateMoneyExpression("10-50"));
    assert.throws(() => evaluateMoneyExpression("(100+20"));
  });
});

describe("pluralRu", () => {
  it("selects correct Russian plural forms", () => {
    const forms: [string, string, string] = [
      "операция",
      "операции",
      "операций",
    ];
    assert.equal(pluralRu(1, forms), "операция");
    assert.equal(pluralRu(2, forms), "операции");
    assert.equal(pluralRu(4, forms), "операции");
    assert.equal(pluralRu(5, forms), "операций");
    assert.equal(pluralRu(11, forms), "операций");
    assert.equal(pluralRu(21, forms), "операция");
  });
});

describe("v1 -> v2 migration and timezone guard", () => {
  it("migrates v1 snapshot seamlessly into v2", () => {
    const today = dateKey();
    const v1 = {
      version: 1,
      demo: false,
      name: "Анна",
      openingBalance: 500000,
      notifications: false,
      categories: [
        {
          id: "food",
          name: "Продукты",
          kind: "expense",
          color: "#60a5fa",
          icon: "basket",
        },
        {
          id: "salary",
          name: "Зарплата",
          kind: "income",
          color: "#34d399",
          icon: "briefcase",
        },
      ],
      transactions: [
        {
          id: "t1",
          kind: "expense",
          amount: 120000,
          title: "Магазин",
          categoryId: "food",
          date: today,
          note: "",
        },
      ],
      savings: [],
      debts: [],
      movements: [],
      reminders: [],
      limits: { food: 1000000 },
    };

    const migrated = decodeData(v1);
    assert.equal(migrated.version, 2);
    assert.equal(migrated.accounts.length, 1);
    assert.equal(migrated.accounts[0].id, "main");
    assert.equal(migrated.accounts[0].initialBalance, 500000);
    assert.equal(migrated.transactions[0].accountId, "main");
    assert.equal(migrated.preferences.theme, "glass");
    assert.equal(migrated.preferences.paydayDay, 1);
    assert.equal(balances(migrated).cash, 380000);
  });

  it("allows tomorrowKey in decodeData for timezone travel while blocking future user entry", () => {
    const data = emptyData();
    const tomorrow = tomorrowKey();
    data.transactions.push({
      id: "t-tz",
      kind: "expense",
      amount: 10000,
      title: "Перелет",
      categoryId: "other",
      date: tomorrow,
      note: "",
      accountId: "main",
    });

    const decoded = decodeData(data);
    assert.equal(decoded.transactions[0].date, tomorrow);

    const [y, m, d] = tomorrow.split("-");
    assert.throws(() => parseTransactionDate(`${d}.${m}.${y}`));
  });
});

describe("accounts, transfers, and owed debts", () => {
  it("tracks per-account balances, transfers, overdraft, and receivable debts", () => {
    const data = emptyData();
    const today = dateKey();
    data.accounts = [
      {
        id: "card",
        name: "Карта",
        type: "card",
        initialBalance: 100000,
        color: "#60a5fa",
      },
      {
        id: "cash",
        name: "Наличные",
        type: "cash",
        initialBalance: 50000,
        color: "#34d399",
      },
    ];
    data.transfers.push({
      id: "tr1",
      fromAccountId: "card",
      toAccountId: "cash",
      amount: 30000,
      date: today,
      note: "Снятие",
    });
    data.debts.push(
      {
        id: "d-owe",
        name: "Кредит",
        initial: 200000,
        startDate: today,
        dueDate: tomorrowKey(),
        direction: "owe",
      },
      {
        id: "d-owed",
        name: "Одолжил другу",
        initial: 100000,
        startDate: today,
        dueDate: tomorrowKey(),
        direction: "owed",
      },
    );
    // Pay 200 RUB of my debt from cash, and receive 400 RUB back from friend to card
    data.movements.push(
      {
        id: "m1",
        entityId: "d-owe",
        entityType: "debt",
        amount: 20000,
        date: today,
        accountId: "cash",
      },
      {
        id: "m2",
        entityId: "d-owed",
        entityType: "debt",
        amount: 40000,
        date: today,
        accountId: "card",
      },
    );

    assert.equal(accountBalance(data, "card"), 100000 - 30000 + 40000);
    assert.equal(accountBalance(data, "cash"), 50000 + 30000 - 20000);

    const summary = balances(data);
    assert.equal(summary.cash, 170000);
    assert.equal(summary.overdraft, 0);
    assert.equal(summary.debt, 180000);
    assert.equal(summary.receivable, 60000);

    // Deleting cash account preserves total cash invariant
    const merged = deleteAccountSafe(data, "cash");
    assert.equal(merged.accounts.length, 1);
    assert.equal(balances(merged).cash, 170000);
  });
});

describe("payday cycles and safe-to-spend", () => {
  it("computes payday cycles across short months", () => {
    const b1 = periodBounds("2026-02", 15);
    assert.equal(b1.start, "2026-02-15");
    assert.equal(b1.end, "2026-03-14");

    const b2 = periodBounds("2026-01", 28);
    assert.equal(b2.start, "2026-01-28");
    assert.equal(b2.end, "2026-02-27");

    assert.equal(
      currentPeriodMonth(10, new Date("2026-11-05T12:00:00")),
      "2026-10",
    );
    assert.equal(
      currentPeriodMonth(10, new Date("2026-11-10T12:00:00")),
      "2026-11",
    );

    const data = emptyData();
    data.preferences.paydayDay = 10;
    data.transactions.push(
      {
        id: "tx-in",
        kind: "expense",
        amount: 5000,
        title: "Кофе",
        categoryId: "cafe",
        date: "2026-11-12",
        note: "",
        accountId: "main",
      },
      {
        id: "tx-next",
        kind: "expense",
        amount: 5000,
        title: "Кофе позже",
        categoryId: "cafe",
        date: "2026-12-05",
        note: "",
        accountId: "main",
      },
      {
        id: "tx-out",
        kind: "expense",
        amount: 5000,
        title: "Старый цикл",
        categoryId: "cafe",
        date: "2026-11-09",
        note: "",
        accountId: "main",
      },
    );
    assert.equal(periodTransactions(data, "2026-11").length, 2);
  });

  it("calculates safe-to-spend from budget or cash balance minus upcoming bills", () => {
    const data = emptyData();
    data.accounts[0].initialBalance = 3100000;
    data.reminders.push({
      id: "r1",
      title: "Интернет",
      amount: 100000,
      date: "2026-11-25",
      time: "10:00",
      type: "bill",
      done: false,
    });

    const fromBalance = safeToSpend(data, "2026-11", "2026-11-21");
    assert.equal(fromBalance.source, "balance");
    assert.equal(fromBalance.daysLeft, 10);
    assert.equal(fromBalance.remainingPool, 3000000);
    assert.equal(fromBalance.dailySafe, 300000);

    data.limits.food = 1000000;
    data.transactions.push({
      id: "t1",
      kind: "expense",
      amount: 200000,
      title: "Еда",
      categoryId: "food",
      date: "2026-11-20",
      note: "",
      accountId: "main",
    });
    const fromBudget = safeToSpend(data, "2026-11", "2026-11-21");
    assert.equal(fromBudget.source, "budget");
    assert.equal(fromBudget.remainingPool, 800000);
    assert.equal(fromBudget.dailySafe, 80000);
  });
});

describe("reminders, categories, templates, insights and CSV", () => {
  it("pays recurring reminders and advances next date", () => {
    assert.equal(nextRecurrenceDate("2026-01-31", "monthly"), "2026-02-28");
    assert.equal(nextRecurrenceDate("2026-11-24", "weekly"), "2026-12-01");

    const data = emptyData();
    data.reminders.push({
      id: "rem1",
      title: "Аренда",
      amount: 3000000,
      date: "2026-11-24",
      time: "10:00",
      type: "bill",
      done: false,
      recurrence: "monthly",
      categoryId: "home",
      accountId: "main",
    });

    const updated = payReminder(data, data.reminders[0], {
      date: "2026-11-24",
    });
    assert.equal(updated.transactions.length, 1);
    assert.equal(updated.transactions[0].amount, 3000000);
    assert.equal(updated.reminders[0].done, false);
    assert.equal(updated.reminders[0].date, "2026-12-24");
  });

  it("safely deletes category and protects CSV cells from formulas", () => {
    const data = emptyData();
    const today = dateKey();
    data.categories.push({
      id: "custom",
      name: "Хобби",
      kind: "expense",
      color: "#a78bfa",
      icon: "gamepad",
    });
    data.limits.custom = 500000;
    data.transactions.push(
      {
        id: "t1",
        kind: "expense",
        amount: 15000,
        title: "=SUM(A1:A2)",
        categoryId: "custom",
        date: today,
        note: "+malicious",
        accountId: "main",
        tags: ["дом", "отдых"],
      },
      {
        id: "t2",
        kind: "expense",
        amount: 15000,
        title: "=SUM(A1:A2)",
        categoryId: "custom",
        date: today,
        note: "",
        accountId: "main",
      },
    );

    assert.equal(frequentTemplates(data, 3)[0].count, 2);
    const list = insights(data, today.slice(0, 7));
    assert.ok(list.some((i) => i.id.startsWith("duplicate-")));

    const cleaned = deleteCategorySafe(data, "custom");
    assert.ok(!cleaned.categories.some((c) => c.id === "custom"));
    assert.equal(cleaned.transactions[0].categoryId, "other");
    assert.equal(cleaned.limits.custom, undefined);

    const csv = exportCsv(cleaned, today.slice(0, 7));
    assert.ok(csv.includes("\"'=SUM(A1:A2)\""));
    assert.ok(csv.includes("\"'+malicious\""));
    assert.ok(csv.includes("дом, отдых"));
  });
});
