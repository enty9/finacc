import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { RefreshCw } from "lucide-react";
import { money } from "./domain";
import {
  decodeRate,
  dualMoney,
  needsRateRefresh,
  parseCbrRate,
  RATE_INTERVAL,
  usdMoney,
  type ExchangeRate,
} from "./exchange";
import { readRecord, writeRecord } from "./storage";

const CurrencyContext = createContext<{
  rate: ExchangeRate | null;
  error: string;
  loading: boolean;
}>({ rate: null, error: "", loading: true });
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    rate: null as ExchangeRate | null,
    error: "",
    loading: true,
  });
  useEffect(() => {
    let active = true,
      busy = false;
    let rate: ExchangeRate | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      if (!active || busy) return;
      if (timer) clearTimeout(timer);
      busy = true;
      try {
        if (needsRateRefresh(rate)) {
          setState({ rate, error: "", loading: true });
          const response = await (isTauri()
            ? nativeFetch("https://www.cbr.ru/scripts/XML_daily.asp", {
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(12000),
                ]),
                headers: { "Cache-Control": "no-cache" },
              })
            : fetch("/api/cbr-usd", {
                cache: "no-store",
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(12000),
                ]),
              }));
          if (!response.ok)
            throw new Error(`Сервис курсов недоступен (${response.status}).`);
          const next = parseCbrRate(
            new TextDecoder("windows-1251").decode(
              await response.arrayBuffer(),
            ),
          );
          await writeRecord("usd-rate", next);
          rate = next;
        }
        if (active) setState({ rate, error: "", loading: false });
      } catch {
        if (active)
          setState({
            rate,
            error: rate
              ? "Не удалось обновить. Показан сохраненный курс."
              : "Курс недоступен. Рублевый учет работает без интернета.",
            loading: false,
          });
      } finally {
        busy = false;
        if (active)
          timer = setTimeout(
            refresh,
            rate && !needsRateRefresh(rate)
              ? Math.max(1000, rate.checkedAt + RATE_INTERVAL - Date.now())
              : RATE_INTERVAL,
          );
      }
    }
    async function initialize() {
      try {
        const saved = await readRecord("usd-rate");
        if (saved !== undefined) rate = decodeRate(saved);
      } catch {
        /* Invalid rate cache is replaced only after a successful response. */
      }
      if (active) {
        setState({ rate, error: "", loading: !rate });
        await refresh();
      }
    }
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void initialize();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return (
    <CurrencyContext.Provider value={state}>
      {children}
    </CurrencyContext.Provider>
  );
}
export function useCurrency() {
  return useContext(CurrencyContext);
}
export function useMoney() {
  const { rate } = useCurrency();
  return (amount: number) => dualMoney(amount, rate);
}
export function DollarAmount({ amount }: { amount: number }) {
  const { rate } = useCurrency();
  return (
    <small className="money-usd">
      {rate ? `≈ ${usdMoney(amount, rate.rubPerUsd)}` : "USD —"}
    </small>
  );
}
export function Money({ amount }: { amount: number }) {
  return (
    <span className="money-pair">
      <span className="money-rub">{money(amount)}</span>
      <DollarAmount amount={amount} />
    </span>
  );
}
export function ExchangeRateBar() {
  const { rate, error, loading } = useCurrency();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const stale = rate && now - rate.checkedAt >= RATE_INTERVAL;
  return (
    <div
      className={`exchange-rate glass ${error || stale ? "rate-stale" : ""}`}
      role="status"
    >
      <RefreshCw size={14} className={loading ? "rate-loading" : ""} />
      <div>
        <strong>
          {rate
            ? `1 $ = ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(rate.rubPerUsd)} ₽`
            : loading
              ? "Загружаем курс доллара…"
              : "Курс USD недоступен"}
        </strong>
        <span>
          {rate
            ? `ЦБ РФ на ${new Date(`${rate.date}T12:00:00`).toLocaleDateString("ru-RU")} · проверен ${new Date(rate.checkedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${stale && !error ? " · требуется обновление" : ""}`
            : "Источник: Банк России"}
          {error && <> · {error}</>}
        </span>
      </div>
      <span className="rate-frequency">Проверка каждый час</span>
    </div>
  );
}
