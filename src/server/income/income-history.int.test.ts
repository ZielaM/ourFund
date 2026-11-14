import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Decimal } from "@/domain/decimal";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser } from "@/test/fixtures";
import { getIncomeHistory } from "./income-history";

const db = getDb();
const now = new Date("2026-11-13T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fixed = (value: Decimal | null) => (value ? value.toFixed(2) : null);

let ania: SessionUser;
let bartek: SessionUser;
let xtb: string;
let ike: string;
let cdr: string;
let aapl: string;

async function pay(
  accountId: string,
  date: string,
  amount: string,
  tax: string,
  instrumentId: string | null = cdr,
  currency = "PLN",
  type: "DIVIDEND" | "INTEREST" = "DIVIDEND",
) {
  await db.transaction.create({
    data: { accountId, type, date: day(date), instrumentId, amount, tax, currency },
  });
}

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  bartek = await createTestUser(db, "bartek");

  const main = await db.portfolio.create({ data: { userId: ania.id, name: "Główny" } });
  const other = await db.portfolio.create({ data: { userId: ania.id, name: "Emerytalny" } });
  xtb = (await db.account.create({ data: { portfolioId: main.id, name: "XTB" } })).id;
  ike = (await db.account.create({ data: { portfolioId: other.id, name: "IKE", type: "IKE" } })).id;
  cdr = (
    await db.instrument.create({
      data: { symbol: "CDR", market: "GPW", name: "CD Projekt", type: "STOCK", currency: "PLN" },
    })
  ).id;
  aapl = (
    await db.instrument.create({
      data: { symbol: "AAPL", market: "NASDAQ", name: "Apple", type: "STOCK", currency: "USD" },
    })
  ).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("getIncomeHistory", () => {
  it("has nothing to show before the first payment", async () => {
    const view = await getIncomeHistory(db, ania, null, now);

    expect(view.year).toBe(2026);
    expect(view.years).toEqual([]);
    expect(view.payments).toEqual([]);
    expect(fixed(view.total)).toBe("0.00");
    expect(view.byYear).toEqual([]);
    expect(view.months).toHaveLength(12);
  });

  it("adds up payments on all accounts of all portfolios, tax-exempt ones included", async () => {
    await pay(xtb, "2026-03-10", "100", "19");
    await pay(ike, "2026-03-20", "50", "0");
    await pay(xtb, "2026-08-01", "10", "1.90", null, "PLN", "INTEREST");

    const view = await getIncomeHistory(db, ania, null, now);

    expect(fixed(view.total)).toBe("139.10");
    expect(fixed(view.allTime)).toBe("139.10");
    expect(fixed(view.months[2].net)).toBe("131.00");
    expect(fixed(view.months[7].net)).toBe("8.10");
    expect(view.payments.map((payment) => payment.date)).toEqual([
      "2026-08-01",
      "2026-03-20",
      "2026-03-10",
    ]);
    expect(view.byInstrument.map((group) => [group.instrumentId, fixed(group.net)])).toEqual([
      [cdr, "131.00"],
      [null, "8.10"],
    ]);
    expect(view.instruments[cdr]).toEqual({ symbol: "CDR", name: "CD Projekt" });
    expect(view.accounts[ike]).toEqual({ name: "IKE", portfolioName: "Emerytalny" });
  });

  it("converts foreign payments at the NBP rate of the payment day", async () => {
    await db.fxRate.create({ data: { currency: "USD", date: day("2026-05-15"), rate: "4" } });
    await pay(xtb, "2026-05-15", "100", "15", aapl, "USD");

    const view = await getIncomeHistory(db, ania, null, now);

    expect(fixed(view.total)).toBe("340.00");
    expect(view.missingRates).toEqual([]);
  });

  it("names the currency whose rate is missing", async () => {
    await pay(xtb, "2026-05-15", "100", "15", aapl, "USD");
    await pay(xtb, "2026-06-15", "100", "19");

    const view = await getIncomeHistory(db, ania, null, now);

    expect(view.total).toBeNull();
    expect(view.missingRates).toEqual(["USD"]);
    expect(fixed(view.months[5].net)).toBe("81.00");
  });

  it("shows the requested year next to the totals of all years", async () => {
    await pay(xtb, "2024-06-01", "100", "19");
    await pay(xtb, "2026-06-01", "200", "38");

    const earlier = await getIncomeHistory(db, ania, 2024, now);
    expect(earlier.year).toBe(2024);
    expect(earlier.years).toEqual([2026, 2025, 2024]);
    expect(fixed(earlier.total)).toBe("81.00");
    expect(fixed(earlier.allTime)).toBe("243.00");
    expect(earlier.byYear.map((entry) => [entry.year, fixed(entry.net)])).toEqual([
      [2024, "81.00"],
      [2025, "0.00"],
      [2026, "162.00"],
    ]);
    expect(earlier.payments).toHaveLength(1);

    // A year without history falls back to the current one.
    expect((await getIncomeHistory(db, ania, 1999, now)).year).toBe(2026);
  });

  it("never shows another user's payments", async () => {
    await pay(xtb, "2026-03-10", "100", "19");

    const view = await getIncomeHistory(db, bartek, null, now);

    expect(view.years).toEqual([]);
    expect(view.payments).toEqual([]);
    expect(view.accounts).toEqual({});
    expect(fixed(view.allTime)).toBe("0.00");
  });
});
