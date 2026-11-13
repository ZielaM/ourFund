import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser } from "@/test/fixtures";
import {
  deleteManualPrice,
  getInstrument,
  getLatestPrices,
  listPrices,
  setManualPrice,
  updateQuoteSettings,
} from "./prices";
import type { MarketDataProviders, QuoteResult, RatesResult } from "./providers";
import { getLastRefresh, refreshMarketData, refreshMarketDataOnce } from "./refresh";

const db = getDb();
const now = new Date("2026-11-13T12:00:00Z");
const options = { now, pauseMs: 0 };
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let ania: SessionUser;
let accountId: string;

const closes = (...pairs: [string, string][]): QuoteResult => ({
  ok: true,
  closes: pairs.map(([date, close]) => ({ date, close: new Decimal(close) })),
});
const rates = (...pairs: [string, string][]): RatesResult => ({
  ok: true,
  rates: pairs.map(([date, rate]) => ({ date, rate: new Decimal(rate) })),
});

function fakeProviders(overrides: Partial<MarketDataProviders> = {}) {
  return {
    quotes: vi.fn(overrides.quotes ?? (async () => closes())),
    rates: vi.fn(overrides.rates ?? (async () => rates())),
  };
}

async function instrument(
  symbol: string,
  market = "GPW",
  currency = "PLN",
  extra: { priceSource?: "YAHOO" | "MANUAL"; quoteSymbol?: string } = {},
): Promise<string> {
  const created = await db.instrument.create({
    data: { symbol, market, name: symbol, type: "STOCK", currency, ...extra },
  });
  return created.id;
}

async function bought(instrumentId: string, date: string, currency = "PLN") {
  await db.transaction.create({
    data: {
      accountId,
      type: "BUY",
      date: new Date(date),
      instrumentId,
      quantity: "1",
      price: "100",
      currency,
    },
  });
}

