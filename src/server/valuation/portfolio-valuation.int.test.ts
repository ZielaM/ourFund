import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser, UNKNOWN_ID } from "@/test/fixtures";
import { getPortfolioValuation } from "./portfolio-valuation";

const db = getDb();
const now = new Date("2026-11-13T12:00:00Z");

let ania: SessionUser;
let portfolioId: string;
let xtb: string;
let ike: string;
let cdr: string;
let aapl: string;

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

async function price(instrumentId: string, date: string, close: string) {
  await db.price.create({ data: { instrumentId, date: day(date), close, source: "YAHOO" } });
}

async function usdRate(date: string, rate: string) {
  await db.fxRate.create({ data: { currency: "USD", date: day(date), rate } });
}

/** The portfolio used by most tests; every expected figure below follows from these rows. */
async function seedTransactions() {
  await db.transaction.createMany({
    data: [
      {
        accountId: xtb,
        type: "DEPOSIT",
        date: day("2026-01-02"),
        amount: "10000",
        currency: "PLN",
      },
      {
        accountId: xtb,
        type: "BUY",
        date: day("2026-01-12"),
        instrumentId: cdr,
        quantity: "10",
        price: "100",
        fee: "5",
        currency: "PLN",
      },
      {
        accountId: xtb,
        type: "BUY",
        date: day("2026-01-12"),
        instrumentId: aapl,
        quantity: "2",
        price: "100",
        currency: "USD",
      },
      {
        accountId: ike,
        type: "BUY",
        date: day("2026-02-10"),
        instrumentId: cdr,
        quantity: "5",
        price: "200",
        currency: "PLN",
      },
      {
        accountId: xtb,
        type: "DIVIDEND",
        date: day("2026-06-01"),
        instrumentId: cdr,
        amount: "50",
        tax: "9.5",
        currency: "PLN",
      },
    ],
  });
}

async function seedMarketData() {
  await price(cdr, "2026-01-12", "100");
  await price(cdr, "2026-11-13", "120");
  await price(aapl, "2026-01-12", "100");
  await price(aapl, "2026-11-13", "110");
  await usdRate("2026-01-12", "4");
  await usdRate("2026-11-13", "4.2");
}

