import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeRate,
  dualMoney,
  formatCurrency,
  parseCbrRate,
} from "../src/exchange.ts";

const sampleXml = `<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="24.11.2026" name="Foreign Currency Market">
  <Valute ID="R01235">
    <NumCode>840</NumCode>
    <CharCode>USD</CharCode>
    <Nominal>1</Nominal>
    <Name>Доллар США</Name>
    <Value>92,5000</Value>
  </Valute>
  <Valute ID="R01239">
    <NumCode>978</NumCode>
    <CharCode>EUR</CharCode>
    <Nominal>1</Nominal>
    <Name>Евро</Name>
    <Value>100,2500</Value>
  </Valute>
  <Valute ID="R01335">
    <NumCode>398</NumCode>
    <CharCode>KZT</CharCode>
    <Nominal>100</Nominal>
    <Name>Тенге</Name>
    <Value>19,5000</Value>
  </Valute>
  <Valute ID="R01375">
    <NumCode>156</NumCode>
    <CharCode>CNY</CharCode>
    <Nominal>1</Nominal>
    <Name>Юань</Name>
    <Value>12,8000</Value>
  </Valute>
</ValCurs>`;

describe("CBR exchange rate parsing", () => {
  it("parses multiple currencies with nominal scaling", () => {
    const now = new Date("2026-11-24T12:00:00Z").getTime();
    const rates = parseCbrRate(sampleXml, now);
    assert.equal(rates.date, "2026-11-24");
    assert.equal(rates.rubPerUsd, 92.5);
    assert.equal(rates.rates.EUR, 100.25);
    assert.equal(rates.rates.KZT, 0.195);
    assert.equal(rates.rates.CNY, 12.8);
  });

  it("decodes legacy single-USD cache cleanly", () => {
    const now = new Date("2026-11-24T12:00:00Z").getTime();
    const legacy = decodeRate(
      { rubPerUsd: 90, date: "2026-11-20", checkedAt: now - 1000 },
      now,
    );
    assert.equal(legacy.rubPerUsd, 90);
    assert.equal(legacy.rates.USD, 90);
  });

  it("formats secondary currency or hides when NONE", () => {
    const now = new Date("2026-11-24T12:00:00Z").getTime();
    const rates = parseCbrRate(sampleXml, now);
    assert.ok(formatCurrency(10025, "EUR", rates).includes("1,00"));
    assert.equal(dualMoney(10000, rates, "NONE"), "100\u00a0₽");
    assert.ok(dualMoney(10000, rates, "CNY").includes("CNY") || dualMoney(10000, rates, "CNY").includes("¥"));
  });
});
