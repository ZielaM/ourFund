import { describe, expect, it } from "vitest";
import { toLedgerEntry, type StoredTransaction } from "./transactions";

const row = (overrides: Partial<StoredTransaction>): StoredTransaction => ({
  id: "tx-1",
  type: "BUY",
  date: new Date("2026-01-10T00:00:00.000Z"),
  instrumentId: "instrument-1",
  quantity: "10.0000000000",
  price: "123.4500000000",
  currency: "PLN",
  fxRate: "1.00000000",
  amount: null,
  fee: "5.0000000000",
  tax: "0.0000000000",
  splitRatio: null,
  ...overrides,
});

describe("toLedgerEntry", () => {
  it("maps a trade", () => {
    const entry = toLedgerEntry(row({ type: "SELL", currency: "EUR", fxRate: "0.25" }));

    expect(entry).toMatchObject({
      id: "tx-1",
      type: "SELL",
      date: "2026-01-10",
      instrumentId: "instrument-1",
      currency: "EUR",
    });
    if (entry.type !== "SELL") throw new Error("expected a sale");
    expect(entry.quantity.toFixed()).toBe("10");
    expect(entry.price.toFixed()).toBe("123.45");
    expect(entry.fee.toFixed()).toBe("5");
    expect(entry.fxRate.toFixed()).toBe("0.25");
  });

  it("maps income with and without an instrument", () => {
    const dividend = toLedgerEntry(
      row({ type: "DIVIDEND", quantity: null, price: null, amount: "50", tax: "9.5" }),
    );
    const interest = toLedgerEntry(
      row({ type: "INTEREST", instrumentId: null, quantity: null, price: null, amount: "12" }),
    );

    if (dividend.type !== "DIVIDEND" || interest.type !== "INTEREST") {
      throw new Error("expected income entries");
    }
    expect(dividend.amount.toFixed()).toBe("50");
    expect(dividend.tax.toFixed()).toBe("9.5");
    expect(interest.instrumentId).toBeNull();
  });

  it.each(["FEE", "DEPOSIT", "WITHDRAWAL"] as const)("maps a %s", (type) => {
    const entry = toLedgerEntry(
      row({
        type,
        instrumentId: null,
        quantity: null,
        price: null,
        amount: "100",
        currency: "USD",
      }),
    );

    expect(entry).toMatchObject({ type, currency: "USD" });
    if (!("amount" in entry)) throw new Error("expected an amount");
    expect(entry.amount.toFixed()).toBe("100");
  });

  it("maps a split", () => {
    const entry = toLedgerEntry(
      row({ type: "SPLIT", quantity: null, price: null, splitRatio: "4.00000000" }),
    );

    if (entry.type !== "SPLIT") throw new Error("expected a split");
    expect(entry.splitRatio.toFixed()).toBe("4");
  });

  it.each([
    ["a trade without a quantity", row({ quantity: null }), "quantity"],
    ["a trade without a price", row({ price: null }), "price"],
    ["a trade without an instrument", row({ instrumentId: null }), "instrumentId"],
    ["a deposit without an amount", row({ type: "DEPOSIT", amount: null }), "amount"],
    ["a dividend without an amount", row({ type: "DIVIDEND", amount: null }), "amount"],
    ["a split without a ratio", row({ type: "SPLIT", splitRatio: null }), "splitRatio"],
  ])("fails loudly on a corrupt record: %s", (_reason, stored, field) => {
    expect(() => toLedgerEntry(stored)).toThrowError(`Transaction tx-1 is missing "${field}"`);
  });
});
