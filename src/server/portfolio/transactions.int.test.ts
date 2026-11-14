import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  transactionInputSchema,
  type TransactionInput,
} from "@/domain/portfolio/transaction-input";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { getPortfolioValuation } from "@/server/valuation/portfolio-valuation";
import { createTestUser, UNKNOWN_ID } from "@/test/fixtures";
import { createInstrument } from "./instruments";
import { createAccount, createPortfolio } from "./portfolios";
import {
  addTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "./transactions";

const db = getDb();
const now = new Date("2026-06-15T10:00:00Z");

let ania: SessionUser;
let jan: SessionUser;
let portfolioId: string;
let accountId: string;
let ikeId: string;
let cdrId: string;
let aaplId: string;

/** Builds a validated input the same way the form does: from text fields. */
function input(fields: Record<string, string>): TransactionInput {
  return transactionInputSchema.parse({ accountId, ...fields });
}

const buy = (date: string, quantity: string, price: string, extra: Record<string, string> = {}) =>
  input({ type: "BUY", instrumentId: cdrId, date, quantity, price, ...extra });
const sell = (date: string, quantity: string, price: string, extra: Record<string, string> = {}) =>
  input({ type: "SELL", instrumentId: cdrId, date, quantity, price, ...extra });

async function add(transaction: TransactionInput, actor = ania): Promise<string> {
  const result = await addTransaction(db, actor, transaction, now);
  if (!result.ok) throw new Error(`could not add the transaction: ${result.reason}`);
  return result.id;
}

async function holdingOf(symbol: string) {
  const result = await getPortfolioValuation(db, ania, portfolioId, now);
  return result?.holdings.find((holding) => holding.instrument.symbol === symbol);
}

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  jan = await createTestUser(db, "jan");

  const portfolio = await createPortfolio(db, ania, { name: "Główny" });
  if (!portfolio.ok) throw new Error("setup failed");
  portfolioId = portfolio.id;

  const account = await createAccount(db, ania, portfolioId, {
    name: "XTB",
    type: "STANDARD",
    institution: "XTB",
  });
  const ike = await createAccount(db, ania, portfolioId, {
    name: "IKE",
    type: "IKE",
    institution: null,
  });
  if (!account.ok || !ike.ok) throw new Error("setup failed");
  accountId = account.id;
  ikeId = ike.id;

  const cdr = await createInstrument(db, ania, {
    symbol: "CDR",
    market: "GPW",
    name: "CD Projekt",
    type: "STOCK",
    currency: "PLN",
  });
  const aapl = await createInstrument(db, ania, {
    symbol: "AAPL",
    market: "NASDAQ",
    name: "Apple",
    type: "STOCK",
    currency: "USD",
  });
  if (!cdr.ok || !aapl.ok) throw new Error("setup failed");
  cdrId = cdr.instrument.id;
  aaplId = aapl.instrument.id;
});

afterAll(async () => {
  await disconnectDb();
});

