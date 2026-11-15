import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { getPortfolioValuation } from "@/server/valuation/portfolio-valuation";
import { resetDatabase } from "@/test/db";
import { createTestUser, UNKNOWN_ID } from "@/test/fixtures";
import { createBond, deleteBondRate, getBond, loadBondSeries, setBondRate } from "./bonds";

const db = getDb();
const d = (value: string) => new Decimal(value);
let ania: SessionUser;

async function bond(series: string, firstRate: string, margin: string | null = null) {
  const result = await createBond(db, ania, {
    series,
    firstRate: d(firstRate),
    margin: margin === null ? null : d(margin),
  });
  if (!result.ok) throw new Error("could not create the test bond");
  return result.instrumentId;
}

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
});

afterAll(async () => {
  await disconnectDb();
});

describe("bond series", () => {
  it("is added to the catalogue as a PLN bond valued from its terms", async () => {
    const id = await bond("EDO1135", "5.35", "2");

    await expect(db.instrument.findUnique({ where: { id } })).resolves.toMatchObject({
      symbol: "EDO1135",
      market: "SKARB",
      name: "Obligacje 10-letnie EDO1135",
      type: "BOND",
      currency: "PLN",
      priceSource: "TREASURY",
      createdById: ania.id,
    });
    const detail = await getBond(db, id);
    expect(detail).toMatchObject({ instrumentId: id, series: "EDO1135", kind: "EDO", rates: [] });
    expect(detail?.firstRate.toFixed()).toBe("5.35");
    expect(detail?.margin?.toFixed()).toBe("2");
  });

  it("cannot be added twice", async () => {
    await bond("EDO1135", "5.35");

    await expect(
      createBond(db, ania, { series: "EDO1135", firstRate: d("6"), margin: null }),
    ).resolves.toEqual({ ok: false, reason: "exists" });
  });

  it("is not found for an ordinary instrument or an unknown id", async () => {
    const stock = await db.instrument.create({
      data: { symbol: "CDR", market: "GPW", name: "CD Projekt", type: "STOCK", currency: "PLN" },
    });

    await expect(getBond(db, stock.id)).resolves.toBeNull();
    await expect(getBond(db, UNKNOWN_ID)).resolves.toBeNull();
    await expect(getBond(db, "not-an-id")).resolves.toBeNull();
  });

  it("disappears together with its instrument", async () => {
    const id = await bond("EDO1135", "5.35");
    await setBondRate(db, ania, id, 2, d("4.5"));

    await db.instrument.delete({ where: { id } });

    await expect(db.bondSeries.count()).resolves.toBe(0);
    await expect(db.bondRate.count()).resolves.toBe(0);
  });
});