const storedPrices = async (instrumentId: string) =>
  (await listPrices(db, instrumentId, 100))
    .map((price) => [price.date, price.close.toFixed(), price.source])
    .reverse();

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  const portfolio = await db.portfolio.create({ data: { userId: ania.id, name: "Główny" } });
  const account = await db.account.create({ data: { portfolioId: portfolio.id, name: "XTB" } });
  accountId = account.id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("refreshMarketData: prices", () => {
  it("does nothing when there are no transactions", async () => {
    await instrument("CDR");
    const providers = fakeProviders();

    const report = await refreshMarketData(db, providers, options);

    expect(providers.quotes).not.toHaveBeenCalled();
    expect(providers.rates).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      instruments: { updated: 0, failed: [] },
      currencies: { updated: 0, failed: [] },
    });
  });

  it("fetches history from a week before the first transaction until today", async () => {
    const cdr = await instrument("CDR");
    await bought(cdr, "2026-11-10");
    const providers = fakeProviders({
      quotes: async () => closes(["2026-11-10", "274.5"], ["2026-11-12", "278.2"]),
    });

    const report = await refreshMarketData(db, providers, options);

    expect(providers.quotes).toHaveBeenCalledWith("CDR.WA", "PLN", "2026-11-03", "2026-11-13");
    expect(report.instruments).toEqual({ updated: 1, failed: [] });
    await expect(storedPrices(cdr)).resolves.toEqual([
      ["2026-11-10", "274.5", "YAHOO"],
      ["2026-11-12", "278.2", "YAHOO"],
    ]);
  });

  it("skips instruments nobody holds or ever held", async () => {
    const cdr = await instrument("CDR");
    await instrument("PKN");
    await bought(cdr, "2026-11-10");
    const providers = fakeProviders();

    await refreshMarketData(db, providers, options);

    expect(providers.quotes).toHaveBeenCalledTimes(1);
    expect(providers.quotes.mock.calls[0][0]).toBe("CDR.WA");
  });

  it("on later runs asks only for recent days and updates the moving last price", async () => {
    const cdr = await instrument("CDR");
    await bought(cdr, "2026-11-02");
    await refreshMarketData(
      db,
      fakeProviders({
        quotes: async () => closes(["2026-10-26", "260"], ["2026-11-12", "278.2"]),
      }),
      options,
    );
    const providers = fakeProviders({
      quotes: async () => closes(["2026-11-12", "279"], ["2026-11-13", "281"]),
    });

    await refreshMarketData(db, providers, options);

    expect(providers.quotes).toHaveBeenCalledWith("CDR.WA", "PLN", "2026-11-07", "2026-11-13");
    await expect(storedPrices(cdr)).resolves.toEqual([
      ["2026-10-26", "260", "YAHOO"],
      ["2026-11-12", "279", "YAHOO"],
      ["2026-11-13", "281", "YAHOO"],
    ]);
  });

  it("fetches the whole history again after an older transaction is added", async () => {
    const cdr = await instrument("CDR");
    await bought(cdr, "2026-11-10");
    await refreshMarketData(
      db,
      fakeProviders({ quotes: async () => closes(["2026-11-03", "270"], ["2026-11-12", "278.2"]) }),
      options,
    );
    await bought(cdr, "2026-06-01");
    const providers = fakeProviders();

    await refreshMarketData(db, providers, options);

    expect(providers.quotes).toHaveBeenCalledWith("CDR.WA", "PLN", "2026-05-25", "2026-11-13");
  });

  it("uses the quote symbol entered by the user", async () => {
    const asml = await instrument("ASML", "EURONEXT", "EUR", { quoteSymbol: "ASML.AS" });
    await bought(asml, "2026-11-10", "EUR");
    const providers = fakeProviders();

    await refreshMarketData(db, providers, options);

    expect(providers.quotes).toHaveBeenCalledWith("ASML.AS", "EUR", "2026-11-03", "2026-11-13");
  });

  it("does not fetch instruments whose prices are entered by hand", async () => {
    const bond = await instrument("EDO1135", "OTHER", "PLN", { priceSource: "MANUAL" });
    await bought(bond, "2026-11-10");
    const providers = fakeProviders();

    const report = await refreshMarketData(db, providers, options);

    expect(providers.quotes).not.toHaveBeenCalled();
    expect(report.instruments.failed).toEqual([]);
  });

  it("never overwrites a price entered by hand", async () => {
    const cdr = await instrument("CDR");
    await bought(cdr, "2026-11-10");
    await setManualPrice(db, ania, cdr, { date: "2026-11-12", close: new Decimal("300") }, now);

    await refreshMarketData(
      db,
      fakeProviders({
        quotes: async () => closes(["2026-11-10", "274.5"], ["2026-11-12", "278.2"]),
      }),
      options,
    );

    await expect(storedPrices(cdr)).resolves.toEqual([
      ["2026-11-10", "274.5", "YAHOO"],
      ["2026-11-12", "300", "MANUAL"],
    ]);
  });

  it("reports failures per instrument and still updates the others", async () => {
    const cdr = await instrument("CDR");
    const gone = await instrument("GONE");
    const other = await instrument("ABC", "OTHER");
    const pkn = await instrument("PKN");
    for (const id of [cdr, gone, other, pkn]) await bought(id, "2026-11-10");
    const providers = fakeProviders({
      quotes: async (symbol) => {
        if (symbol === "GONE.WA") return { ok: false, reason: "notFound" };
        if (symbol === "CDR.WA") return { ok: false, reason: "unavailable" };
        return closes(["2026-11-12", "100"]);
      },
    });

    const report = await refreshMarketData(db, providers, options);

    expect(report.instruments).toEqual({
      updated: 1,
      failed: [
        { symbol: "ABC", quoteSymbol: null, reason: "noSymbol" },
        { symbol: "CDR", quoteSymbol: "CDR.WA", reason: "unavailable" },
        { symbol: "GONE", quoteSymbol: "GONE.WA", reason: "notFound" },
      ],
    });
    await expect(storedPrices(pkn)).resolves.toHaveLength(1);
  });
});