describe("addTransaction", () => {
  it("stores a purchase exactly as entered", async () => {
    const id = await add(buy("2026-01-10", "10,5", "123,45", { fee: "5", note: "pierwszy zakup" }));

    const stored = await getTransaction(db, ania, id);

    expect(stored).toMatchObject({
      id,
      portfolioId,
      accountId,
      accountName: "XTB",
      type: "BUY",
      date: "2026-01-10",
      instrument: { id: cdrId, symbol: "CDR", name: "CD Projekt", currency: "PLN" },
      currency: "PLN",
      note: "pierwszy zakup",
      amount: null,
      splitRatio: null,
    });
    expect(stored?.quantity?.toFixed()).toBe("10.5");
    expect(stored?.price?.toFixed()).toBe("123.45");
    expect(stored?.fee.toFixed()).toBe("5");
    expect(stored?.fxRate.toFixed()).toBe("1");
  });

  it("defaults the settlement currency to the instrument's and ignores a rate", async () => {
    const id = await add(
      input({
        type: "BUY",
        instrumentId: aaplId,
        date: "2026-01-10",
        quantity: "2",
        price: "100",
        fxRate: "4",
      }),
    );

    const stored = await getTransaction(db, ania, id);
    expect(stored?.currency).toBe("USD");
    expect(stored?.fxRate.toFixed()).toBe("1");
  });

  it("keeps the rate when the account paid in another currency", async () => {
    const id = await add(
      input({
        type: "BUY",
        instrumentId: aaplId,
        date: "2026-01-10",
        quantity: "2",
        price: "100",
        currency: "PLN",
        fxRate: "4,05",
      }),
    );

    const stored = await getTransaction(db, ania, id);
    expect(stored?.currency).toBe("PLN");
    expect(stored?.fxRate.toFixed()).toBe("4.05");
  });

  it("stores every other kind of transaction", async () => {
    await add(input({ type: "DEPOSIT", date: "2026-01-02", amount: "5000", currency: "PLN" }));
    await add(buy("2026-01-10", "10", "100"));
    await add(
      input({
        type: "DIVIDEND",
        instrumentId: cdrId,
        date: "2026-06-01",
        amount: "50",
        tax: "9,5",
        currency: "PLN",
      }),
    );
    await add(input({ type: "INTEREST", date: "2026-06-02", amount: "3", currency: "PLN" }));
    await add(input({ type: "FEE", date: "2026-06-03", amount: "1", currency: "PLN" }));
    await add(input({ type: "SPLIT", instrumentId: cdrId, date: "2026-06-04", splitRatio: "2" }));
    await add(input({ type: "WITHDRAWAL", date: "2026-06-05", amount: "100", currency: "PLN" }));

    const transactions = await listTransactions(db, ania, portfolioId);

    expect(transactions?.map((transaction) => transaction.type)).toEqual([
      "WITHDRAWAL",
      "SPLIT",
      "FEE",
      "INTEREST",
      "DIVIDEND",
      "BUY",
      "DEPOSIT",
    ]);
    const holding = await holdingOf("CDR");
    expect(holding?.quantity.toFixed()).toBe("20");
    expect(holding?.income?.toFixed()).toBe("40.5");
  });

  it("accepts a transaction dated today in Poland and rejects tomorrow's", async () => {
    await expect(
      addTransaction(db, ania, buy("2026-06-15", "1", "100"), now),
    ).resolves.toMatchObject({ ok: true });
    await expect(addTransaction(db, ania, buy("2026-06-16", "1", "100"), now)).resolves.toEqual({
      ok: false,
      reason: "futureDate",
    });
  });

  it("refuses an unknown account or instrument", async () => {
    await expect(
      addTransaction(db, ania, { ...buy("2026-01-10", "1", "100"), accountId: UNKNOWN_ID }, now),
    ).resolves.toEqual({ ok: false, reason: "accountNotFound" });
    await expect(
      addTransaction(
        db,
        ania,
        input({
          type: "BUY",
          instrumentId: UNKNOWN_ID,
          date: "2026-01-10",
          quantity: "1",
          price: "1",
        }),
        now,
      ),
    ).resolves.toEqual({ ok: false, reason: "instrumentNotFound" });
  });

  it("refuses a transaction on an index, which exists only as a benchmark", async () => {
    const index = await createInstrument(db, ania, {
      symbol: "SPX",
      market: "OTHER",
      name: "S&P 500",
      type: "INDEX",
      currency: "USD",
    });
    if (!index.ok) throw new Error("setup failed");

    await expect(
      addTransaction(
        db,
        ania,
        input({
          type: "BUY",
          instrumentId: index.instrument.id,
          date: "2026-01-10",
          quantity: "1",
          price: "5000",
        }),
        now,
      ),
    ).resolves.toEqual({ ok: false, reason: "notTradable" });
  });

  it("refuses to sell more than the account holds", async () => {
    await add(buy("2026-01-10", "10", "100"));

    await expect(addTransaction(db, ania, sell("2026-02-10", "11", "150"), now)).resolves.toEqual({
      ok: false,
      reason: "insufficientQuantity",
    });
    await expect(db.transaction.count()).resolves.toBe(1);
  });

  it("refuses a sale dated before the purchase it would sell", async () => {
    await add(buy("2026-03-10", "10", "100"));

    await expect(addTransaction(db, ania, sell("2026-02-10", "5", "150"), now)).resolves.toEqual({
      ok: false,
      reason: "insufficientQuantity",
    });
  });

  it("checks holdings per account: units on another account cannot be sold", async () => {
    await add({ ...buy("2026-01-10", "10", "100"), accountId: ikeId });

    await expect(addTransaction(db, ania, sell("2026-02-10", "5", "150"), now)).resolves.toEqual({
      ok: false,
      reason: "insufficientQuantity",
    });
  });

  it("lets only one of two simultaneous sales of the same units through", async () => {
    await add(buy("2026-01-10", "10", "100"));

    const results = await Promise.all([
      addTransaction(db, ania, sell("2026-02-10", "10", "150"), now),
      addTransaction(db, ania, sell("2026-02-10", "10", "150"), now),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await expect(db.transaction.count({ where: { type: "SELL" } })).resolves.toBe(1);
  });
});

describe("updateTransaction", () => {
  it("changes the values of a transaction", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));

    await expect(
      updateTransaction(db, ania, id, buy("2026-01-12", "8", "110", { fee: "3" }), now),
    ).resolves.toEqual({ ok: true, id });

    const stored = await getTransaction(db, ania, id);
    expect(stored).toMatchObject({ date: "2026-01-12", type: "BUY" });
    expect(stored?.quantity?.toFixed()).toBe("8");
    expect(stored?.price?.toFixed()).toBe("110");
    expect(stored?.fee.toFixed()).toBe("3");
  });

  it("can change the type, clearing fields that no longer apply", async () => {
    const id = await add(buy("2026-01-10", "10", "100", { fee: "5" }));

    await updateTransaction(
      db,
      ania,
      id,
      input({ type: "DEPOSIT", date: "2026-01-10", amount: "1000", currency: "PLN" }),
      now,
    );

    const stored = await getTransaction(db, ania, id);
    expect(stored).toMatchObject({
      type: "DEPOSIT",
      instrument: null,
      quantity: null,
      price: null,
    });
    expect(stored?.amount?.toFixed()).toBe("1000");
    expect(stored?.fee.toFixed()).toBe("0");
  });

  it("keeps the transaction on its account", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));

    await updateTransaction(
      db,
      ania,
      id,
      { ...buy("2026-01-10", "10", "100"), accountId: ikeId },
      now,
    );

    await expect(getTransaction(db, ania, id)).resolves.toMatchObject({ accountId });
  });

  it("refuses a change that would leave a later sale without units", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));
    await add(sell("2026-02-10", "10", "150"));

    await expect(
      updateTransaction(db, ania, id, buy("2026-01-10", "9", "100"), now),
    ).resolves.toEqual({ ok: false, reason: "insufficientQuantity" });
    await expect(
      updateTransaction(db, ania, id, buy("2026-03-01", "10", "100"), now),
    ).resolves.toEqual({ ok: false, reason: "insufficientQuantity" });

    const stored = await getTransaction(db, ania, id);
    expect(stored?.quantity?.toFixed()).toBe("10");
    expect(stored?.date).toBe("2026-01-10");
  });

  it("applies the same rules as adding", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));

    await expect(
      updateTransaction(db, ania, id, buy("2026-06-16", "10", "100"), now),
    ).resolves.toEqual({ ok: false, reason: "futureDate" });
    await expect(
      updateTransaction(
        db,
        ania,
        id,
        input({
          type: "BUY",
          instrumentId: UNKNOWN_ID,
          date: "2026-01-10",
          quantity: "1",
          price: "1",
        }),
        now,
      ),
    ).resolves.toEqual({ ok: false, reason: "instrumentNotFound" });
  });

  it.each([UNKNOWN_ID, "not-an-id"])(
    "reports a transaction that does not exist (%s)",
    async (id) => {
      await expect(
        updateTransaction(db, ania, id, buy("2026-01-10", "1", "100"), now),
      ).resolves.toEqual({ ok: false, reason: "notFound" });
    },
  );
});