const fixed = (value: { toFixed(): string } | null | undefined) => value?.toFixed() ?? null;

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  const portfolio = await db.portfolio.create({ data: { userId: ania.id, name: "Główny" } });
  portfolioId = portfolio.id;
  xtb = (await db.account.create({ data: { portfolioId, name: "XTB" } })).id;
  ike = (await db.account.create({ data: { portfolioId, name: "IKE", type: "IKE" } })).id;
  cdr = (
    await db.instrument.create({
      data: { symbol: "CDR", market: "GPW", name: "CD Projekt", type: "STOCK", currency: "PLN" },
    })
  ).id;
  aapl = (
    await db.instrument.create({
      data: { symbol: "AAPL", market: "NASDAQ", name: "Apple", type: "ETF", currency: "USD" },
    })
  ).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("getPortfolioValuation", () => {
  it("is empty for a portfolio without transactions", async () => {
    const valuation = await getPortfolioValuation(db, ania, portfolioId, now);

    expect(valuation).toMatchObject({
      date: "2026-11-13",
      holdings: [],
      cash: [],
      allocation: { byClass: [], byCurrency: [], byAccount: [] },
      performance: { twr: null, xirr: null, since: null, chart: [] },
      missing: { marketPrices: [], rates: [] },
    });
    expect(fixed(valuation?.totals.value)).toBe("0");
    expect(valuation?.totals.incomplete).toBe(false);
  });

  it("values holdings in PLN, combined across accounts and sorted by value", async () => {
    await seedTransactions();
    await seedMarketData();

    const valuation = await getPortfolioValuation(db, ania, portfolioId, now);

    expect(
      valuation?.holdings.map((holding) => [
        holding.instrument.symbol,
        fixed(holding.quantity),
        fixed(holding.value),
        fixed(holding.cost),
        fixed(holding.unrealized),
        fixed(holding.priceEffect),
        fixed(holding.fxEffect),
        fixed(holding.income),
      ]),
    ).toEqual([
      // 15 × 120; cost 1005 + 1000; dividend 50 − 9.5.
      ["CDR", "15", "1800", "2005", "-205", "-205", "0", "40.5"],
      // 2 × 110 × 4.2; bought for 2 × 100 × 4.0.
      ["AAPL", "2", "924", "800", "124", "84", "40", "0"],
    ]);
  });

  it("values cash per account and currency, negative balances included", async () => {
    await seedTransactions();
    await seedMarketData();

    const valuation = await getPortfolioValuation(db, ania, portfolioId, now);

    expect(
      valuation?.cash.map((c) => [c.accountName, c.currency, fixed(c.balance), fixed(c.value)]),
    ).toEqual([
      ["XTB", "PLN", "9035.5", "9035.5"],
      ["XTB", "USD", "-200", "-840"],
      ["IKE", "PLN", "-1000", "-1000"],
    ]);
  });

  it("adds up the totals", async () => {
    await seedTransactions();
    await seedMarketData();

    const totals = (await getPortfolioValuation(db, ania, portfolioId, now))!.totals;

    expect(fixed(totals.holdingsValue)).toBe("2724");
    expect(fixed(totals.cashValue)).toBe("7195.5");
    expect(fixed(totals.value)).toBe("9919.5");
    expect(fixed(totals.cost)).toBe("2805");
    expect(fixed(totals.unrealized)).toBe("-81");
    expect(fixed(totals.income)).toBe("40.5");
    expect(fixed(totals.gain)).toBe("-40.5");
    expect(totals.incomplete).toBe(false);
  });

  it("shows how the value splits by class, currency and account", async () => {
    await seedTransactions();
    await seedMarketData();

    const { allocation } = (await getPortfolioValuation(db, ania, portfolioId, now))!;
    const slices = (list: { key: string; value: { toFixed(): string } }[]) =>
      list.map((slice) => [slice.key, slice.value.toFixed()]);

    // Overdrawn cash balances are debts, not part of what is held.
    expect(slices(allocation.byClass)).toEqual([
      ["CASH", "9035.5"],
      ["STOCK", "1800"],
      ["ETF", "924"],
    ]);
    expect(slices(allocation.byCurrency)).toEqual([
      ["PLN", "10835.5"],
      ["USD", "924"],
    ]);
    expect(slices(allocation.byAccount)).toEqual([
      ["XTB", "11159.5"],
      ["IKE", "600"],
    ]);
    expect(allocation.byCurrency.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 10);
  });

  it("computes returns and a history that ends at today's value", async () => {
    await seedTransactions();
    await seedMarketData();

    const { performance } = (await getPortfolioValuation(db, ania, portfolioId, now))!;

    expect(performance.since).toBe("2026-01-02");
    expect(performance.chart[0]).toEqual({ date: "2026-01-02", value: 0, cost: 0 });
    expect(performance.chart.at(-1)?.date).toBe("2026-11-13");
    expect(performance.chart.at(-1)?.value).toBeCloseTo(2724, 6);
    // Cost of what is held: 1005 + 800 + 1000.
    expect(performance.chart.at(-1)?.cost).toBeCloseTo(2805, 6);
    expect(performance.chart.length).toBeLessThanOrEqual(261);

    // Day by day: bought for 1805 what closed at 1800; then paid 1000 on the IKE for shares
    // quoted at 500 that day; then a 40.5 dividend on 2300; then 2300 grew to 2724.
    const expectedGrowth = (1800 / 1805) * (1300 / 1800) * (2340.5 / 2300) * (2724 / 2300);
    expect(performance.twr).toBeCloseTo(expectedGrowth - 1, 10);

    // Money-weighted: 2805 paid in, 40.5 and 2724 back, over ten months.
    expect(performance.xirr).not.toBeNull();
    expect(performance.xirr!).toBeLessThan(0);
    expect(performance.xirr!).toBeGreaterThan(-0.05);
  });

  it("falls back to the last trade price and says so when a market price is missing", async () => {
    await seedTransactions();
    await price(cdr, "2026-11-13", "120");
    await usdRate("2026-01-12", "4");
    await usdRate("2026-11-13", "4.2");

    const valuation = (await getPortfolioValuation(db, ania, portfolioId, now))!;
    const apple = valuation.holdings.find((holding) => holding.instrument.symbol === "AAPL");

    expect(valuation.missing.marketPrices).toEqual(["AAPL"]);
    expect(apple?.price).toMatchObject({ date: "2026-01-12", fromTrade: true });
    // 2 × 100 (the purchase price) × 4.2
    expect(fixed(apple?.value)).toBe("840");
    expect(valuation.totals.incomplete).toBe(false);
  });

  it("marks the valuation as incomplete while exchange rates are missing", async () => {
    await seedTransactions();
    await price(cdr, "2026-11-13", "120");
    await price(aapl, "2026-11-13", "110");

    const valuation = (await getPortfolioValuation(db, ania, portfolioId, now))!;
    const apple = valuation.holdings.find((holding) => holding.instrument.symbol === "AAPL");

    expect(valuation.missing.rates).toEqual(["USD"]);
    expect(apple?.value).toBeNull();
    expect(valuation.totals.incomplete).toBe(true);
    // Only what could be valued is counted.
    expect(fixed(valuation.totals.holdingsValue)).toBe("1800");
    expect(valuation.performance.twr).toBeNull();
    expect(valuation.performance.xirr).toBeNull();
  });

  it("uses the latest price on or before today, not a later one", async () => {
    await seedTransactions();
    await seedMarketData();
    await price(cdr, "2026-11-14", "999");

    const valuation = (await getPortfolioValuation(db, ania, portfolioId, now))!;

    expect(fixed(valuation.holdings.find((h) => h.instrument.symbol === "CDR")?.value)).toBe(
      "1800",
    );
  });

  it("keeps closed positions with their realized result in PLN", async () => {
    await seedTransactions();
    await seedMarketData();
    await usdRate("2026-06-01", "4.5");
    await db.transaction.create({
      data: {
        accountId: xtb,
        type: "SELL",
        date: day("2026-06-01"),
        instrumentId: aapl,
        quantity: "2",
        price: "150",
        currency: "USD",
      },
    });

    const valuation = (await getPortfolioValuation(db, ania, portfolioId, now))!;
    const apple = valuation.holdings.find((holding) => holding.instrument.symbol === "AAPL");

    expect(fixed(apple?.quantity)).toBe("0");
    expect(fixed(apple?.value)).toBe("0");
    // 2 × (150 × 4.5 − 100 × 4.0)
    expect(fixed(apple?.realized)).toBe("550");
    expect(fixed(valuation.totals.realized)).toBe("550");
  });

  it("returns null for another user's portfolio and for an unknown one", async () => {
    await seedTransactions();
    const jan = await createTestUser(db, "jan");

    await expect(getPortfolioValuation(db, jan, portfolioId, now)).resolves.toBeNull();
    await expect(getPortfolioValuation(db, ania, UNKNOWN_ID, now)).resolves.toBeNull();
  });
});
