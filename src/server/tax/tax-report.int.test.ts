import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Decimal } from "@/domain/decimal";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser } from "@/test/fixtures";
import { getTaxReport } from "./tax-report";

const db = getDb();
const now = new Date("2026-11-13T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fixed = (value: Decimal | null) => (value ? value.toFixed(2) : null);

let ania: SessionUser;
let bartek: SessionUser;
let xtb: string;
let ike: string;
let second: string;
let cdr: string;
let aapl: string;
let btc: string;
let edo: string;

async function usdRate(date: string, rate: string) {
  await db.fxRate.create({ data: { currency: "USD", date: day(date), rate } });
}

async function buyAndSell(accountId: string, instrumentId: string, buy: string, sell: string) {
  await db.transaction.createMany({
    data: [
      {
        accountId,
        type: "BUY",
        date: day("2026-01-12"),
        instrumentId,
        quantity: "10",
        price: buy,
        currency: "PLN",
      },
      {
        accountId,
        type: "SELL",
        date: day("2026-06-10"),
        instrumentId,
        quantity: "10",
        price: sell,
        currency: "PLN",
      },
    ],
  });
}

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  bartek = await createTestUser(db, "bartek");

  const main = await db.portfolio.create({ data: { userId: ania.id, name: "Główny" } });
  const other = await db.portfolio.create({ data: { userId: ania.id, name: "Drugi" } });
  xtb = (await db.account.create({ data: { portfolioId: main.id, name: "XTB" } })).id;
  ike = (
    await db.account.create({ data: { portfolioId: main.id, name: "Emerytura", type: "IKE" } })
  ).id;
  second = (await db.account.create({ data: { portfolioId: other.id, name: "mBank" } })).id;

  const instrument = async (
    symbol: string,
    market: string,
    type: "STOCK" | "CRYPTO" | "BOND",
    currency: string,
    priceSource: "YAHOO" | "TREASURY" = "YAHOO",
  ) =>
    (
      await db.instrument.create({
        data: { symbol, market, name: symbol, type, currency, priceSource },
      })
    ).id;

  cdr = await instrument("CDR", "GPW", "STOCK", "PLN");
  aapl = await instrument("AAPL", "NASDAQ", "STOCK", "USD");
  btc = await instrument("BTC", "CRYPTO", "CRYPTO", "USD");
  edo = await instrument("EDO0135", "SKARB", "BOND", "PLN", "TREASURY");
});

afterAll(async () => {
  await disconnectDb();
});

