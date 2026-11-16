import { REPOSITORY_URL } from "@/config/app";
import {
  addDays,
  NBP_GOLD_SINCE,
  parseNbpGold,
  parseNbpRates,
  splitDateRange,
  type DailyRate,
} from "@/domain/market-data/nbp";
import {
  closesInCurrency,
  currencyScale,
  parseYahooChart,
  type DailyClose,
  type DividendEvent,
  type SplitEvent,
} from "@/domain/market-data/yahoo";
import {
  parseGusInflation,
  parseNbpReferenceRates,
  type InflationReading,
  type ReferenceRateChange,
} from "@/domain/market-data/indexes";
import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";

export type QuoteFailure = "notFound" | "currencyMismatch" | "unavailable";

export type QuoteResult =
  | { ok: true; closes: DailyClose[]; dividends: DividendEvent[]; splits: SplitEvent[] }
  | { ok: false; reason: QuoteFailure };

export type RatesResult = { ok: true; rates: DailyRate[] } | { ok: false; reason: "unavailable" };

export type InflationResult =
  { ok: true; readings: InflationReading[] } | { ok: false; reason: "unavailable" };
export type ReferenceRatesResult =
  { ok: true; changes: ReferenceRateChange[] } | { ok: false; reason: "unavailable" };

/** Where daily prices, exchange rates and the indexes behind bond rates come from. */
export type MarketDataProviders = {
  /**
   * Daily closes of `symbol` between the two dates (inclusive), in `currency`, with the
   * dividends and splits of that period. Closes and dividends are as traded and as paid:
   * the provider's split adjustment is undone, which is only right when `to` is today.
   */
  quotes(symbol: string, currency: string, from: IsoDate, to: IsoDate): Promise<QuoteResult>;
  /** PLN per one unit of `currency` for each day NBP published a rate. */
  rates(currency: string, from: IsoDate, to: IsoDate): Promise<RatesResult>;
  /** NBP's price of one gram of gold in PLN for each day it was published. */
  gold(from: IsoDate, to: IsoDate): Promise<QuoteResult>;
  /** GUS's yearly change of consumer prices for each published month of `year`. */
  inflation(year: number): Promise<InflationResult>;
  /** Every change of the NBP reference rate, oldest first. */
  referenceRates(): Promise<ReferenceRatesResult>;
  /**
   * Pause between two requests, in milliseconds, to stay a polite client of the services
   * behind the provider. Zero when nothing is requested over the network.
   */
  pauseMs: number;
};

/** Yahoo Finance and NBP are free services; requests are spaced out. */
const LIVE_PAUSE_MS = 300;

type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 15_000;

// Identifies the software (not the user or the instance) to the data providers.
const USER_AGENT = `Mozilla/5.0 (compatible; ourFund; +${REPOSITORY_URL})`;

async function getJson(fetchFn: Fetch, url: string): Promise<{ status: number; json: unknown }> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Error pages are not JSON; the status code is all we need from them.
  }

  return { status: response.status, json };
}

/**
 * "Consumer prices, same month of the previous year = 100" in GUS's publication store. The
 * series was restarted with the 2026 classification: one indicator from 2026, one before.
 */
const GUS_INFLATION_INDICATORS = [2728, 1832];
const NBP_RATES_ARCHIVE_URL = "https://static.nbp.pl/dane/stopy/stopy_procentowe_archiwum.xml";

const toUnixSeconds = (date: IsoDate) => Date.parse(`${date}T00:00:00.000Z`) / 1000;

