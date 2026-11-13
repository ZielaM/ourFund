import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import {
  cashFlow,
  computeLedger,
  LedgerError,
  unrealizedGain,
  type LedgerEntry,
  type Position,
} from "./ledger";

const d = (value: string | number) => new Decimal(value);

let nextId = 1;
const id = () => `tx-${nextId++}`;

type TradeOptions = { fee?: string; currency?: string; fxRate?: string; instrumentId?: string };

function trade(
  type: "BUY" | "SELL",
  date: string,
  quantity: string,
  price: string,
  options: TradeOptions = {},
): LedgerEntry {
  return {
    id: id(),
    type,
    date,
    instrumentId: options.instrumentId ?? "CDR",
    quantity: d(quantity),
    price: d(price),
    fee: d(options.fee ?? "0"),
    currency: options.currency ?? "PLN",
    fxRate: d(options.fxRate ?? "1"),
  };
}

const buy = (date: string, quantity: string, price: string, options?: TradeOptions) =>
  trade("BUY", date, quantity, price, options);
const sell = (date: string, quantity: string, price: string, options?: TradeOptions) =>
  trade("SELL", date, quantity, price, options);

function position(entries: LedgerEntry[], instrumentId = "CDR"): Position {
  const found = computeLedger(entries).positions.find((p) => p.instrumentId === instrumentId);
  if (!found) throw new Error(`no position for ${instrumentId}`);
  return found;
}

const fixed = (value: Decimal | null | undefined) => value?.toFixed() ?? null;

describe("computeLedger: buying", () => {
  it("returns nothing for an empty history", () => {
    expect(computeLedger([])).toEqual({ positions: [], cash: {} });
  });

  it("opens a position with the purchase as its only lot", () => {
    const result = position([buy("2026-01-10", "10", "100")]);

    expect(fixed(result.quantity)).toBe("10");
    expect(fixed(result.costBasis)).toBe("1000");
    expect(fixed(result.averageCost)).toBe("100");
    expect(fixed(result.realizedGain)).toBe("0");
    expect(result.lots).toHaveLength(1);
  });

  it("includes the commission in the cost", () => {
    const result = position([buy("2026-01-10", "10", "100", { fee: "5" })]);

    expect(fixed(result.costBasis)).toBe("1005");
    expect(fixed(result.averageCost)).toBe("100.5");
  });

  it("averages the cost over several purchases", () => {
    const result = position([buy("2026-01-10", "10", "100"), buy("2026-02-10", "30", "200")]);

    expect(fixed(result.quantity)).toBe("40");
    expect(fixed(result.costBasis)).toBe("7000");
    expect(fixed(result.averageCost)).toBe("175");
    expect(result.lots.map((lot) => fixed(lot.quantity))).toEqual(["10", "30"]);
  });

  it("handles fractional units exactly", () => {
    const result = position([buy("2026-01-10", "0.1", "3"), buy("2026-01-11", "0.2", "3")]);

    expect(fixed(result.quantity)).toBe("0.3");
    expect(fixed(result.costBasis)).toBe("0.9");
  });

  it("accepts units received for free", () => {
    const result = position([buy("2026-01-10", "5", "0")]);

    expect(fixed(result.costBasis)).toBe("0");
    expect(fixed(result.averageCost)).toBe("0");
  });

  it("keeps instruments separate", () => {
    const ledger = computeLedger([
      buy("2026-01-10", "10", "100", { instrumentId: "CDR" }),
      buy("2026-01-10", "2", "50", { instrumentId: "PKN" }),
    ]);

    expect(ledger.positions.map((p) => [p.instrumentId, fixed(p.quantity)])).toEqual([
      ["CDR", "10"],
      ["PKN", "2"],
    ]);
  });
});

