import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../src/domain.ts";
import { parseBankCsv, parseFnsQr } from "../src/import.ts";

describe("FNS QR receipt parser", () => {
  it("parses valid FNS QR payload", () => {
    const qr =
      "t=20261124T1435&s=1245.50&fn=7281440500000001&i=456&fp=987654321&n=1";
    const res = parseFnsQr(qr);
    assert.ok(res);
    assert.equal(res.amount, 124550);
    assert.equal(res.date, "2026-11-24");
    assert.ok(res.note.includes("ФН 7281440500000001"));
  });

  it("returns null on invalid QR payload", () => {
    assert.equal(parseFnsQr("hello world"), null);
    assert.equal(parseFnsQr("t=20990101T1000&s=100"), null);
  });
});

describe("Bank CSV statement parser", () => {
  it("imports semicolon-delimited Russian CSV and skips transfers", () => {
    const data = emptyData();
    const csv = `\uFEFFДата;Тип;Категория;Описание;Сумма (RUB);Примечание;Теги
24.11.2026;Расход;Продукты;"Магнит; у дома";1 250,50;Ужин;еда,дом
24.11.2026;Доход;Зарплата;Аванс;45000,00;;работа
24.11.2026;Взнос в накопления;Перевод;Отпуск;5000,00;Не включается в доходы;
`;
    const result = parseBankCsv(csv, data.categories, "main");
    assert.equal(result.items.length, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.items[0].kind, "expense");
    assert.equal(result.items[0].amount, 125050);
    assert.equal(result.items[0].categoryId, "food");
    assert.deepEqual(result.items[0].tags, ["еда", "дом"]);
    assert.equal(result.items[1].kind, "income");
    assert.equal(result.items[1].categoryId, "salary");
  });

  it("imports comma-delimited bank CSV with separate Debit/Credit columns", () => {
    const data = emptyData();
    const csv = `Date,Description,Debit,Credit
2026-11-20,"Taxi Ride","450.00",
2026-11-21,"Cashback",,"120.00"
`;
    const result = parseBankCsv(csv, data.categories, "main");
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].kind, "expense");
    assert.equal(result.items[0].amount, 45000);
    assert.equal(result.items[1].kind, "income");
    assert.equal(result.items[1].amount, 12000);
  });
});
