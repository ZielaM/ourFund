import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readXtbFile } from "@/domain/import/read";
import type { ImportedReport } from "@/domain/import/types";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { getPortfolioValuation } from "@/server/valuation/portfolio-valuation";
import { resetDatabase } from "@/test/db";
import { createTestUser, UNKNOWN_ID } from "@/test/fixtures";
import { xtbWorkbook, type XtbOperation, type XtbReportOptions } from "@/test/xtb-report";
import { planImport, runImport } from "./import";

const db = getDb();
const now = new Date("2026-11-13T12:00:00Z");

let ania: SessionUser;
let bartek: SessionUser;
let portfolioId: string;
let account: string;

function report(
  operations: XtbOperation[],
  options: Partial<XtbReportOptions> = {},
): ImportedReport {
  const result = readXtbFile(xtbWorkbook({ operations, ...options }));
  if (!result.ok) {
    throw new Error(`fixture is not a report: ${result.reason}`);
  }
  return result.report;
}

const trade = (
  type: "Stock purchase" | "Stock sell",
  time: string,
  quantity: number,
  price: number,
  ticker = "ABC.PL",
): XtbOperation => ({
  type,
  time,
  amount: (type === "Stock purchase" ? -1 : 1) * quantity * price,
  comment: `${type === "Stock purchase" ? "OPEN" : "CLOSE"} BUY ${quantity} @ ${price.toFixed(2)}`,
  ticker,
  instrument: `Spółka ${ticker}`,
});

const history: XtbOperation[] = [
  { type: "Deposit", time: "2026-01-02 10:00", amount: 5000, id: "d1" },
  { ...trade("Stock purchase", "2026-01-12 09:30", 10, 100), id: "b1" },
  { ...trade("Stock sell", "2026-03-02 09:30", 4, 150), id: "s1" },
  {
    type: "Dividend",
    time: "2026-05-15 08:00",
    amount: 30,
    ticker: "ABC.PL",
    instrument: "Spółka ABC.PL",
    id: "v1",
  },
  { type: "Withholding tax", time: "2026-05-15 08:00", amount: -5.7, ticker: "ABC.PL", id: "t1" },
  {
    type: "Free funds interest",
    time: "2026-06-03 13:00",
    amount: 2,
    comment: "Free-funds Interest 2026-05",
    id: "i1",
  },
];

async function stored() {
  const rows = await db.transaction.findMany({
    where: { accountId: account },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { instrument: { select: { symbol: true } } },
  });
  return rows.map(
    (row) =>
      `${row.date.toISOString().slice(0, 10)} ${row.type} ${row.instrument?.symbol ?? "-"} ${row.source}:${row.externalId}`,
  );
}

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  bartek = await createTestUser(db, "bartek");
  const portfolio = await db.portfolio.create({ data: { userId: ania.id, name: "Główny" } });
  portfolioId = portfolio.id;
  account = (await db.account.create({ data: { portfolioId, name: "XTB" } })).id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("planImport", () => {
  it("shows what would be added without writing anything", async () => {
    const result = await planImport(db, ania, account, report(history));
    if (!result.ok) {
      throw new Error("expected a plan");
    }
    const { plan } = result;

    expect(plan.source).toBe("XTB");
    expect(plan.currency).toBe("PLN");
    expect(plan.duplicates).toBe(0);
    expect(plan.problem).toBeNull();
    expect(plan.conflicts).toEqual([]);
    expect(
      plan.rows.map((row) => `${row.date} ${row.type} ${row.symbol ?? "-"} ${row.cash.toFixed(2)}`),
    ).toEqual([
      "2026-01-02 DEPOSIT - 5000.00",
      "2026-01-12 BUY ABC -1000.00",
      "2026-03-02 SELL ABC 600.00",
      "2026-05-15 DIVIDEND ABC 24.30",
      "2026-06-03 INTEREST - 2.00",
    ]);
    expect(plan.rows[1].quantity?.toFixed()).toBe("10");
    expect(plan.rows[1].price?.toFixed()).toBe("100");
    expect(plan.newInstruments).toEqual([
      { symbol: "ABC", market: "GPW", name: "Spółka ABC.PL", type: "STOCK", currency: "PLN" },
    ]);

    expect(await db.transaction.count()).toBe(0);
    expect(await db.instrument.count()).toBe(0);
  });

  it("refuses an account of another user or one that does not exist", async () => {
    expect(await planImport(db, bartek, account, report(history))).toEqual({
      ok: false,
      reason: "accountNotFound",
    });
    expect(await planImport(db, ania, UNKNOWN_ID, report(history))).toEqual({
      ok: false,
      reason: "accountNotFound",
    });
  });

  it("names the sale that the account cannot cover", async () => {
    const result = await planImport(
      db,
      ania,
      account,
      report([trade("Stock sell", "2026-03-02 09:30", 4, 150)]),
    );

    expect(result.ok && result.plan.problem).toEqual({ symbol: "ABC", date: "2026-03-02" });
  });

  it("passes on what the file left out and what it does not explain", async () => {
    const result = await planImport(
      db,
      ania,
      account,
      report(
        [
          { ...trade("Stock purchase", "2026-01-12 09:30", 10, 100), id: "b1" },
          { type: "Currency conversion", time: "2026-01-13 09:30", amount: -5, id: "c1" },
        ],
        {
          open: [
            {
              ticker: "ABC.PL",
              name: "Spółka ABC",
              positions: [{ id: "p1", volume: 15, openPrice: 100, time: "2026-01-12 09:30" }],
            },
          ],
        },
      ),
    );
    if (!result.ok) {
      throw new Error("expected a plan");
    }

    expect(result.plan.skipped.map((row) => row.label)).toEqual(["Currency conversion"]);
    expect(result.plan.holdingMismatches.map((entry) => entry.symbol)).toEqual(["ABC"]);
  });
});