describe("computeLedger: selling (FIFO)", () => {
  it("sells the oldest units first", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      buy("2026-02-10", "10", "200"),
      sell("2026-03-10", "10", "300"),
    ]);

    // Sold the lot bought at 100: gain 10 × (300 − 100).
    expect(fixed(result.realizedGain)).toBe("2000");
    expect(fixed(result.quantity)).toBe("10");
    expect(fixed(result.costBasis)).toBe("2000");
    expect(fixed(result.averageCost)).toBe("200");
  });

  it("splits a sale across lots", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      buy("2026-02-10", "10", "200"),
      sell("2026-03-10", "15", "300"),
    ]);

    // 10 × (300 − 100) + 5 × (300 − 200)
    expect(fixed(result.realizedGain)).toBe("2500");
    expect(result.lots).toHaveLength(1);
    expect(fixed(result.lots[0].quantity)).toBe("5");
    expect(fixed(result.costBasis)).toBe("1000");
  });

  it("leaves part of a lot when the sale is smaller", () => {
    const result = position([buy("2026-01-10", "10", "100"), sell("2026-03-10", "4", "150")]);

    expect(fixed(result.realizedGain)).toBe("200");
    expect(fixed(result.quantity)).toBe("6");
    expect(fixed(result.costBasis)).toBe("600");
  });

  it("subtracts both commissions from the result", () => {
    const result = position([
      buy("2026-01-10", "10", "100", { fee: "5" }),
      sell("2026-03-10", "10", "150", { fee: "7" }),
    ]);

    // 1500 − 7 − (1000 + 5)
    expect(fixed(result.realizedGain)).toBe("488");
  });

  it("records a loss as a negative result", () => {
    const result = position([buy("2026-01-10", "10", "100"), sell("2026-03-10", "10", "80")]);

    expect(fixed(result.realizedGain)).toBe("-200");
  });

  it("keeps a closed position with its result", () => {
    const result = position([buy("2026-01-10", "10", "100"), sell("2026-03-10", "10", "150")]);

    expect(fixed(result.quantity)).toBe("0");
    expect(fixed(result.costBasis)).toBe("0");
    expect(result.averageCost).toBeNull();
    expect(result.lots).toEqual([]);
    expect(fixed(result.realizedGain)).toBe("500");
  });

  it("starts with fresh lots after a position is closed and reopened", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      sell("2026-02-10", "10", "150"),
      buy("2026-03-10", "5", "200"),
    ]);

    expect(fixed(result.averageCost)).toBe("200");
    expect(fixed(result.realizedGain)).toBe("500");
  });

  it("accumulates the result of several sales", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      sell("2026-02-10", "5", "120"),
      sell("2026-03-10", "5", "90"),
    ]);

    expect(fixed(result.realizedGain)).toBe("50");
  });

  it("refuses to sell more than is held", () => {
    const entries = [buy("2026-01-10", "10", "100"), sell("2026-03-10", "11", "150")];

    expect(() => computeLedger(entries)).toThrowError(LedgerError);
    try {
      computeLedger(entries);
    } catch (error) {
      const ledgerError = error as LedgerError;
      expect(ledgerError.code).toBe("insufficientQuantity");
      expect(ledgerError.details.transactionId).toBe(entries[1].id);
      expect(fixed(ledgerError.details.available)).toBe("10");
      expect(fixed(ledgerError.details.requested)).toBe("11");
    }
  });

  it("refuses to sell an instrument that was never bought", () => {
    expect(() => computeLedger([sell("2026-03-10", "1", "150")])).toThrowError(LedgerError);
  });

  it("refuses a sale dated before the purchase", () => {
    const entries = [buy("2026-03-10", "10", "100"), sell("2026-01-10", "10", "150")];

    expect(() => computeLedger(entries)).toThrowError(LedgerError);
  });
});

