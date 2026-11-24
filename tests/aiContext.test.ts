import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFinancialContext,
  buildSystemPrompt,
  getQuickPrompts,
} from "../src/aiContext.ts";
import { decodeData, emptyData } from "../src/domain.ts";

describe("AI context & preferences", () => {
  it("provides backward-compatible AI preference defaults in decodeData", () => {
    const legacy = emptyData() as unknown as Record<string, unknown>;
    const rawPrefs = {
      ...(legacy.preferences as Record<string, unknown>),
    };
    delete rawPrefs.ai;
    legacy.preferences = rawPrefs;

    const decoded = decodeData(legacy);
    assert.deepEqual(decoded.preferences.ai, {
      choice: "undecided",
      modelId: "qwen2.5-3b",
      includeContext: true,
    });

    const explicit = emptyData();
    explicit.preferences.ai = {
      choice: "enabled",
      modelId: "qwen2.5-1.5b",
      includeContext: false,
    };
    const decodedExplicit = decodeData(explicit);
    assert.deepEqual(decodedExplicit.preferences.ai, {
      choice: "enabled",
      modelId: "qwen2.5-1.5b",
      includeContext: false,
    });

    const corrupted = emptyData() as unknown as {
      preferences: Record<string, unknown>;
    };
    corrupted.preferences = {
      ...explicit.preferences,
      ai: {
        choice: "hacked",
        modelId: "https://evil.example/model.gguf",
        includeContext: "yes",
      },
    };
    const decodedFallback = decodeData(corrupted);
    assert.deepEqual(decodedFallback.preferences.ai, {
      choice: "undecided",
      modelId: "qwen2.5-3b",
      includeContext: true,
    });
  });

  it("builds concise deterministic financial context and strips control chars", () => {
    const data = emptyData();
    data.accounts = [
      {
        id: "main",
        name: "Основная\nкарта",
        type: "card",
        initialBalance: 15_000_000, // 150 000 RUB
        color: "#60a5fa",
      },
    ];
    data.transactions = [
      {
        id: "tx-1",
        kind: "income",
        amount: 12_000_000,
        title: "Зарплата",
        categoryId: "salary",
        date: "2026-11-05",
        note: "",
        accountId: "main",
      },
      {
        id: "tx-2",
        kind: "expense",
        amount: 3_500_000,
        title: "Продукты",
        categoryId: "food",
        date: "2026-11-10",
        note: "",
        accountId: "main",
      },
    ];
    data.limits = { food: 3_000_000 };
    data.savings = [
      {
        id: "sav-1",
        name: "Подушка",
        target: 30_000_000,
        initial: 10_000_000,
        startDate: "2026-01-01",
        color: "#34d399",
      },
    ];
    data.debts = [
      {
        id: "debt-1",
        name: "Ипотека",
        initial: 50_000_000,
        startDate: "2025-01-01",
        dueDate: "2030-01-01",
        direction: "owe",
        interestRate: 8,
      },
    ];
    data.reminders = [
      {
        id: "rem-1",
        title: "Аренда",
        amount: 2_500_000,
        date: "2026-11-28",
        time: "12:00",
        type: "bill",
        done: false,
      },
    ];

    const summary = buildFinancialContext(data, "2026-11", "2026-11-20");
    assert.ok(summary.includes("Период:"));
    assert.ok(summary.includes("Основная карта"));
    assert.ok(!summary.includes("Основная\nкарта"));
    assert.ok(summary.includes("117%")); // 35 000 / 30 000
    assert.ok(summary.includes("Подушка"));
    assert.ok(summary.includes("Ипотека"));
    assert.ok(summary.includes("Аренда"));

    const promptWithCtx = buildSystemPrompt(summary);
    assert.ok(promptWithCtx.includes("Актуальная финансовая сводка"));
    assert.ok(promptWithCtx.includes("ИИР"));

    const promptWithoutCtx = buildSystemPrompt(null);
    assert.ok(promptWithoutCtx.includes("отключён по его выбору"));
    assert.ok(!promptWithoutCtx.includes("Основная карта"));
  });

  it("returns distinct page-aware quick prompts", () => {
    const overview = getQuickPrompts("overview");
    const budget = getQuickPrompts("budget");
    const goals = getQuickPrompts("goals");
    assert.equal(overview.length, 3);
    assert.equal(budget.length, 3);
    assert.equal(goals.length, 3);
    assert.notEqual(overview[0].prompt, budget[0].prompt);
    assert.notEqual(goals[0].prompt, budget[0].prompt);
  });
});
