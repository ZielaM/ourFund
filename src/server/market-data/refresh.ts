import { z } from "zod";
import { addDays } from "@/domain/market-data/nbp";
import { effectiveQuoteSymbol } from "@/domain/market-data/quote-symbol";
import { isoDateToUtc, todayInWarsaw, utcToIsoDate, type IsoDate } from "@/domain/portfolio/dates";
import type { PrismaClient } from "@/generated/prisma/client";
import type { MarketDataProviders, QuoteFailure } from "./providers";

export const LAST_REFRESH_KEY = "marketData.lastRefresh";

/** Prices before the first transaction that are still fetched, for charts and rate lookups. */
const LEAD_DAYS = 7;
/** Recent days fetched again on every run: the latest close keeps moving during the day. */
const OVERLAP_DAYS = 5;

const reportSchema = z.object({
  finishedAt: z.string(),
  instruments: z.object({
    updated: z.number(),
    failed: z.array(
      z.object({
        symbol: z.string(),
        quoteSymbol: z.string().nullable(),
        reason: z.enum(["notFound", "currencyMismatch", "unavailable", "noSymbol"]),
      }),
    ),
  }),
  currencies: z.object({
    updated: z.number(),
    failed: z.array(z.string()),
  }),
});

export type RefreshReport = z.infer<typeof reportSchema>;

