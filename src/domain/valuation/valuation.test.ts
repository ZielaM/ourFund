import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { computeLedger, type LedgerEntry } from "@/domain/portfolio/ledger";
import {
  allocate,
  combineByInstrument,
  rateToPln,
  sumOrNull,
  valuePortfolio,
  valuePosition,
  type FxOn,
  type PriceOn,
} from "./valuation";

const d = (value: string | number) => new Decimal(value);
const fixed = (value: Decimal | null | undefined) => (value ? value.toFixed() : value);

let nextId = 1;
type TradeOptions = { fee?: string; currency?: string; fxRate?: string; instrumentId?: string };

function trade(
  type: "BUY" | "SELL",
  date: string,
  quantity: string,
  price: string,
  options: TradeOptions = {},
): LedgerEntry {
  return {
    id: `tx-${nextId++}`,
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

const today = "2026-11-13";

/** Exchange rates by "currency date"; anything else is unknown. */
const fxFrom =
  (rates: Record<string, string>): FxOn =>
  (currency, date) => {
    const rate = rates[`${currency} ${date}`];
    return rate ? d(rate) : null;
  };

const priceOf =
  (prices: Record<string, string>): PriceOn =>
  (instrumentId) =>
    prices[instrumentId] ? { date: today, close: d(prices[instrumentId]), fromTrade: false } : null;

const noFx: FxOn = () => null;

function positionOf(entries: LedgerEntry[], instrumentId = "CDR") {
  return computeLedger(entries).positions.find((p) => p.instrumentId === instrumentId)!;
}

describe("rateToPln", () => {
  const settlement = { date: "2026-01-10", settlementCurrency: "USD", fxRate: d(1) };

  it("is 1 for an instrument quoted in PLN", () => {
    expect(fixed(rateToPln(settlement, "PLN", noFx))).toBe("1");
  });

  it("is the broker's rate when the account paid in PLN", () => {
    const paidInPln = { ...settlement, settlementCurrency: "PLN", fxRate: d("4.05") };

    expect(fixed(rateToPln(paidInPln, "USD", noFx))).toBe("4.05");
  });

  it("is the NBP rate of the day otherwise, or null when it is not known", () => {
    const fx = fxFrom({ "USD 2026-01-10": "4" });

    expect(fixed(rateToPln(settlement, "USD", fx))).toBe("4");
    expect(rateToPln({ ...settlement, date: "2026-01-11" }, "USD", fx)).toBeNull();
  });
});

describe("valuePosition: instrument in PLN", () => {
  const position = positionOf([trade("BUY", "2026-01-10", "10", "100", { fee: "5" })]);

  it("values the position at the current price", () => {
    const result = valuePosition(position, "PLN", today, priceOf({ CDR: "120" }), noFx);

    expect(fixed(result.value)).toBe("1200");
    expect(fixed(result.cost)).toBe("1005");
    expect(fixed(result.unrealized)).toBe("195");
    expect(fixed(result.priceEffect)).toBe("195");
    expect(fixed(result.fxEffect)).toBe("0");
    expect(result.price).toMatchObject({ date: today, fromTrade: false });
  });

  it("keeps the cost but leaves the value unknown without a price", () => {
    const result = valuePosition(position, "PLN", today, priceOf({}), noFx);

    expect(result.value).toBeNull();
    expect(result.unrealized).toBeNull();
    expect(result.priceEffect).toBeNull();
    expect(fixed(result.cost)).toBe("1005");
  });
});

describe("valuePosition: instrument in a foreign currency", () => {
  const fx = fxFrom({ "USD 2026-01-10": "4", [`USD ${today}`]: "4.2", "USD 2026-06-01": "4.5" });
  const usd = { instrumentId: "AAPL", currency: "USD" };

  it("splits the result into the price effect and the currency effect", () => {
    const position = positionOf([trade("BUY", "2026-01-10", "2", "100", usd)], "AAPL");

    const result = valuePosition(position, "USD", today, priceOf({ AAPL: "110" }), fx);

    // Bought for 2 × 100 USD at 4.00; now 2 × 110 USD at 4.20.
    expect(fixed(result.cost)).toBe("800");
    expect(fixed(result.value)).toBe("924");
    expect(fixed(result.unrealized)).toBe("124");
    // 2 × (110 − 100) × 4.20
    expect(fixed(result.priceEffect)).toBe("84");
    // 2 × 100 × (4.20 − 4.00)
    expect(fixed(result.fxEffect)).toBe("40");
  });

  it("shows a currency loss on an unchanged price", () => {
    const position = positionOf([trade("BUY", "2026-06-01", "2", "100", usd)], "AAPL");

    const result = valuePosition(position, "USD", today, priceOf({ AAPL: "100" }), fx);

    expect(fixed(result.priceEffect)).toBe("0");
    expect(fixed(result.fxEffect)).toBe("-60");
    expect(fixed(result.unrealized)).toBe("-60");
  });

  it("uses the broker's rate and commission as the exact PLN cost when paid in PLN", () => {
    const position = positionOf(
      [
        trade("BUY", "2026-01-10", "2", "100", {
          instrumentId: "AAPL",
          currency: "PLN",
          fxRate: "4.05",
          fee: "8",
        }),
      ],
      "AAPL",
    );

    const result = valuePosition(position, "USD", today, priceOf({ AAPL: "100" }), fx);

    // 2 × 100 × 4.05 + 8
    expect(result.cost?.toFixed(10)).toBe("818.0000000000");
  });

  it("leaves PLN values unknown while exchange rates are missing", () => {
    const position = positionOf([trade("BUY", "2026-01-10", "2", "100", usd)], "AAPL");

    const result = valuePosition(position, "USD", today, priceOf({ AAPL: "110" }), noFx);

    expect(result.value).toBeNull();
    expect(result.cost).toBeNull();
    expect(result.unrealized).toBeNull();
    expect(result.fxEffect).toBeNull();
  });

  it("converts the result of a sale at the rates of the purchase and of the sale", () => {
    const position = positionOf(
      [trade("BUY", "2026-01-10", "2", "100", usd), trade("SELL", "2026-06-01", "2", "150", usd)],
      "AAPL",
    );

    const result = valuePosition(position, "USD", today, priceOf({}), fx);

    // 2 × (150 × 4.50 − 100 × 4.00)
    expect(fixed(result.realized)).toBe("550");
  });

  it("converts income at the rate of the day it was received", () => {
    const dividend: LedgerEntry = {
      id: "div",
      type: "DIVIDEND",
      date: "2026-06-01",
      instrumentId: "AAPL",
      amount: d("10"),
      tax: d("1.5"),
      currency: "USD",
    };
    const position = positionOf([trade("BUY", "2026-01-10", "2", "100", usd), dividend], "AAPL");

    const result = valuePosition(position, "USD", today, priceOf({ AAPL: "100" }), fx);

    // (10 − 1.5) × 4.50
    expect(fixed(result.income)).toBe("38.25");
  });
});

describe("valuePosition: closed position", () => {
  it("has no value or cost, only its realized result, and needs no price", () => {
    const position = positionOf([
      trade("BUY", "2026-01-10", "10", "100"),
      trade("SELL", "2026-03-10", "10", "150"),
    ]);

    const result = valuePosition(position, "PLN", today, priceOf({}), noFx);

    expect(fixed(result.value)).toBe("0");
    expect(fixed(result.cost)).toBe("0");
    expect(fixed(result.unrealized)).toBe("0");
    expect(fixed(result.realized)).toBe("500");
    expect(result.price).toBeNull();
  });
});

describe("valuePortfolio", () => {
  const fx = fxFrom({ "USD 2026-01-10": "4", [`USD ${today}`]: "4.2", [`EUR ${today}`]: "4.3" });
  const currencyOf = (instrumentId: string) => (instrumentId === "AAPL" ? "USD" : "PLN");
  const deposit = (amount: string, currency: string): LedgerEntry => ({
    id: `tx-${nextId++}`,
    type: "DEPOSIT",
    date: "2026-01-02",
    amount: d(amount),
    currency,
  });

  const ledgers = [
    {
      accountId: "xtb",
      ledger: computeLedger([
        deposit("5000", "PLN"),
        trade("BUY", "2026-01-10", "10", "100"),
        trade("BUY", "2026-01-10", "2", "100", { instrumentId: "AAPL", currency: "USD" }),
        deposit("300", "USD"),
      ]),
    },
    {
      accountId: "ike",
      ledger: computeLedger([deposit("100", "EUR"), trade("BUY", "2026-02-10", "5", "200")]),
    },
  ];

  it("values positions per account and cash per currency", () => {
    const result = valuePortfolio(
      ledgers,
      currencyOf,
      today,
      priceOf({ CDR: "120", AAPL: "110" }),
      fx,
    );

    expect(result.positions.map((p) => [p.accountId, p.instrumentId, fixed(p.value)])).toEqual([
      ["xtb", "CDR", "1200"],
      ["xtb", "AAPL", "924"],
      ["ike", "CDR", "600"],
    ]);
    expect(result.cash.map((c) => [c.accountId, c.currency, fixed(c.value)])).toEqual([
      ["xtb", "PLN", "4000"],
      ["xtb", "USD", "420"],
      ["ike", "EUR", "430"],
      ["ike", "PLN", "-1000"],
    ]);
  });

  it("adds everything up", () => {
    const { totals } = valuePortfolio(
      ledgers,
      currencyOf,
      today,
      priceOf({ CDR: "120", AAPL: "110" }),
      fx,
    );

    expect(fixed(totals.holdingsValue)).toBe("2724");
    expect(fixed(totals.cashValue)).toBe("3850");
    expect(fixed(totals.value)).toBe("6574");
    expect(fixed(totals.cost)).toBe("2800");
    expect(fixed(totals.unrealized)).toBe("-76");
    expect(fixed(totals.priceEffect)).toBe("-116");
    expect(fixed(totals.fxEffect)).toBe("40");
    expect(fixed(totals.gain)).toBe("-76");
    expect(totals.incomplete).toBe(false);
  });

  it("flags totals as incomplete when something could not be valued, and leaves it out", () => {
    const { totals } = valuePortfolio(ledgers, currencyOf, today, priceOf({ CDR: "120" }), fx);

    expect(totals.incomplete).toBe(true);
    expect(fixed(totals.holdingsValue)).toBe("1800");
  });

  it("is zero and complete for an empty portfolio", () => {
    const { totals, positions, cash } = valuePortfolio([], currencyOf, today, priceOf({}), noFx);

    expect(positions).toEqual([]);
    expect(cash).toEqual([]);
    expect(fixed(totals.value)).toBe("0");
    expect(totals.incomplete).toBe(false);
  });
});

describe("combineByInstrument", () => {
  const base = {
    instrumentId: "CDR",
    quantity: d(10),
    price: { date: today, close: d(120), fromTrade: false },
    value: d(1200),
    cost: d(1000),
    unrealized: d(200),
    priceEffect: d(200),
    fxEffect: d(0),
    realized: d(50),
    income: d(5),
  };

  it("adds up the same instrument held on several accounts", () => {
    const [combined] = combineByInstrument([base, { ...base, quantity: d(5), value: d(600) }]);

    expect(fixed(combined.quantity)).toBe("15");
    expect(fixed(combined.value)).toBe("1800");
    expect(fixed(combined.cost)).toBe("2000");
    expect(fixed(combined.realized)).toBe("100");
    expect(combined.price).toEqual(base.price);
  });

  it("is unknown as a whole when one part is unknown", () => {
    const [combined] = combineByInstrument([base, { ...base, value: null, unrealized: null }]);

    expect(combined.value).toBeNull();
    expect(combined.unrealized).toBeNull();
    expect(fixed(combined.cost)).toBe("2000");
  });

  it("keeps different instruments apart", () => {
    const combined = combineByInstrument([base, { ...base, instrumentId: "PKN" }]);

    expect(combined.map((position) => position.instrumentId)).toEqual(["CDR", "PKN"]);
  });
});

describe("sumOrNull", () => {
  it("adds values and is null if any is missing", () => {
    expect(fixed(sumOrNull([d(1), d(2)]))).toBe("3");
    expect(fixed(sumOrNull([]))).toBe("0");
    expect(sumOrNull([d(1), null])).toBeNull();
  });
});

describe("allocate", () => {
  it("groups by key and returns shares of the total, largest first", () => {
    const slices = allocate([
      { key: "PLN", value: d(600) },
      { key: "USD", value: d(300) },
      { key: "PLN", value: d(100) },
    ]);

    expect(slices.map((slice) => [slice.key, fixed(slice.value), slice.share])).toEqual([
      ["PLN", "700", 0.7],
      ["USD", "300", 0.3],
    ]);
  });

  it("leaves out zero and negative values, such as an overdrawn cash balance", () => {
    const slices = allocate([
      { key: "STOCK", value: d(500) },
      { key: "CASH", value: d(-200) },
      { key: "BOND", value: d(0) },
    ]);

    expect(slices).toHaveLength(1);
    expect(slices[0].share).toBe(1);
  });

  it("returns nothing when there is nothing to allocate", () => {
    expect(allocate([])).toEqual([]);
  });
});