/** Prices from Yahoo Finance's chart endpoint, exchange rates from the NBP API. */
export function createLiveProviders(fetchFn: Fetch = fetch): MarketDataProviders {
  return {
    pauseMs: LIVE_PAUSE_MS,
    async quotes(symbol, currency, from, to) {
      // One day of margin on each side: bars are stamped in the exchange's time zone.
      const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?period1=${toUnixSeconds(addDays(from, -1))}&period2=${toUnixSeconds(addDays(to, 2))}` +
        `&interval=1d&events=div%2Csplits`;

      try {
        const { status, json } = await getJson(fetchFn, url);
        const chart = parseYahooChart(json);

        if (!chart.ok) {
          return { ok: false, reason: chart.reason === "notFound" ? "notFound" : "unavailable" };
        }
        if (status !== 200) {
          return { ok: false, reason: "unavailable" };
        }

        const closes = closesInCurrency(chart.closes, chart.currency, currency);
        const scale = currencyScale(chart.currency, currency);
        if (!closes || !scale) {
          return { ok: false, reason: "currencyMismatch" };
        }

        const inRange = (item: { date: IsoDate }) => item.date >= from && item.date <= to;
        return {
          ok: true,
          closes: closes.filter(inRange),
          dividends: chart.dividends
            .filter(inRange)
            .map((dividend) => ({ ...dividend, amount: dividend.amount.times(scale) })),
          splits: chart.splits.filter(inRange),
        };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async rates(currency, from, to) {
      const rates: DailyRate[] = [];

      try {
        for (const range of splitDateRange(from, to)) {
          const url =
            `https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}` +
            `/${range.from}/${range.to}/?format=json`;
          const { status, json } = await getJson(fetchFn, url);

          // NBP answers 404 when no rate was published in the range (e.g. a weekend).
          if (status === 404) {
            continue;
          }

          const parsed = status === 200 ? parseNbpRates(json) : null;
          if (!parsed) {
            return { ok: false, reason: "unavailable" };
          }
          rates.push(...parsed);
        }
      } catch {
        return { ok: false, reason: "unavailable" };
      }

      return { ok: true, rates };
    },

    async gold(from, to) {
      const closes: DailyClose[] = [];
      try {
        const start = from < NBP_GOLD_SINCE ? NBP_GOLD_SINCE : from;
        for (const range of start <= to ? splitDateRange(start, to) : []) {
          const url = `https://api.nbp.pl/api/cenyzlota/${range.from}/${range.to}/?format=json`;
          const { status, json } = await getJson(fetchFn, url);
          // NBP answers 404 when no price was published in the range (e.g. a weekend).
          if (status === 404) {
            continue;
          }
          const parsed = status === 200 ? parseNbpGold(json) : null;
          if (!parsed) {
            return { ok: false, reason: "unavailable" };
          }
          closes.push(...parsed.map(({ date, price }) => ({ date, close: price })));
        }
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      return { ok: true, closes, dividends: [], splits: [] };
    },

    async inflation(year) {
      try {
        for (const indicator of GUS_INFLATION_INDICATORS) {
          const url =
            `https://api-sdp.stat.gov.pl/api/indicators/indicator-data-indicator` +
            `?id-wskaznik=${indicator}&id-rok=${year}&lang=pl`;
          const { status, json } = await getJson(fetchFn, url);
          // An indicator answers 404 for a year it does not cover.
          if (status === 404) {
            continue;
          }
          const readings = status === 200 ? parseGusInflation(json) : null;
          return readings ? { ok: true, readings } : { ok: false, reason: "unavailable" };
        }
        // Covered by neither: a year without published months.
        return { ok: true, readings: [] };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },

    async referenceRates() {
      try {
        const response = await fetchFn(NBP_RATES_ARCHIVE_URL, {
          // No Accept header: the server answers 406 to "application/xml".
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const changes =
          response.status === 200 ? parseNbpReferenceRates(await response.text()) : null;
        return changes && changes.length > 0
          ? { ok: true, changes }
          : { ok: false, reason: "unavailable" };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
  };
}

const FIXTURE_PRICES: Record<string, string> = { "CDR.WA": "250", AAPL: "200" };
/** One made-up company with a split and a dividend, for the tests of those suggestions. */
const FIXTURE_EVENTS: Record<
  string,
  { dividends: { date: IsoDate; amount: string }[]; splits: { date: IsoDate; ratio: string }[] }
> = {
  "EVENTS.WA": {
    splits: [{ date: "2026-03-02", ratio: "2" }],
    dividends: [{ date: "2026-06-15", amount: "1.5" }],
  },
};

const FIXTURE_GOLD_PRICE = "500";
const FIXTURE_RATES: Record<string, string> = { USD: "4", EUR: "4.3" };

function weekdays(from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(day);
    }
  }
  return days;
}

/** Made-up, constant data for end-to-end tests: nothing leaves the machine. */
export function createFixtureProviders(): MarketDataProviders {
  return {
    pauseMs: 0,
    async quotes(symbol, _currency, from, to) {
      if (symbol.startsWith("MISSING")) {
        return { ok: false, reason: "notFound" };
      }

      const close = new Decimal(FIXTURE_PRICES[symbol] ?? "100");
      const events = FIXTURE_EVENTS[symbol] ?? { dividends: [], splits: [] };
      const inRange = (item: { date: IsoDate }) => item.date >= from && item.date <= to;
      return {
        ok: true,
        closes: weekdays(from, to).map((date) => ({ date, close })),
        dividends: events.dividends
          .filter(inRange)
          .map(({ date, amount }) => ({ date, amount: new Decimal(amount) })),
        splits: events.splits
          .filter(inRange)
          .map(({ date, ratio }) => ({ date, ratio: new Decimal(ratio) })),
      };
    },

    async rates(currency, from, to) {
      const rate = new Decimal(FIXTURE_RATES[currency] ?? "1");
      return { ok: true, rates: weekdays(from, to).map((date) => ({ date, rate })) };
    },

    async gold(from, to) {
      const close = new Decimal(FIXTURE_GOLD_PRICE);
      return {
        ok: true,
        closes: weekdays(from, to).map((date) => ({ date, close })),
        dividends: [],
        splits: [],
      };
    },

    // No index data: bonds in end-to-end tests keep exactly the rates the tests enter.
    async inflation() {
      return { ok: true, readings: [] };
    },

    async referenceRates() {
      return { ok: true, changes: [] };
    },
  };
}

/** The providers for the configured mode; null when market data is switched off. */
export function getMarketDataProviders(
  mode: "live" | "fixture" | "off",
): MarketDataProviders | null {
  switch (mode) {
    case "live":
      return createLiveProviders();
    case "fixture":
      return createFixtureProviders();
    case "off":
      return null;
  }
}