describe("computeLedger: ordering", () => {
  it("processes entries by date regardless of the order they are given in", () => {
    const result = position([
      sell("2026-03-10", "10", "300"),
      buy("2026-02-10", "10", "200"),
      buy("2026-01-10", "10", "100"),
    ]);

    expect(fixed(result.realizedGain)).toBe("2000");
  });

  it("keeps the given order for entries on the same day", () => {
    const sameDay = "2026-01-10";

    expect(
      fixed(position([buy(sameDay, "10", "100"), sell(sameDay, "10", "110")]).realizedGain),
    ).toBe("100");
    expect(() =>
      computeLedger([sell(sameDay, "10", "110"), buy(sameDay, "10", "100")]),
    ).toThrowError(LedgerError);
  });

  it("does not modify the entries it was given", () => {
    const entries = [buy("2026-01-10", "10", "100"), sell("2026-02-10", "4", "150")];
    const before = JSON.stringify(entries);

    computeLedger(entries);

    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe("computeLedger: splits", () => {
  const split = (date: string, ratio: string): LedgerEntry => ({
    id: id(),
    type: "SPLIT",
    date,
    instrumentId: "CDR",
    splitRatio: d(ratio),
  });

  it("multiplies the units and keeps the total cost", () => {
    const result = position([buy("2026-01-10", "10", "100"), split("2026-02-01", "4")]);

    expect(fixed(result.quantity)).toBe("40");
    expect(fixed(result.costBasis)).toBe("1000");
    expect(fixed(result.averageCost)).toBe("25");
  });

  it("handles a reverse split", () => {
    const result = position([buy("2026-01-10", "100", "2"), split("2026-02-01", "0.1")]);

    expect(fixed(result.quantity)).toBe("10");
    expect(fixed(result.averageCost)).toBe("20");
  });

  it("applies only to units held on the split date", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      split("2026-02-01", "2"),
      buy("2026-03-10", "10", "60"),
    ]);

    expect(fixed(result.quantity)).toBe("30");
    expect(result.lots.map((lot) => fixed(lot.unitCost))).toEqual(["50", "60"]);
  });

  it("uses the adjusted cost for later sales", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      split("2026-02-01", "2"),
      sell("2026-03-10", "20", "70"),
    ]);

    expect(fixed(result.realizedGain)).toBe("400");
  });

  it("keeps the total cost for a split that does not divide evenly", () => {
    const result = position([buy("2026-01-10", "10", "100"), split("2026-02-01", "3")]);

    expect(fixed(result.quantity)).toBe("30");
    expect(result.costBasis.toFixed(10)).toBe("1000.0000000000");
  });

  it("does nothing for an instrument that is not held", () => {
    const ledger = computeLedger([split("2026-02-01", "2")]);

    expect(fixed(ledger.positions[0].quantity)).toBe("0");
  });
});

describe("computeLedger: cash", () => {
  const cashEntry = (
    type: "DEPOSIT" | "WITHDRAWAL" | "FEE",
    amount: string,
    currency = "PLN",
  ): LedgerEntry => ({ id: id(), type, date: "2026-01-05", amount: d(amount), currency });

  it("tracks deposits, withdrawals and standalone fees", () => {
    const { cash } = computeLedger([
      cashEntry("DEPOSIT", "1000"),
      cashEntry("WITHDRAWAL", "300"),
      cashEntry("FEE", "9.99"),
    ]);

    expect(fixed(cash.PLN)).toBe("690.01");
  });

  it("pays for purchases including the commission and receives sale proceeds net of it", () => {
    const { cash } = computeLedger([
      cashEntry("DEPOSIT", "2000"),
      buy("2026-01-10", "10", "100", { fee: "5" }),
      sell("2026-02-10", "10", "150", { fee: "7" }),
    ]);

    // 2000 − 1005 + 1493
    expect(fixed(cash.PLN)).toBe("2488");
  });

  it("keeps a separate balance for each currency", () => {
    const { cash } = computeLedger([
      cashEntry("DEPOSIT", "1000", "PLN"),
      cashEntry("DEPOSIT", "500", "EUR"),
      cashEntry("WITHDRAWAL", "200", "EUR"),
    ]);

    expect(fixed(cash.PLN)).toBe("1000");
    expect(fixed(cash.EUR)).toBe("300");
  });

  it("goes negative when deposits were not recorded", () => {
    const { cash } = computeLedger([buy("2026-01-10", "10", "100")]);

    expect(fixed(cash.PLN)).toBe("-1000");
  });
});

describe("computeLedger: purchases paid in another currency", () => {
  // A USD instrument bought on a PLN account; the broker converted at 4 PLN per USD.
  const options = { instrumentId: "AAPL", currency: "PLN", fxRate: "4", fee: "8" };

  it("moves cash in the settlement currency", () => {
    const { cash } = computeLedger([buy("2026-01-10", "2", "100", options)]);

    // 2 × 100 USD × 4 + 8 PLN
    expect(fixed(cash.PLN)).toBe("-808");
    expect(cash.USD).toBeUndefined();
  });

  it("keeps the cost in the instrument's currency, with the commission converted", () => {
    const result = position([buy("2026-01-10", "2", "100", options)], "AAPL");

    // 200 USD + 8 PLN / 4
    expect(fixed(result.costBasis)).toBe("202");
    expect(result.lots[0]).toMatchObject({ settlementCurrency: "PLN" });
    expect(fixed(result.lots[0].fxRate)).toBe("4");
  });

  it("computes the result of a sale in the instrument's currency", () => {
    const result = position(
      [
        buy("2026-01-10", "2", "100", options),
        sell("2026-02-10", "2", "150", { ...options, fxRate: "5", fee: "10" }),
      ],
      "AAPL",
    );

    // 300 − 10/5 − 202
    expect(fixed(result.realizedGain)).toBe("96");
  });
});