describe("runImport", () => {
  it("adds the operations and the instruments they need", async () => {
    const result = await runImport(db, ania, account, report(history), now);

    expect(result).toEqual({ ok: true, imported: 5, duplicates: 0, instrumentsCreated: 1 });
    expect(await stored()).toEqual([
      "2026-01-02 DEPOSIT - XTB:d1",
      "2026-01-12 BUY ABC XTB:b1",
      "2026-03-02 SELL ABC XTB:s1",
      "2026-05-15 DIVIDEND ABC XTB:v1",
      "2026-06-03 INTEREST - XTB:i1",
    ]);

    const instrument = await db.instrument.findFirstOrThrow({ where: { symbol: "ABC" } });
    expect(instrument).toMatchObject({
      market: "GPW",
      type: "STOCK",
      currency: "PLN",
      priceSource: "YAHOO",
      createdById: ania.id,
    });

    const dividend = await db.transaction.findFirstOrThrow({ where: { type: "DIVIDEND" } });
    expect(dividend.amount?.toString()).toBe("30");
    expect(dividend.tax.toString()).toBe("5.7");
  });

  it("leaves the account in a state the valuation agrees with", async () => {
    await runImport(db, ania, account, report(history), now);

    const valuation = await getPortfolioValuation(db, ania, portfolioId, now);
    const holding = valuation!.holdings.find((entry) => entry.instrument.symbol === "ABC")!;

    expect(holding.quantity.toFixed()).toBe("6");
    expect(holding.cost?.toFixed(2)).toBe("600.00");
    // 5000 - 1000 + 600 + 24.30 + 2
    expect(valuation!.cash[0].balance.toFixed(2)).toBe("4626.30");
  });

  it("skips what an earlier import already added", async () => {
    await runImport(db, ania, account, report(history.slice(0, 3)), now);

    const plan = await planImport(db, ania, account, report(history));
    expect(plan.ok && plan.plan.duplicates).toBe(3);
    expect(plan.ok && plan.plan.rows.map((row) => row.type)).toEqual(["DIVIDEND", "INTEREST"]);
    expect(plan.ok && plan.plan.newInstruments).toEqual([]);

    const second = await runImport(db, ania, account, report(history), now);
    expect(second).toEqual({ ok: true, imported: 2, duplicates: 3, instrumentsCreated: 0 });
    expect(await db.transaction.count()).toBe(5);

    expect(await runImport(db, ania, account, report(history), now)).toEqual({
      ok: false,
      reason: "nothingToImport",
    });
  });

  it("keeps the order of the file for operations of the same day", async () => {
    await runImport(
      db,
      ania,
      account,
      report([
        { ...trade("Stock purchase", "2026-01-12 09:30", 5, 10), id: "1" },
        { ...trade("Stock sell", "2026-01-12 10:30", 5, 11), id: "2" },
        { ...trade("Stock purchase", "2026-01-12 11:30", 2, 12), id: "3" },
        { ...trade("Stock sell", "2026-01-12 12:30", 2, 13), id: "4" },
      ]),
      now,
    );

    expect((await stored()).map((line) => line.split(" ")[1])).toEqual([
      "BUY",
      "SELL",
      "BUY",
      "SELL",
    ]);
    // The account can still be replayed, which a sale recorded before its purchase would break.
    expect(await getPortfolioValuation(db, ania, portfolioId, now)).not.toBeNull();
  });

  it("uses an instrument that is already in the catalogue", async () => {
    const existing = await db.instrument.create({
      data: { symbol: "ABC", market: "NEWCONNECT", name: "Abc", type: "STOCK", currency: "PLN" },
    });

    const result = await runImport(db, ania, account, report(history), now);

    expect(result).toMatchObject({ ok: true, instrumentsCreated: 0 });
    expect(await db.instrument.count()).toBe(1);
    expect(await db.transaction.count({ where: { instrumentId: existing.id } })).toBe(3);
  });

  it("leaves out an instrument the catalogue knows in another currency", async () => {
    await db.instrument.create({
      data: { symbol: "ABC", market: "GPW", name: "Abc", type: "STOCK", currency: "EUR" },
    });

    const plan = await planImport(db, ania, account, report(history));
    expect(plan.ok && plan.plan.conflicts).toEqual(["ABC"]);
    expect(plan.ok && plan.plan.rows.map((row) => row.type)).toEqual(["DEPOSIT", "INTEREST"]);

    expect(await runImport(db, ania, account, report(history), now)).toMatchObject({
      ok: true,
      imported: 2,
    });
  });

  it("writes nothing when a sale exceeds what the account holds", async () => {
    const result = await runImport(
      db,
      ania,
      account,
      report([
        { type: "Deposit", time: "2026-01-02 10:00", amount: 5000 },
        trade("Stock sell", "2026-03-02 09:30", 4, 150),
      ]),
      now,
    );

    expect(result).toEqual({
      ok: false,
      reason: "insufficientQuantity",
      symbol: "ABC",
      date: "2026-03-02",
    });
    expect(await db.transaction.count()).toBe(0);
    expect(await db.instrument.count()).toBe(0);
  });

  it("counts units bought by hand before the import", async () => {
    const instrument = await db.instrument.create({
      data: { symbol: "ABC", market: "GPW", name: "Abc", type: "STOCK", currency: "PLN" },
    });
    await db.transaction.create({
      data: {
        accountId: account,
        type: "BUY",
        date: new Date("2025-06-01T00:00:00.000Z"),
        instrumentId: instrument.id,
        quantity: "4",
        price: "90",
        currency: "PLN",
      },
    });

    const result = await runImport(
      db,
      ania,
      account,
      report([trade("Stock sell", "2026-03-02 09:30", 4, 150)]),
      now,
    );

    expect(result).toMatchObject({ ok: true, imported: 1 });
  });

  it("imports the same report into two accounts independently", async () => {
    const other = (await db.account.create({ data: { portfolioId, name: "Drugi" } })).id;

    await runImport(db, ania, account, report(history), now);
    const second = await runImport(db, ania, other, report(history), now);

    expect(second).toEqual({ ok: true, imported: 5, duplicates: 0, instrumentsCreated: 0 });
  });

  it("never writes to another user's account", async () => {
    expect(await runImport(db, bartek, account, report(history), now)).toEqual({
      ok: false,
      reason: "accountNotFound",
    });
    expect(await db.transaction.count()).toBe(0);
  });
});