describe("deleteTransaction", () => {
  it("deletes a transaction", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));

    await expect(deleteTransaction(db, ania, id)).resolves.toEqual({ ok: true });
    await expect(getTransaction(db, ania, id)).resolves.toBeNull();
  });

  it("refuses to delete a purchase that a later sale depends on", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));
    await add(sell("2026-02-10", "10", "150"));

    await expect(deleteTransaction(db, ania, id)).resolves.toEqual({
      ok: false,
      reason: "insufficientQuantity",
    });
    await expect(getTransaction(db, ania, id)).resolves.not.toBeNull();
  });

  it("allows deleting the sale first and then the purchase", async () => {
    const purchase = await add(buy("2026-01-10", "10", "100"));
    const sale = await add(sell("2026-02-10", "10", "150"));

    await expect(deleteTransaction(db, ania, sale)).resolves.toEqual({ ok: true });
    await expect(deleteTransaction(db, ania, purchase)).resolves.toEqual({ ok: true });
  });

  it.each([UNKNOWN_ID, "not-an-id"])(
    "reports a transaction that does not exist (%s)",
    async (id) => {
      await expect(deleteTransaction(db, ania, id)).resolves.toEqual({
        ok: false,
        reason: "notFound",
      });
    },
  );
});

describe("listTransactions", () => {
  it("lists the portfolio's transactions from all accounts, newest first", async () => {
    await add(buy("2026-01-10", "10", "100"));
    await add({ ...buy("2026-03-10", "1", "100"), accountId: ikeId });
    await add(buy("2026-02-10", "5", "100"));

    const transactions = await listTransactions(db, ania, portfolioId);

    expect(transactions?.map((t) => [t.date, t.accountName])).toEqual([
      ["2026-03-10", "IKE"],
      ["2026-02-10", "XTB"],
      ["2026-01-10", "XTB"],
    ]);
  });

  it("puts later entries of the same day first", async () => {
    const first = await add(buy("2026-01-10", "10", "100"));
    const second = await add(sell("2026-01-10", "4", "110"));

    const transactions = await listTransactions(db, ania, portfolioId);

    expect(transactions?.map((t) => t.id)).toEqual([second, first]);
  });

  it("returns null for a portfolio that does not exist", async () => {
    await expect(listTransactions(db, ania, UNKNOWN_ID)).resolves.toBeNull();
  });
});

