import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { aggregateHoldings, listCashBalances } from "./holdings";
import { computeLedger, type LedgerEntry } from "./ledger";

const d = (value: string) => new Decimal(value);
let nextId = 1;

function trade(
  type: "BUY" | "SELL",
  instrumentId: string,
  date: string,
  quantity: string,
  price: string,
): LedgerEntry {
  return {
    id: `tx-${nextId++}`,
    type,
    date,
    instrumentId,
    quantity: d(quantity),
    price: d(price),
    fee: d("0"),
    currency: "PLN",
    fxRate: d("1"),
  };
}

function dividend(instrumentId: string, amount: string, currency = "PLN"): LedgerEntry {
  return {
    id: `tx-${nextId++}`,
    type: "DIVIDEND",
    date: "2026-06-01",
    instrumentId,
    amount: d(amount),
    tax: d("0"),
    currency,
  };
}

const account = (accountId: string, entries: LedgerEntry[]) => ({
  accountId,
  ledger: computeLedger(entries),
});

describe("aggregateHoldings", () => {
  it("returns nothing for a portfolio without transactions", () => {
    expect(aggregateHoldings([])).toEqual([]);
    expect(aggregateHoldings([account("ike", [])])).toEqual([]);
  });

  it("adds up the same instrument held on several accounts", () => {
    const [holding] = aggregateHoldings([
      account("standard", [trade("BUY", "CDR", "2026-01-10", "10", "100")]),
      account("ike", [trade("BUY", "CDR", "2026-02-10", "30", "200")]),
    ]);

    expect(holding.quantity.toFixed()).toBe("40");
    expect(holding.costBasis.toFixed()).toBe("7000");
    expect(holding.averageCost?.toFixed()).toBe("175");
    expect(holding.accounts.map((a) => [a.accountId, a.quantity.toFixed()])).toEqual([
      ["standard", "10"],
      ["ike", "30"],
    ]);
  });

  it("keeps FIFO per account: a sale on one account does not touch the other's lots", () => {
    const [holding] = aggregateHoldings([
      account("standard", [trade("BUY", "CDR", "2026-01-10", "10", "100")]),
      account("ike", [
        trade("BUY", "CDR", "2026-02-10", "10", "200"),
        trade("SELL", "CDR", "2026-03-10", "10", "250"),
      ]),
    ]);

    // The IKE lot bought at 200 was sold, not the older lot on the standard account.
    expect(holding.realizedGain.toFixed()).toBe("500");
    expect(holding.costBasis.toFixed()).toBe("1000");
    expect(holding.accounts.map((a) => a.accountId)).toEqual(["standard"]);
  });

  it("sums results and income across accounts", () => {
    const [holding] = aggregateHoldings([
      account("a", [
        trade("BUY", "CDR", "2026-01-10", "10", "100"),
        trade("SELL", "CDR", "2026-03-10", "5", "120"),
        dividend("CDR", "20"),
      ]),
      account("b", [
        trade("BUY", "CDR", "2026-01-10", "10", "100"),
        trade("SELL", "CDR", "2026-03-10", "5", "90"),
        dividend("CDR", "30"),
        dividend("CDR", "4", "USD"),
      ]),
    ]);

    expect(holding.realizedGain.toFixed()).toBe("50");
    expect(holding.income.PLN.toFixed()).toBe("50");
    expect(holding.income.USD.toFixed()).toBe("4");
  });

  it("keeps closed positions, without an average cost or accounts", () => {
    const [holding] = aggregateHoldings([
      account("a", [
        trade("BUY", "CDR", "2026-01-10", "10", "100"),
        trade("SELL", "CDR", "2026-03-10", "10", "150"),
      ]),
    ]);

    expect(holding.quantity.toFixed()).toBe("0");
    expect(holding.averageCost).toBeNull();
    expect(holding.accounts).toEqual([]);
    expect(holding.realizedGain.toFixed()).toBe("500");
  });

  it("lists each instrument once", () => {
    const holdings = aggregateHoldings([
      account("a", [
        trade("BUY", "CDR", "2026-01-10", "1", "100"),
        trade("BUY", "PKN", "2026-01-10", "2", "50"),
      ]),
      account("b", [trade("BUY", "PKN", "2026-01-10", "3", "60")]),
    ]);

    expect(holdings.map((h) => [h.instrumentId, h.quantity.toFixed()])).toEqual([
      ["CDR", "1"],
      ["PKN", "5"],
    ]);
  });
});

describe("listCashBalances", () => {
  const deposit = (amount: string, currency: string): LedgerEntry => ({
    id: `tx-${nextId++}`,
    type: "DEPOSIT",
    date: "2026-01-01",
    amount: d(amount),
    currency,
  });
  const withdrawal = (amount: string, currency: string): LedgerEntry => ({
    id: `tx-${nextId++}`,
    type: "WITHDRAWAL",
    date: "2026-01-02",
    amount: d(amount),
    currency,
  });

  it("lists a balance per account and currency", () => {
    const balances = listCashBalances([
      account("a", [deposit("1000", "PLN"), deposit("200", "EUR")]),
      account("b", [deposit("50", "PLN")]),
    ]);

    expect(balances.map((b) => [b.accountId, b.currency, b.balance.toFixed()])).toEqual([
      ["a", "PLN", "1000"],
      ["a", "EUR", "200"],
      ["b", "PLN", "50"],
    ]);
  });

  it("leaves out balances that are exactly zero", () => {
    expect(
      listCashBalances([account("a", [deposit("100", "PLN"), withdrawal("100", "PLN")])]),
    ).toEqual([]);
  });

  it("keeps negative balances", () => {
    const [balance] = listCashBalances([account("a", [withdrawal("100", "PLN")])]);

    expect(balance.balance.toFixed()).toBe("-100");
  });
});