describe("refreshMarketData: exchange rates", () => {
  it("fetches NBP rates for every foreign currency in use, never for PLN", async () => {
    const aapl = await instrument("AAPL", "NASDAQ", "USD");
    const cdr = await instrument("CDR");
    await bought(aapl, "2026-11-10", "USD");
    await bought(cdr, "2026-11-03");
    const providers = fakeProviders({
      rates: async () => rates(["2026-11-10", "3.9099"], ["2026-11-12", "3.92"]),
    });

    const report = await refreshMarketData(db, providers, options);

    expect(providers.rates.mock.calls).toEqual([["USD", "2026-10-27", "2026-11-13"]]);
    expect(report.currencies).toEqual({ updated: 1, failed: [] });
    const stored = await db.fxRate.findMany({ orderBy: { date: "asc" } });
    expect(stored.map((rate) => [rate.currency, rate.rate.toString()])).toEqual([
      ["USD", "3.9099"],
      ["USD", "3.92"],
    ]);
  });

  it("includes the settlement currency of trades and the instrument's own currency", async () => {
    const vwce = await instrument("VWCE", "XETRA", "EUR");
    // Quoted in EUR, paid for from a USD balance.
    await bought(vwce, "2026-11-10", "USD");
    const providers = fakeProviders();

    await refreshMarketData(db, providers, options);

    expect(providers.rates.mock.calls.map((call) => call[0])).toEqual(["EUR", "USD"]);
  });

  it("asks only for recent days once rates are stored and keeps the existing ones", async () => {
    const aapl = await instrument("AAPL", "NASDAQ", "USD");
    await bought(aapl, "2026-11-02", "USD");
    await refreshMarketData(
      db,
      fakeProviders({ rates: async () => rates(["2026-10-26", "3.95"], ["2026-11-12", "3.92"]) }),
      options,
    );
    const providers = fakeProviders({
      rates: async () => rates(["2026-11-12", "9.99"], ["2026-11-13", "3.93"]),
    });

    await refreshMarketData(db, providers, options);

    expect(providers.rates).toHaveBeenCalledWith("USD", "2026-11-07", "2026-11-13");
    const stored = await db.fxRate.findMany({ orderBy: { date: "asc" } });
    expect(stored.map((rate) => rate.rate.toString())).toEqual(["3.95", "3.92", "3.93"]);
  });

  it("reports a currency whose rates could not be fetched", async () => {
    const aapl = await instrument("AAPL", "NASDAQ", "USD");
    await bought(aapl, "2026-11-10", "USD");

    const report = await refreshMarketData(
      db,
      fakeProviders({ rates: async () => ({ ok: false, reason: "unavailable" }) }),
      options,
    );

    expect(report.currencies).toEqual({ updated: 0, failed: ["USD"] });
  });
});

describe("refresh report", () => {
  it("is null before the first refresh", async () => {
    await expect(getLastRefresh(db)).resolves.toBeNull();
  });

  it("is stored and returned after a refresh", async () => {
    const report = await refreshMarketData(db, fakeProviders(), options);

    expect(Date.parse(report.finishedAt)).not.toBeNaN();
    await expect(getLastRefresh(db)).resolves.toEqual(report);
  });

  it("ignores a stored value it does not understand", async () => {
    await db.appSetting.create({
      data: { key: "marketData.lastRefresh", value: { finishedAt: 5 } },
    });

    await expect(getLastRefresh(db)).resolves.toBeNull();
  });

  it("joins a refresh that is already running instead of starting a second one", async () => {
    const cdr = await instrument("CDR");
    await bought(cdr, "2026-11-10");
    const providers = fakeProviders();

    const [first, second] = await Promise.all([
      refreshMarketDataOnce(db, providers, options),
      refreshMarketDataOnce(db, providers, options),
    ]);

    expect(second).toBe(first);
    expect(providers.quotes).toHaveBeenCalledTimes(1);

    await refreshMarketDataOnce(db, providers, options);
    expect(providers.quotes).toHaveBeenCalledTimes(2);
  });
});