describe("computeLedger: income", () => {
  const income = (
    type: "DIVIDEND" | "INTEREST",
    amount: string,
    tax: string,
    instrumentId: string | null = "CDR",
    currency = "PLN",
  ): LedgerEntry => ({
    id: id(),
    type,
    date: "2026-06-01",
    instrumentId,
    amount: d(amount),
    tax: d(tax),
    currency,
  });

  it("adds a dividend net of withheld tax to cash and to the position", () => {
    const ledger = computeLedger([buy("2026-01-10", "10", "100"), income("DIVIDEND", "50", "9.5")]);

    expect(fixed(ledger.cash.PLN)).toBe("-959.5");
    expect(fixed(ledger.positions[0].income.PLN)).toBe("40.5");
  });

  it("does not change the cost or the quantity", () => {
    const result = position([buy("2026-01-10", "10", "100"), income("DIVIDEND", "50", "9.5")]);

    expect(fixed(result.costBasis)).toBe("1000");
    expect(fixed(result.quantity)).toBe("10");
  });

  it("sums income per currency", () => {
    const result = position([
      buy("2026-01-10", "10", "100"),
      income("DIVIDEND", "50", "0"),
      income("DIVIDEND", "30", "0"),
      income("DIVIDEND", "10", "1.5", "CDR", "USD"),
    ]);

    expect(fixed(result.income.PLN)).toBe("80");
    expect(fixed(result.income.USD)).toBe("8.5");
  });

  it("books interest on idle cash without touching any position", () => {
    const ledger = computeLedger([income("INTEREST", "12", "2.28", null)]);

    expect(fixed(ledger.cash.PLN)).toBe("9.72");
    expect(ledger.positions).toEqual([]);
  });

  it("attributes a bond coupon to its instrument", () => {
    const ledger = computeLedger([income("INTEREST", "12", "2.28", "BOND")]);

    expect(fixed(ledger.positions[0].income.PLN)).toBe("9.72");
  });
});

describe("cashFlow", () => {
  it("is negative for money leaving the account and positive for money coming in", () => {
    const purchase = cashFlow(buy("2026-01-10", "10", "100", { fee: "5" }));
    const sale = cashFlow(sell("2026-01-10", "10", "100", { fee: "5" }));

    expect([purchase?.currency, fixed(purchase?.amount)]).toEqual(["PLN", "-1005"]);
    expect([sale?.currency, fixed(sale?.amount)]).toEqual(["PLN", "995"]);
  });

  it("uses the settlement currency and rate", () => {
    const flow = cashFlow(buy("2026-01-10", "2", "100", { currency: "PLN", fxRate: "4" }));

    expect([flow?.currency, fixed(flow?.amount)]).toEqual(["PLN", "-800"]);
  });

  it("is null for a split, which moves no cash", () => {
    expect(
      cashFlow({
        id: "s",
        type: "SPLIT",
        date: "2026-01-10",
        instrumentId: "CDR",
        splitRatio: d(2),
      }),
    ).toBeNull();
  });
});

describe("unrealizedGain", () => {
  it("is the current value minus the cost of the units held", () => {
    const result = position([buy("2026-01-10", "10", "100", { fee: "5" })]);

    expect(fixed(unrealizedGain(result, d("120")))).toBe("195");
    expect(fixed(unrealizedGain(result, d("90")))).toBe("-105");
  });

  it("is zero for a closed position", () => {
    const result = position([buy("2026-01-10", "10", "100"), sell("2026-02-10", "10", "150")]);

    expect(fixed(unrealizedGain(result, d("999")))).toBe("0");
  });
});