describe("rates of later periods", () => {
  it("are recorded, replaced and listed in period order", async () => {
    const id = await bond("EDO1135", "5.35");

    await expect(setBondRate(db, ania, id, 3, d("6.1"))).resolves.toEqual({ ok: true });
    await setBondRate(db, ania, id, 2, d("4.5"));
    await setBondRate(db, ania, id, 3, d("6.2"));

    const detail = await getBond(db, id);
    expect(detail?.rates.map(({ period, rate }) => [period, rate.toFixed()])).toEqual([
      [2, "4.5"],
      [3, "6.2"],
    ]);
  });

  it("exist only for periods the kind has", async () => {
    const id = await bond("COI1130", "4.75");

    for (const period of [1, 5, 0, 2.5]) {
      await expect(setBondRate(db, ania, id, period, d("5"))).resolves.toEqual({
        ok: false,
        reason: "invalidPeriod",
      });
    }
    await expect(setBondRate(db, ania, id, 4, d("5"))).resolves.toEqual({ ok: true });
  });

  it("can be deleted", async () => {
    const id = await bond("EDO1135", "5.35");
    await setBondRate(db, ania, id, 2, d("4.5"));

    await expect(deleteBondRate(db, ania, id, 2)).resolves.toEqual({ ok: true });
    await expect(deleteBondRate(db, ania, id, 2)).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    expect((await getBond(db, id))?.rates).toEqual([]);
  });

  it("report an unknown series", async () => {
    await expect(setBondRate(db, ania, UNKNOWN_ID, 2, d("5"))).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
    await expect(deleteBondRate(db, ania, "not-an-id", 2)).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("loadBondSeries", () => {
  it("returns the terms as fractions, only for the instruments that are bonds", async () => {
    const edo = await bond("EDO1135", "5.35");
    await setBondRate(db, ania, edo, 2, d("4.5"));
    const stock = await db.instrument.create({
      data: { symbol: "CDR", market: "GPW", name: "CD Projekt", type: "STOCK", currency: "PLN" },
    });

    const series = await loadBondSeries(db, [edo, stock.id]);

    expect([...series.keys()]).toEqual([edo]);
    expect(series.get(edo)?.kind).toBe("EDO");
    expect(series.get(edo)?.firstRate.toFixed()).toBe("0.0535");
    expect(series.get(edo)?.laterRates.get(2)?.toFixed()).toBe("0.045");
  });
});

describe("a portfolio holding treasury bonds", () => {
  const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
  let portfolioId: string;
  let accountId: string;

  beforeEach(async () => {
    const portfolio = await db.portfolio.create({ data: { userId: ania.id, name: "Obligacje" } });
    portfolioId = portfolio.id;
    accountId = (await db.account.create({ data: { portfolioId, name: "PKO" } })).id;
  });

  async function buy(instrumentId: string, date: string, quantity: string) {
    await db.transaction.create({
      data: {
        accountId,
        type: "BUY",
        date: day(date),
        instrumentId,
        quantity,
        price: "100",
        currency: "PLN",
      },
    });
  }

  it("values each purchase by what it has accrued since its own purchase day", async () => {
    const tos = await bond("TOS1128", "4.40");
    await buy(tos, "2025-11-01", "10");
    await buy(tos, "2026-05-01", "20");

    const valuation = (await getPortfolioValuation(
      db,
      ania,
      portfolioId,
      new Date("2026-11-01T12:00:00Z"),
    ))!;
    const [holding] = valuation.holdings;

    // 10 bonds are a full year old (104.40 each); 20 are 184 of 365 days old (102.22 each).
    expect(holding.value?.toFixed(2)).toBe("3088.40");
    expect(holding.cost?.toFixed(2)).toBe("3000.00");
    expect(holding.unrealized?.toFixed(2)).toBe("88.40");
    expect(holding.price).toMatchObject({ fromTrade: false });
    expect(valuation.missing).toEqual({ marketPrices: [], rates: [], bondRates: [] });
    expect(valuation.totals.incomplete).toBe(false);
  });

  it("flags a bond whose current rate has not been entered and uses the last known one", async () => {
    const edo = await bond("EDO1135", "5.35");
    await buy(edo, "2025-11-14", "10");
    const inSecondYear = new Date("2027-05-14T12:00:00Z");

    const before = (await getPortfolioValuation(db, ania, portfolioId, inSecondYear))!;
    expect(before.missing.bondRates).toEqual(["EDO1135"]);
    expect(before.holdings[0].price?.estimated).toBe(true);

    await setBondRate(db, ania, edo, 2, d("4.5"));

    const after = (await getPortfolioValuation(db, ania, portfolioId, inSecondYear))!;
    expect(after.missing.bondRates).toEqual([]);
    // 105.35 plus 181 of 365 days of 4.5% on it, for 10 bonds.
    expect(after.holdings[0].value?.toFixed(2)).toBe("1077.00");
    expect(after.holdings[0].value?.lt(before.holdings[0].value!)).toBe(true);
  });

  it("includes bonds in the history of the portfolio's value", async () => {
    const tos = await bond("TOS1128", "4.40");
    await buy(tos, "2025-11-01", "10");

    const { performance } = (await getPortfolioValuation(
      db,
      ania,
      portfolioId,
      new Date("2026-11-01T12:00:00Z"),
    ))!;

    expect(performance.chart[0]).toMatchObject({ date: "2025-11-01", value: 1000, cost: 1000 });
    expect(performance.chart.at(-1)).toMatchObject({ date: "2026-11-01", value: 1044, cost: 1000 });
    expect(performance.twr).toBeCloseTo(0.044, 10);
    expect(performance.xirr).toBeCloseTo(0.044, 4);
  });
});

describe("rates worked out from GUS and NBP data", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("fill the later periods of an inflation-linked series; an entered rate wins", async () => {
    // Sold in November 2024: period 2 follows September 2025, period 3 September 2026.
    const id = await bond("EDO1134", "6.55", "2");
    await db.inflationReading.createMany({
      data: [
        { year: 2025, month: 9, value: "2.9" },
        { year: 2026, month: 9, value: "4.1" },
      ],
    });
    await setBondRate(db, ania, id, 3, d("6.5"));

    const detail = await getBond(db, id, now);
    expect(detail?.rates.map((row) => [row.period, row.rate.toFixed(), row.source])).toEqual([
      [2, "4.9", "COMPUTED"],
      [3, "6.5", "MANUAL"],
    ]);

    const series = (await loadBondSeries(db, [id], now)).get(id);
    expect(
      [...(series?.laterRates ?? [])].map(([period, rate]) => [period, rate.toFixed()]),
    ).toEqual([
      [2, "0.049"],
      [3, "0.065"],
    ]);
  });

  it("follow the NBP reference rate for a monthly series, up to today", async () => {
    // Sold in September 2026: period 2 starts in October, period 3 in November, 4 in December.
    const id = await bond("ROR0927", "4.25", "0.1");
    await db.referenceRate.createMany({
      data: [
        { validFrom: new Date("2026-03-05"), rate: "4" },
        { validFrom: new Date("2026-10-08"), rate: "3.75" },
      ],
    });

    const detail = await getBond(db, id, now);
    // The rate for December is fixed on 17 November, which has not come yet.
    expect(detail?.rates.map((row) => [row.period, row.rate.toFixed(), row.source])).toEqual([
      [2, "4.1", "COMPUTED"],
      [3, "3.85", "COMPUTED"],
    ]);
  });

  it("leave a series without a margin alone", async () => {
    const id = await bond("EDO1134", "6.55");
    await db.inflationReading.create({ data: { year: 2025, month: 9, value: "2.9" } });

    await expect(getBond(db, id, now)).resolves.toMatchObject({ rates: [] });
    expect((await loadBondSeries(db, [id], now)).get(id)?.laterRates.size).toBe(0);
  });
});