type RefreshOptions = {
  now?: Date;
  /** Pause between requests to the same provider, to stay a polite client. */
  pauseMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decides which days to ask a provider for: everything from `wantFrom` when history is
 * missing, otherwise only the last few days.
 */
export function fetchRange(
  wantFrom: IsoDate,
  have: { min: IsoDate; max: IsoDate } | null,
  today: IsoDate,
): { from: IsoDate; to: IsoDate } {
  if (!have || have.min > wantFrom) {
    return { from: wantFrom, to: today };
  }

  const recent = addDays(have.max, -OVERLAP_DAYS);
  return { from: recent > wantFrom ? recent : wantFrom, to: today };
}

/**
 * Fetches prices for every instrument that appears in a transaction, and NBP rates for
 * every foreign currency in use. Failures are collected in the report, never thrown:
 * one unavailable symbol must not stop the others.
 */
export async function refreshMarketData(
  db: PrismaClient,
  providers: MarketDataProviders,
  options: RefreshOptions = {},
): Promise<RefreshReport> {
  const today = todayInWarsaw(options.now ?? new Date());
  const pauseMs = options.pauseMs ?? 300;

  const [instruments, firstTransactions, priceRanges] = await Promise.all([
    db.instrument.findMany({
      where: { priceSource: "YAHOO", transactions: { some: {} } },
      orderBy: { symbol: "asc" },
    }),
    db.transaction.groupBy({
      by: ["instrumentId"],
      where: { instrumentId: { not: null } },
      _min: { date: true },
    }),
    db.price.groupBy({
      by: ["instrumentId"],
      where: { source: "YAHOO" },
      _min: { date: true },
      _max: { date: true },
    }),
  ]);

  const firstTransaction = new Map(
    firstTransactions.map((row) => [row.instrumentId, row._min.date]),
  );
  const priceRange = new Map(priceRanges.map((row) => [row.instrumentId, row]));
  const report: RefreshReport = {
    finishedAt: "",
    instruments: { updated: 0, failed: [] },
    currencies: { updated: 0, failed: [] },
  };

  for (const [index, instrument] of instruments.entries()) {
    const quoteSymbol = effectiveQuoteSymbol(instrument);
    const fail = (reason: QuoteFailure | "noSymbol") =>
      report.instruments.failed.push({ symbol: instrument.symbol, quoteSymbol, reason });

    if (!quoteSymbol) {
      fail("noSymbol");
      continue;
    }

    const stored = priceRange.get(instrument.id);
    const range = fetchRange(
      addDays(utcToIsoDate(firstTransaction.get(instrument.id)!), -LEAD_DAYS),
      stored?._min.date && stored._max.date
        ? { min: utcToIsoDate(stored._min.date), max: utcToIsoDate(stored._max.date) }
        : null,
      today,
    );

    if (index > 0) {
      await sleep(pauseMs);
    }
    const result = await providers.quotes(quoteSymbol, instrument.currency, range.from, range.to);

    if (!result.ok) {
      fail(result.reason);
      continue;
    }

    // Prices entered by hand always win over fetched ones.
    const manualDates = new Set(
      (
        await db.price.findMany({
          where: {
            instrumentId: instrument.id,
            source: "MANUAL",
            date: { gte: isoDateToUtc(range.from), lte: isoDateToUtc(range.to) },
          },
          select: { date: true },
        })
      ).map((price) => utcToIsoDate(price.date)),
    );
    const rows = result.closes
      .filter((close) => !manualDates.has(close.date))
      .map((close) => ({
        instrumentId: instrument.id,
        date: isoDateToUtc(close.date),
        close: close.close.toFixed(),
        source: "YAHOO" as const,
      }));

    await db.$transaction([
      db.price.deleteMany({
        where: {
          instrumentId: instrument.id,
          source: "YAHOO",
          date: { in: rows.map((row) => row.date) },
        },
      }),
      db.price.createMany({ data: rows }),
    ]);
    report.instruments.updated += 1;
  }

  await refreshRates(db, providers, today, pauseMs, report);

  report.finishedAt = new Date().toISOString();
  await db.appSetting.upsert({
    where: { key: LAST_REFRESH_KEY },
    create: { key: LAST_REFRESH_KEY, value: report },
    update: { value: report },
  });

  return report;
}

async function refreshRates(
  db: PrismaClient,
  providers: MarketDataProviders,
  today: IsoDate,
  pauseMs: number,
  report: RefreshReport,
): Promise<void> {
  const [first, transactionCurrencies, instrumentCurrencies, rateRanges] = await Promise.all([
    db.transaction.aggregate({ _min: { date: true } }),
    db.transaction.findMany({ distinct: ["currency"], select: { currency: true } }),
    db.instrument.findMany({
      where: { transactions: { some: {} } },
      distinct: ["currency"],
      select: { currency: true },
    }),
    db.fxRate.groupBy({ by: ["currency"], _min: { date: true }, _max: { date: true } }),
  ]);

  if (!first._min.date) {
    return;
  }

  const wantFrom = addDays(utcToIsoDate(first._min.date), -LEAD_DAYS);
  const rateRange = new Map(rateRanges.map((row) => [row.currency, row]));
  const currencies = [
    ...new Set([...transactionCurrencies, ...instrumentCurrencies].map((row) => row.currency)),
  ]
    .filter((currency) => currency !== "PLN")
    .sort();

  for (const [index, currency] of currencies.entries()) {
    const stored = rateRange.get(currency);
    const range = fetchRange(
      wantFrom,
      stored?._min.date && stored._max.date
        ? { min: utcToIsoDate(stored._min.date), max: utcToIsoDate(stored._max.date) }
        : null,
      today,
    );

    if (index > 0) {
      await sleep(pauseMs);
    }
    const result = await providers.rates(currency, range.from, range.to);

    if (!result.ok) {
      report.currencies.failed.push(currency);
      continue;
    }

    // Published rates never change, so existing days are simply left alone.
    await db.fxRate.createMany({
      data: result.rates.map((rate) => ({
        currency,
        date: isoDateToUtc(rate.date),
        rate: rate.rate.toFixed(),
      })),
      skipDuplicates: true,
    });
    report.currencies.updated += 1;
  }
}

/** The report of the most recent refresh, or null when none has run yet. */
export async function getLastRefresh(db: PrismaClient): Promise<RefreshReport | null> {
  const setting = await db.appSetting.findUnique({ where: { key: LAST_REFRESH_KEY } });
  const parsed = reportSchema.safeParse(setting?.value);

  return parsed.success ? parsed.data : null;
}

let running: Promise<RefreshReport> | null = null;

/** Like `refreshMarketData`, but a call made while a refresh is running joins that run. */
export function refreshMarketDataOnce(
  db: PrismaClient,
  providers: MarketDataProviders,
  options?: RefreshOptions,
): Promise<RefreshReport> {
  running ??= refreshMarketData(db, providers, options).finally(() => {
    running = null;
  });

  return running;
}
