import { validDate, money } from "./domain.ts";

export const RATE_INTERVAL = 60 * 60 * 1000;
export interface ExchangeRate {
  rubPerUsd: number;
  date: string;
  checkedAt: number;
}
export function decodeRate(value: unknown, now = Date.now()): ExchangeRate {
  if (!value || typeof value !== "object")
    throw new Error("Курс доллара недоступен.");
  const r = value as ExchangeRate;
  if (
    !Number.isFinite(r.rubPerUsd) ||
    r.rubPerUsd < 0.01 ||
    r.rubPerUsd > 1_000_000 ||
    !validDate(r.date) ||
    new Date(`${r.date}T00:00:00Z`).getTime() > now + 7 * 86400000 ||
    !Number.isSafeInteger(r.checkedAt) ||
    r.checkedAt <= 0 ||
    r.checkedAt > now + 60000
  )
    throw new Error("Источник вернул некорректный курс доллара.");
  return { rubPerUsd: r.rubPerUsd, date: r.date, checkedAt: r.checkedAt };
}
export function parseCbrRate(xml: string, now = Date.now()): ExchangeRate {
  if (xml.length > 512000)
    throw new Error("Ответ сервиса курсов слишком большой.");
  const date = xml.match(/<ValCurs\b[^>]*\bDate="(\d{2})\.(\d{2})\.(\d{4})"/);
  const usd = xml.match(
    /<Valute\b[^>]*>(?:(?!<\/Valute>)[\s\S])*?<CharCode>USD<\/CharCode>(?:(?!<\/Valute>)[\s\S])*?<\/Valute>/,
  )?.[0];
  const nominal = usd?.match(/<Nominal>(\d+)<\/Nominal>/)?.[1];
  const value = usd?.match(/<Value>(\d+(?:,\d+)?)<\/Value>/)?.[1];
  if (!date || !nominal || Number(nominal) < 1 || !value)
    throw new Error("Не удалось прочитать курс USD из ответа ЦБ.");
  return decodeRate(
    {
      rubPerUsd: Number(value.replace(",", ".")) / Number(nominal),
      date: `${date[3]}-${date[2]}-${date[1]}`,
      checkedAt: now,
    },
    now,
  );
}
export function needsRateRefresh(rate: ExchangeRate | null, now = Date.now()) {
  return !rate || now < rate.checkedAt || now - rate.checkedAt >= RATE_INTERVAL;
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
export function dualMoney(kopecks: number, rate: ExchangeRate | null) {
  return `${money(kopecks)} (${rate ? `≈ ${usdMoney(kopecks, rate.rubPerUsd)}` : "USD — курс недоступен"})`;
}