describe("prices", () => {
  it("returns the latest price of each instrument", async () => {
    const cdr = await instrument("CDR");
    const pkn = await instrument("PKN");
    const none = await instrument("ALE");
    await setManualPrice(db, ania, cdr, { date: "2026-11-10", close: new Decimal("274.5") }, now);
    await setManualPrice(db, ania, cdr, { date: "2026-11-12", close: new Decimal("278.2") }, now);
    await setManualPrice(db, ania, pkn, { date: "2026-11-11", close: new Decimal("70") }, now);

    const latest = await getLatestPrices(db, [cdr, pkn, none]);

    expect(latest.get(cdr)).toMatchObject({ date: "2026-11-12", source: "MANUAL" });
    expect(latest.get(cdr)?.close.toFixed()).toBe("278.2");
    expect(latest.get(pkn)?.date).toBe("2026-11-11");
    expect(latest.has(none)).toBe(false);
  });

  it("lists recent prices newest first, up to a limit", async () => {
    const cdr = await instrument("CDR");
    for (const day of ["2026-11-09", "2026-11-10", "2026-11-12"]) {
      await setManualPrice(db, ania, cdr, { date: day, close: new Decimal("1") }, now);
    }

    const prices = await listPrices(db, cdr, 2);

    expect(prices.map((price) => price.date)).toEqual(["2026-11-12", "2026-11-10"]);
    await expect(listPrices(db, "not-an-id")).resolves.toEqual([]);
  });

  it("replaces a price already stored for the day", async () => {
    const cdr = await instrument("CDR");
    await db.price.create({
      data: { instrumentId: cdr, date: new Date("2026-11-12"), close: "278.2", source: "YAHOO" },
    });

    await setManualPrice(db, ania, cdr, { date: "2026-11-12", close: new Decimal("280") }, now);

    await expect(storedPrices(cdr)).resolves.toEqual([["2026-11-12", "280", "MANUAL"]]);
  });

  it("refuses a price dated in the future or for an unknown instrument", async () => {
    const cdr = await instrument("CDR");
    const input = { date: "2026-11-14", close: new Decimal("1") };

    await expect(setManualPrice(db, ania, cdr, input, now)).resolves.toEqual({
      ok: false,
      reason: "futureDate",
    });
    await expect(
      setManualPrice(db, ania, UNKNOWN_ID, { ...input, date: "2026-11-12" }, now),
    ).resolves.toEqual({ ok: false, reason: "notFound" });
  });

  it("deletes a price entered by hand but not a fetched one", async () => {
    const cdr = await instrument("CDR");
    await setManualPrice(db, ania, cdr, { date: "2026-11-12", close: new Decimal("280") }, now);
    await db.price.create({
      data: { instrumentId: cdr, date: new Date("2026-11-10"), close: "274.5", source: "YAHOO" },
    });

    await expect(deleteManualPrice(db, ania, cdr, "2026-11-12")).resolves.toEqual({ ok: true });
    await expect(deleteManualPrice(db, ania, cdr, "2026-11-10")).resolves.toEqual({
      ok: false,
      reason: "notManual",
    });
    await expect(deleteManualPrice(db, ania, cdr, "2026-11-11")).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(deleteManualPrice(db, ania, "not-an-id", "2026-11-10")).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(storedPrices(cdr)).resolves.toEqual([["2026-11-10", "274.5", "YAHOO"]]);
  });

  it("changes how an instrument is quoted", async () => {
    const asml = await instrument("ASML", "EURONEXT", "EUR");

    await expect(
      updateQuoteSettings(db, ania, asml, { priceSource: "YAHOO", quoteSymbol: "ASML.AS" }),
    ).resolves.toEqual({ ok: true });
    await expect(getInstrument(db, asml)).resolves.toMatchObject({
      symbol: "ASML",
      priceSource: "YAHOO",
      quoteSymbol: "ASML.AS",
    });

    await updateQuoteSettings(db, ania, asml, { priceSource: "MANUAL", quoteSymbol: null });
    await expect(getInstrument(db, asml)).resolves.toMatchObject({
      priceSource: "MANUAL",
      quoteSymbol: null,
    });
  });

  it("reports an unknown instrument", async () => {
    await expect(getInstrument(db, UNKNOWN_ID)).resolves.toBeNull();
    await expect(getInstrument(db, "not-an-id")).resolves.toBeNull();
    await expect(
      updateQuoteSettings(db, ania, UNKNOWN_ID, { priceSource: "MANUAL", quoteSymbol: null }),
    ).resolves.toEqual({ ok: false, reason: "notFound" });
  });

  it("removes prices together with their instrument", async () => {
    const cdr = await instrument("CDR");
    await setManualPrice(db, ania, cdr, { date: "2026-11-12", close: new Decimal("280") }, now);

    await db.instrument.delete({ where: { id: cdr } });

    await expect(db.price.count()).resolves.toBe(0);
  });
});