describe("getTaxReport", () => {
  it("has nothing to show for a user without transactions", async () => {
    const view = await getTaxReport(db, ania, null, now);

    expect(view.year).toBe(2026);
    expect(view.years).toEqual([]);
    expect(view.report).toBeNull();
    expect(view.earlierYears).toEqual([]);
  });

  it("adds up sales from all portfolios of the user", async () => {
    await buyAndSell(xtb, cdr, "100", "150");
    await buyAndSell(second, cdr, "100", "120");

    const view = await getTaxReport(db, ania, null, now);

    expect(view.year).toBe(2026);
    expect(fixed(view.report!.securities.revenue)).toBe("2700.00");
    expect(fixed(view.report!.securities.costs)).toBe("2000.00");
    expect(fixed(view.report!.securities.tax)).toBe("133.00");
    expect(view.instruments[cdr]).toEqual({ symbol: "CDR", name: "CDR" });
    expect(view.accounts[second]).toEqual({ name: "mBank", portfolioName: "Drugi" });
  });

  it("leaves out IKE, IKZE and OKI accounts and names them", async () => {
    await buyAndSell(xtb, cdr, "100", "150");
    await buyAndSell(ike, cdr, "100", "500");

    const view = await getTaxReport(db, ania, null, now);

    expect(fixed(view.report!.securities.revenue)).toBe("1500.00");
    expect(view.excludedAccounts).toEqual([
      { name: "Emerytura", portfolioName: "Główny", type: "IKE" },
    ]);
    expect(view.accounts[ike]).toBeUndefined();
  });

  it("never shows another user's transactions", async () => {
    await buyAndSell(xtb, cdr, "100", "150");

    const view = await getTaxReport(db, bartek, null, now);

    expect(view.report).toBeNull();
    expect(view.years).toEqual([]);
    expect(view.excludedAccounts).toEqual([]);
    expect(view.accounts).toEqual({});
  });

  it("converts foreign amounts at the NBP rate of the day before", async () => {
    await usdRate("2026-05-14", "4.00");
    await usdRate("2026-05-15", "9.00");
    await db.transaction.create({
      data: {
        accountId: xtb,
        type: "DIVIDEND",
        date: day("2026-05-15"),
        instrumentId: aapl,
        amount: "100",
        tax: "15",
        currency: "USD",
      },
    });

    const { report } = await getTaxReport(db, ania, null, now);

    expect(fixed(report!.foreignIncome.gross)).toBe("400.00");
    expect(fixed(report!.foreignIncome.paidAbroad)).toBe("60.00");
    // 76.00 due, 60.00 paid abroad
    expect(fixed(report!.foreignIncome.toPay)).toBe("16.00");
    expect(report!.missingRates).toEqual([]);
  });

  it("names the currency whose rates are missing", async () => {
    await db.transaction.create({
      data: {
        accountId: xtb,
        type: "DIVIDEND",
        date: day("2026-05-15"),
        instrumentId: aapl,
        amount: "100",
        tax: "15",
        currency: "USD",
      },
    });

    const { report } = await getTaxReport(db, ania, null, now);

    expect(report!.foreignIncome.gross).toBeNull();
    expect(report!.missingRates).toEqual(["USD"]);
  });

  it("puts each kind of instrument in its own part of the report", async () => {
    await buyAndSell(xtb, cdr, "100", "150");
    await buyAndSell(xtb, edo, "100", "105");
    await db.transaction.createMany({
      data: [
        {
          accountId: xtb,
          type: "BUY",
          date: day("2026-02-02"),
          instrumentId: btc,
          quantity: "1",
          price: "1000",
          currency: "PLN",
          fxRate: "4",
        },
        {
          accountId: xtb,
          type: "DIVIDEND",
          date: day("2026-07-01"),
          instrumentId: cdr,
          amount: "50",
          tax: "9.5",
          currency: "PLN",
        },
      ],
    });

    const { report } = await getTaxReport(db, ania, null, now);

    expect(report!.securities.sales.map((sale) => sale.instrumentId)).toEqual([cdr]);
    expect(report!.savingsBonds.sales.map((sale) => sale.instrumentId)).toEqual([edo]);
    expect(fixed(report!.savingsBonds.income)).toBe("50.00");
    expect(fixed(report!.crypto.costs)).toBe("4000.00");
    expect(fixed(report!.crypto.carryForward)).toBe("4000.00");
    expect(fixed(report!.domesticIncome.withheld)).toBe("9.50");
    expect(report!.foreignIncome.lines).toEqual([]);
  });

  it("shows the requested year and the results of the years before it", async () => {
    await db.transaction.createMany({
      data: [
        {
          accountId: xtb,
          type: "BUY",
          date: day("2024-01-10"),
          instrumentId: cdr,
          quantity: "20",
          price: "100",
          currency: "PLN",
        },
        {
          accountId: xtb,
          type: "SELL",
          date: day("2024-06-10"),
          instrumentId: cdr,
          quantity: "10",
          price: "80",
          currency: "PLN",
        },
        {
          accountId: xtb,
          type: "SELL",
          date: day("2025-06-10"),
          instrumentId: cdr,
          quantity: "10",
          price: "130",
          currency: "PLN",
        },
      ],
    });

    const latest = await getTaxReport(db, ania, null, now);
    expect(latest.year).toBe(2026);
    expect(latest.years).toEqual([2026, 2025, 2024]);
    expect(latest.report!.empty).toBe(true);
    expect(latest.earlierYears.map((entry) => [entry.year, fixed(entry.income)])).toEqual([
      [2025, "300.00"],
      [2024, "-200.00"],
    ]);

    const earlier = await getTaxReport(db, ania, 2025, now);
    expect(earlier.year).toBe(2025);
    expect(fixed(earlier.report!.securities.income)).toBe("300.00");
    expect(earlier.earlierYears.map((entry) => entry.year)).toEqual([2024]);

    // A year without a report falls back to the current one.
    const unknown = await getTaxReport(db, ania, 1999, now);
    expect(unknown.year).toBe(2026);
  });
});
