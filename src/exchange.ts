import { validDate, money } from "./domain.ts";

export const RATE_INTERVAL = 60 * 60 * 1000;

export type CurrencyCode = "RUB" | "USD" | "EUR" | "CNY" | "KZT" | "BYN";
export type SecondaryCurrency = Exclude<CurrencyCode, "RUB"> | "NONE";

export const SECONDARY_CURRENCIES: Exclude<CurrencyCode, "RUB">[] = [
  "USD",
  "EUR",
  "CNY",
  "KZT",
  "BYN",
];

export const CURRENCY_NAMES: Record<SecondaryCurrency, string> = {
  USD: "Доллар США (USD)",
  EUR: "Евро (EUR)",
  CNY: "Китайский юань (CNY)",
  KZT: "Казахстанский тенге (KZT)",
  BYN: "Белорусский рубль (BYN)",
  NONE: "Не показывать",
};

export interface ExchangeRates {
  rubPerUsd: number;
  rates: Record<string, number>;
  date: string;
  checkedAt: number;
}

export type ExchangeRate = ExchangeRates;

export function decodeRate(value: unknown, now = Date.now()): ExchangeRates {
  if (!value || typeof value !== "object")
    throw new Error("Курс валют недоступен.");
  const r = value as Partial<ExchangeRates> & {
    rates?: Record<string, unknown>;
  };
  if (
    typeof r.rubPerUsd !== "number" ||
    !Number.isFinite(r.rubPerUsd) ||
    r.rubPerUsd < 0.01 ||
    r.rubPerUsd > 1_000_000 ||
    !validDate(r.date) ||
    new Date(`${r.date}T00:00:00Z`).getTime() > now + 7 * 86400000 ||
    typeof r.checkedAt !== "number" ||
    !Number.isSafeInteger(r.checkedAt) ||
    r.checkedAt <= 0 ||
    r.checkedAt > now + 60000
  )
    throw new Error("Источник вернул некорректный курс валют.");

  const rates: Record<string, number> = { USD: r.rubPerUsd };
  if (r.rates && typeof r.rates === "object" && !Array.isArray(r.rates)) {
    for (const code of SECONDARY_CURRENCIES) {
      const val = r.rates[code];
      if (
        typeof val === "number" &&
        Number.isFinite(val) &&
        val >= 0.0001 &&
        val <= 1_000_000
      ) {
        rates[code] = val;
      }
    }
  }
  rates.USD = r.rubPerUsd;
  return {
    rubPerUsd: r.rubPerUsd,
    rates,
    date: r.date,
    checkedAt: r.checkedAt,
  };
}

export function parseCbrRate(xml: string, now = Date.now()): ExchangeRates {
  if (xml.length > 512000)
    throw new Error("Ответ сервиса курсов слишком большой.");
  const date = xml.match(/<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!date) throw new Error("Не удалось прочитать дату курса из ответа ЦБ.");

  const rates: Record<string, number> = {};
  const valutePattern = /<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g;
  for (const match of xml.matchAll(valutePattern)) {
    const block = match[1];
    const code = block.match(/<CharCode>([A-Z]{3})<\/CharCode>/)?.[1];
    if (
      !code ||
      !SECONDARY_CURRENCIES.includes(
        code as Exclude<CurrencyCode, "RUB">,
      )
    )
      continue;
    const nominal = block.match(/<Nominal>(\d+)<\/Nominal>/)?.[1];
    const value = block.match(/<Value>(\d+(?:,\d+)?)<\/Value>/)?.[1];
    if (!nominal || Number(nominal) < 1 || !value) continue;
    const parsed = Number(value.replace(",", ".")) / Number(nominal);
    if (Number.isFinite(parsed) && parsed >= 0.0001 && parsed <= 1_000_000) {
      rates[code] = parsed;
    }
  }

  if (!rates.USD)
    throw new Error("Не удалось прочитать курс USD из ответа ЦБ.");

  return decodeRate(
    {
      rubPerUsd: rates.USD,
      rates,
      date: `${date[3]}-${date[2]}-${date[1]}`,
      checkedAt: now,
    },
    now,
  );
}

export const parseCbrRates = parseCbrRate;

export function needsRateRefresh(
  rate: ExchangeRates | null,
  now = Date.now(),
) {
  return !rate || now < rate.checkedAt || now - rate.checkedAt >= RATE_INTERVAL;
}

export function rateForCurrency(
  rates: ExchangeRates | null,
  currency: Exclude<CurrencyCode, "RUB">,
): number | null {
  if (!rates) return null;
  const val =
    rates.rates[currency] ??
    (currency === "USD" ? rates.rubPerUsd : undefined);
  return typeof val === "number" && Number.isFinite(val) && val > 0
    ? val
    : null;
}

export function usdMoney(kopecks: number, rubPerUsd: number) {
  if (!Number.isFinite(rubPerUsd) || rubPerUsd <= 0)
    throw new Error("Некорректный курс доллара.");
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kopecks / 100 / rubPerUsd);
}

export function formatCurrency(
  kopecks: number,
  currency: CurrencyCode,
  rates: ExchangeRates | null,
): string {
  if (currency === "RUB") return money(kopecks);
  const rubPerUnit = rateForCurrency(rates, currency);
  if (!rubPerUnit) return `${currency} —`;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(kopecks / 100 / rubPerUnit);
}

export function dualMoney(
  kopecks: number,
  rates: ExchangeRates | null,
  secondary: SecondaryCurrency = "USD",
) {
  if (secondary === "NONE") return money(kopecks);
  const rubPerUnit = rateForCurrency(rates, secondary);
  return `${money(kopecks)} (${rubPerUnit ? `≈ ${formatCurrency(kopecks, secondary, rates)}` : `${secondary} — курс недоступен`})`;
}