describe("holdings computed from transactions", () => {
  it("uses FIFO per account and adds the accounts up", async () => {
    await add(buy("2026-01-10", "10", "100", { fee: "5" }));
    await add(buy("2026-02-10", "10", "200"));
    await add(sell("2026-03-10", "15", "300", { fee: "10" }));
    await add({ ...buy("2026-04-10", "20", "250"), accountId: ikeId });

    const holding = await holdingOf("CDR");

    // XTB: 5 units left from the second lot (cost 1000); IKE: 20 units (cost 5000).
    expect(holding?.quantity.toFixed()).toBe("25");
    expect(holding?.cost?.toFixed()).toBe("6000");
    expect(holding?.averageCost?.toFixed()).toBe("240");
    // 15 × 300 − 10 − (1005 + 5 × 200)
    expect(holding?.realized?.toFixed()).toBe("2485");
    expect(holding?.instrument).toMatchObject({ symbol: "CDR", currency: "PLN" });
    expect(holding?.accounts.map((a) => [a.accountName, a.quantity.toFixed()])).toEqual([
      ["XTB", "5"],
      ["IKE", "20"],
    ]);
  });

  it("tracks cash per account and currency", async () => {
    await add(input({ type: "DEPOSIT", date: "2026-01-02", amount: "5000", currency: "PLN" }));
    await add(buy("2026-01-10", "10", "100"));
    await add(
      input({
        type: "BUY",
        instrumentId: aaplId,
        date: "2026-01-11",
        quantity: "2",
        price: "100",
        currency: "PLN",
        fxRate: "4",
      }),
    );
    await add({
      ...input({ type: "DEPOSIT", date: "2026-01-02", amount: "300", currency: "EUR" }),
      accountId: ikeId,
    });

    const result = await getPortfolioValuation(db, ania, portfolioId, now);

    expect(result?.holdings.map((holding) => holding.instrument.symbol).sort()).toEqual([
      "AAPL",
      "CDR",
    ]);
    expect(
      result?.cash.map((balance) => [
        balance.accountName,
        balance.currency,
        balance.balance.toFixed(),
      ]),
    ).toEqual([
      ["XTB", "PLN", "3200"],
      ["IKE", "EUR", "300"],
    ]);
  });
});

describe("isolation between users", () => {
  it("hides transactions and holdings from other users", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));

    await expect(getTransaction(db, jan, id)).resolves.toBeNull();
    await expect(listTransactions(db, jan, portfolioId)).resolves.toBeNull();
    await expect(getPortfolioValuation(db, jan, portfolioId, now)).resolves.toBeNull();
  });

  it("does not let another user add, change or delete transactions", async () => {
    const id = await add(buy("2026-01-10", "10", "100"));

    await expect(addTransaction(db, jan, buy("2026-01-11", "1", "100"), now)).resolves.toEqual({
      ok: false,
      reason: "accountNotFound",
    });
    await expect(updateTransaction(db, jan, id, buy("2026-01-10", "1", "1"), now)).resolves.toEqual(
      { ok: false, reason: "notFound" },
    );
    await expect(deleteTransaction(db, jan, id)).resolves.toEqual({
      ok: false,
      reason: "notFound",
    });

    const stored = await getTransaction(db, ania, id);
    expect(stored?.quantity?.toFixed()).toBe("10");
    await expect(db.transaction.count()).resolves.toBe(1);
  });
});
