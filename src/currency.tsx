import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  formatCurrency,
  needsRateRefresh,
  parseCbrRate,
  RATE_INTERVAL,
  rateForCurrency,
  type ExchangeRates,
  type SecondaryCurrency,
} from "./exchange";
import { readRecord, writeRecord } from "./storage";

interface CurrencyContextValue {
  rate: ExchangeRates | null;
  error: string;
  loading: boolean;
  secondaryCurrency: SecondaryCurrency;
  setSecondaryCurrency: (currency: SecondaryCurrency) => void;
  refreshNow: () => Promise<void>;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  rate: null,
  error: "",
  loading: true,
  secondaryCurrency: "USD",
  setSecondaryCurrency: () => {},
  refreshNow: async () => {},
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [secondaryCurrency, setSecondaryCurrency] =
    useState<SecondaryCurrency>("USD");
  const [state, setState] = useState({
    rate: null as ExchangeRates | null,
    error: "",
    loading: true,
  });
  const refreshFnRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true;
    let busy = false;
    let rate: ExchangeRates | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    async function refresh(force = false) {
      if (!active || busy) return;
      if (timer) clearTimeout(timer);
      busy = true;
      try {
        if (force || needsRateRefresh(rate)) {
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
          await writeRecord("rates", next);
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
            () => void refresh(false),
            rate && !needsRateRefresh(rate)
              ? Math.max(1000, rate.checkedAt + RATE_INTERVAL - Date.now())
              : RATE_INTERVAL,
          );
      }
    }

    refreshFnRef.current = refresh;

    async function initialize() {
      try {
        const saved =
          (await readRecord("rates")) ?? (await readRecord("usd-rate"));
        if (saved !== undefined) rate = decodeRate(saved);
      } catch {
        /* Invalid rate cache is replaced only after a successful response. */
      }
      if (active) {
        setState({ rate, error: "", loading: !rate });
        await refresh(false);
      }
    }

    const resume = () => {
      if (document.visibilityState === "visible") void refresh(false);
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

  const refreshNow = useCallback(async () => {
    await refreshFnRef.current(true);
  }, []);

  return (
    <CurrencyContext.Provider
      value={{
        ...state,
        secondaryCurrency,
        setSecondaryCurrency,
        refreshNow,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

export function useMoney() {
  const { rate, secondaryCurrency } = useCurrency();
  return (amount: number) => dualMoney(amount, rate, secondaryCurrency);
}

export function DollarAmount({ amount }: { amount: number }) {
  const { rate, secondaryCurrency } = useCurrency();
  if (secondaryCurrency === "NONE") return null;
  const rubPerUnit = rateForCurrency(rate, secondaryCurrency);
  return (
    <small className="money-usd">
      {rubPerUnit
        ? `≈ ${formatCurrency(amount, secondaryCurrency, rate)}`
        : `${secondaryCurrency} —`}
    </small>
  );
}

export const SecondaryAmount = DollarAmount;

export function Money({ amount }: { amount: number }) {
  return (
    <span className="money-pair">
      <span className="money-rub">{money(amount)}</span>
      <DollarAmount amount={amount} />
    </span>
  );
}

export function ExchangeRateBar() {
  const { rate, error, loading, secondaryCurrency, refreshNow } = useCurrency();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (secondaryCurrency === "NONE") return null;

  const stale = rate && now - rate.checkedAt >= RATE_INTERVAL;
  const unitRate = rateForCurrency(rate, secondaryCurrency);

  return (
    <div
      className={`exchange-rate glass-surface ${error || stale ? "rate-stale" : ""}`}
      role="status"
    >
      <button
        type="button"
        className="icon-button rate-refresh-btn"
        aria-label="Обновить курс валют"
        title="Обновить курс ЦБ"
        disabled={loading}
        onClick={() => void refreshNow()}
      >
        <RefreshCw size={15} className={loading ? "rate-loading" : ""} />
      </button>
      <div>
        <strong>
          {unitRate
            ? `1 ${secondaryCurrency} = ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(unitRate)} ₽`
            : loading
              ? `Загружаем курс ${secondaryCurrency}…`
              : `Курс ${secondaryCurrency} недоступен`}
        </strong>
        <span>
          {rate
            ? `ЦБ РФ на ${new Date(`${rate.date}T12:00:00`).toLocaleDateString("ru-RU")} · проверен ${new Date(rate.checkedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${stale && !error ? " · требуется обновление" : ""}`
            : "Источник: Банк России"}
          {error && <> · {error}</>}
        </span>
      </div>
      <span className="rate-frequency">Нажмите для обновления</span>
    </div>
  );
}
