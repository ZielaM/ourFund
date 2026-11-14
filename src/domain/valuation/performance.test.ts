import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { LedgerEntry } from "@/domain/portfolio/ledger";
import {
  buildCostTimeline,
  buildQuantityTimeline,
  contributions,
  createPriceLookup,
  dailyDates,
  timeWeightedReturns,
  valueSeries,
  xirr,
} from "./performance";
import type { FxOn } from "./valuation";

const d = (value: string | number) => new Decimal(value);
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

const split = (date: string, ratio: string): LedgerEntry => ({
  id: `tx-${nextId++}`,
  type: "SPLIT",
  date,
  instrumentId: "CDR",
  splitRatio: d(ratio),
});

const noFx: FxOn = () => null;
const usdAt =
  (rate: string): FxOn =>
  (currency) =>
    currency === "USD" ? d(rate) : null;

const quantities = (snapshot: { quantities: Map<string, Decimal> }) =>
  Object.fromEntries([...snapshot.quantities].map(([id, quantity]) => [id, quantity.toFixed()]));

describe("dailyDates", () => {
  it("lists every day of the range, both ends included", () => {
    expect(dailyDates("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("is not thrown off by the change to summer time", () => {
    expect(dailyDates("2026-03-28", "2026-03-30")).toHaveLength(3);
  });

  it("is empty when the range is", () => {
    expect(dailyDates("2026-03-02", "2026-03-01")).toEqual([]);
  });
});

describe("buildQuantityTimeline", () => {
  it("records the holdings after each day with a change", () => {
    const timeline = buildQuantityTimeline([
      [
        trade("BUY", "2026-01-10", "10", "100"),
        trade("BUY", "2026-01-10", "5", "100"),
        trade("SELL", "2026-02-10", "4", "120"),
      ],
    ]);

    expect(timeline.map((snapshot) => [snapshot.date, quantities(snapshot)])).toEqual([
      ["2026-01-10", { CDR: "15" }],
      ["2026-02-10", { CDR: "11" }],
    ]);
  });

  it("adds up the same instrument across accounts", () => {
    const timeline = buildQuantityTimeline([
      [trade("BUY", "2026-01-10", "10", "100")],
      [trade("BUY", "2026-01-20", "3", "100")],
    ]);

    expect(quantities(timeline.at(-1)!)).toEqual({ CDR: "13" });
  });

  it("applies a split only to the account it was recorded on", () => {
    const timeline = buildQuantityTimeline([
      [trade("BUY", "2026-01-10", "10", "100"), split("2026-02-01", "2")],
      [trade("BUY", "2026-01-10", "3", "100")],
    ]);

    expect(quantities(timeline.at(-1)!)).toEqual({ CDR: "23" });
  });

  it("drops an instrument once it is sold out", () => {
    const timeline = buildQuantityTimeline([
      [
        trade("BUY", "2026-01-10", "10", "100"),
        trade("BUY", "2026-01-10", "1", "50", { instrumentId: "PKN" }),
        trade("SELL", "2026-02-10", "10", "120"),
      ],
    ]);

    expect(quantities(timeline.at(-1)!)).toEqual({ PKN: "1" });
  });

  it("ignores entries that do not change holdings, but not their dates", () => {
    const deposit: LedgerEntry = {
      id: "dep",
      type: "DEPOSIT",
      date: "2026-01-02",
      amount: d(1000),
      currency: "PLN",
    };

    const timeline = buildQuantityTimeline([[deposit, trade("BUY", "2026-01-10", "10", "100")]]);

    expect(timeline.map((snapshot) => [snapshot.date, quantities(snapshot)])).toEqual([
      ["2026-01-02", {}],
      ["2026-01-10", { CDR: "10" }],
    ]);
  });

  it("is empty without entries", () => {
    expect(buildQuantityTimeline([])).toEqual([]);
  });
});

describe("buildCostTimeline", () => {
  const plnOnly = () => "PLN";
  const costs = (snapshots: { date: string; cost: Decimal | null }[]) =>
    snapshots.map((snapshot) => [snapshot.date, snapshot.cost?.toFixed() ?? null]);

  it("records the cost of what is held after each trading day", () => {
    const timeline = buildCostTimeline(
      [
        [
          trade("BUY", "2026-01-10", "10", "100", { fee: "5" }),
          trade("BUY", "2026-02-10", "10", "200"),
          trade("SELL", "2026-03-10", "15", "300"),
        ],
      ],
      plnOnly,
      noFx,
    );

    // The sale removes the whole first lot (1005) and half of the second (1000).
    expect(costs(timeline)).toEqual([
      ["2026-01-10", "1005"],
      ["2026-02-10", "3005"],
      ["2026-03-10", "1000"],
    ]);
  });

  it("never goes below zero, even after everything is sold at a profit", () => {
    const timeline = buildCostTimeline(
      [[trade("BUY", "2026-01-10", "10", "100"), trade("SELL", "2026-03-10", "10", "500")]],
      plnOnly,
      noFx,
    );

    expect(costs(timeline).at(-1)).toEqual(["2026-03-10", "0"]);
  });

  it("adds up the accounts, each with its own FIFO", () => {
    const timeline = buildCostTimeline(
      [
        [trade("BUY", "2026-01-10", "10", "100")],
        [trade("BUY", "2026-01-20", "10", "200"), trade("SELL", "2026-02-10", "10", "250")],
      ],
      plnOnly,
      noFx,
    );

    expect(costs(timeline)).toEqual([
      ["2026-01-10", "1000"],
      ["2026-01-20", "3000"],
      ["2026-02-10", "1000"],
    ]);
  });

  it("is not changed by a split", () => {
    const timeline = buildCostTimeline(
      [[trade("BUY", "2026-01-10", "10", "100"), split("2026-02-01", "3")]],
      plnOnly,
      noFx,
    );

    expect(timeline.at(-1)?.cost?.toFixed(6)).toBe("1000.000000");
  });

  it("converts foreign purchases at the rate of the purchase", () => {
    const entries = [
      trade("BUY", "2026-01-10", "2", "100", { instrumentId: "AAPL", currency: "USD" }),
    ];

    expect(costs(buildCostTimeline([entries], () => "USD", usdAt("4")))).toEqual([
      ["2026-01-10", "800"],
    ]);
    expect(costs(buildCostTimeline([entries], () => "USD", noFx))).toEqual([["2026-01-10", null]]);
  });

  it("ignores days with only cash movements or income", () => {
    const deposit: LedgerEntry = {
      id: "dep",
      type: "DEPOSIT",
      date: "2026-01-02",
      amount: d(1000),
      currency: "PLN",
    };

    expect(buildCostTimeline([[deposit]], plnOnly, noFx)).toEqual([]);
  });
});

describe("createPriceLookup", () => {
  const entries = [
    trade("BUY", "2026-01-10", "10", "100"),
    trade("SELL", "2026-03-10", "5", "130"),
  ];
  const market = new Map([["CDR", [{ date: "2026-02-02", close: d(110) }]]]);

  it("prefers the market price, carried forward", () => {
    const priceOn = createPriceLookup(market, entries);

    expect(priceOn("CDR", "2026-02-10")).toEqual({
      date: "2026-02-02",
      close: d(110),
      fromTrade: false,
    });
    expect(priceOn("CDR", "2026-03-20")?.close.toFixed()).toBe("110");
  });

  it("falls back to the price of the most recent trade before any market price", () => {
    const priceOn = createPriceLookup(market, entries);

    expect(priceOn("CDR", "2026-01-15")).toEqual({
      date: "2026-01-10",
      close: d(100),
      fromTrade: true,
    });
  });

  it("uses trade prices alone for an instrument without quotes", () => {
    const priceOn = createPriceLookup(new Map(), entries);

    expect(priceOn("CDR", "2026-02-01")?.close.toFixed()).toBe("100");
    expect(priceOn("CDR", "2026-04-01")).toMatchObject({ date: "2026-03-10", fromTrade: true });
  });

  it("knows nothing before the first trade or about other instruments", () => {
    const priceOn = createPriceLookup(market, entries);

    expect(priceOn("CDR", "2026-01-09")).toBeNull();
    expect(priceOn("PKN", "2026-02-10")).toBeNull();
  });
});

describe("valueSeries", () => {
  const entries = [
    trade("BUY", "2026-01-12", "10", "100"),
    trade("BUY", "2026-01-14", "2", "50", { instrumentId: "AAPL", currency: "USD" }),
  ];
  const timeline = buildQuantityTimeline([entries]);
  const priceOn = createPriceLookup(
    new Map([
      [
        "CDR",
        [
          { date: "2026-01-12", close: d(100) },
          { date: "2026-01-13", close: d(110) },
        ],
      ],
      ["AAPL", [{ date: "2026-01-14", close: d(50) }]],
    ]),
    entries,
  );
  const currencyOf = (id: string) => (id === "AAPL" ? "USD" : "PLN");
  const days = dailyDates("2026-01-11", "2026-01-15");

  it("values what was held at the end of each day", () => {
    const series = valueSeries(timeline, days, currencyOf, priceOn, usdAt("4"));

    expect(series).toEqual([
      { date: "2026-01-11", value: 0 },
      { date: "2026-01-12", value: 1000 },
      { date: "2026-01-13", value: 1100 },
      { date: "2026-01-14", value: 1500 },
      { date: "2026-01-15", value: 1500 },
    ]);
  });

  it("has no value on days when an exchange rate is missing", () => {
    const series = valueSeries(timeline, days, currencyOf, priceOn, noFx);

    expect(series.map((point) => point.value)).toEqual([0, 1000, 1100, null, null]);
  });
});

describe("contributions", () => {
  it("counts purchases as money in and sales and dividends as money out", () => {
    const dividend: LedgerEntry = {
      id: "div",
      type: "DIVIDEND",
      date: "2026-06-01",
      instrumentId: "CDR",
      amount: d(50),
      tax: d("9.5"),
      currency: "PLN",
    };

    const { byDate, incomplete } = contributions(
      [
        trade("BUY", "2026-01-10", "10", "100", { fee: "5" }),
        trade("SELL", "2026-03-10", "4", "150", { fee: "6" }),
        dividend,
      ],
      noFx,
    );

    expect(Object.fromEntries(byDate)).toEqual({
      "2026-01-10": 1005,
      "2026-03-10": -594,
      "2026-06-01": -40.5,
    });
    expect(incomplete).toBe(false);
  });

  it("adds up several flows on one day", () => {
    const { byDate } = contributions(
      [trade("BUY", "2026-01-10", "10", "100"), trade("BUY", "2026-01-10", "5", "100")],
      noFx,
    );

    expect(byDate.get("2026-01-10")).toBe(1500);
  });

  it("converts flows in a foreign currency at the rate of the day", () => {
    const { byDate } = contributions(
      [trade("BUY", "2026-01-10", "2", "100", { instrumentId: "AAPL", currency: "USD" })],
      usdAt("4"),
    );

    expect(byDate.get("2026-01-10")).toBe(800);
  });

  it("uses the settlement amount as it is when the account paid in PLN", () => {
    const { byDate } = contributions(
      [
        trade("BUY", "2026-01-10", "2", "100", {
          instrumentId: "AAPL",
          currency: "PLN",
          fxRate: "4.05",
          fee: "8",
        }),
      ],
      noFx,
    );

    expect(byDate.get("2026-01-10")).toBe(818);
  });

  it("ignores cash-only movements and interest on idle cash", () => {
    const cash = (type: "DEPOSIT" | "WITHDRAWAL" | "FEE"): LedgerEntry => ({
      id: type,
      type,
      date: "2026-01-02",
      amount: d(100),
      currency: "PLN",
    });
    const interest: LedgerEntry = {
      id: "int",
      type: "INTEREST",
      date: "2026-01-03",
      instrumentId: null,
      amount: d(5),
      tax: d(0),
      currency: "PLN",
    };

    const { byDate } = contributions(
      [cash("DEPOSIT"), cash("WITHDRAWAL"), cash("FEE"), interest, split("2026-01-04", "2")],
      noFx,
    );

    expect(byDate.size).toBe(0);
  });

  it("reports flows it could not convert", () => {
    const { byDate, incomplete } = contributions(
      [trade("BUY", "2026-01-10", "2", "100", { instrumentId: "AAPL", currency: "USD" })],
      noFx,
    );

    expect(byDate.size).toBe(0);
    expect(incomplete).toBe(true);
  });
});

describe("timeWeightedReturns", () => {
  const point = (date: string, value: number | null) => ({ date, value });
  const last = (points: { twr: number }[]) => points.at(-1)!.twr;

  it("is zero on the day of a purchase at the closing price", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000)],
      new Map([["2026-01-12", 1000]]),
    );

    expect(returns).toEqual([{ date: "2026-01-12", twr: 0 }]);
  });

  it("follows the change in value", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000), point("2026-01-13", 1100), point("2026-01-14", 990)],
      new Map([["2026-01-12", 1000]]),
    );

    expect(returns.map((r) => Number(r.twr.toFixed(6)))).toEqual([0, 0.1, -0.01]);
  });

  it("is not changed by adding money", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000), point("2026-01-13", 1100), point("2026-01-14", 2200)],
      new Map([
        ["2026-01-12", 1000],
        ["2026-01-14", 1100],
      ]),
    );

    expect(last(returns)).toBeCloseTo(0.1, 10);
  });

  it("is not changed by withdrawing money", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000), point("2026-01-13", 1100), point("2026-01-14", 550)],
      new Map([
        ["2026-01-12", 1000],
        ["2026-01-14", -550],
      ]),
    );

    expect(last(returns)).toBeCloseTo(0.1, 10);
  });

  it("counts a dividend as return", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000), point("2026-01-13", 1000)],
      new Map([
        ["2026-01-12", 1000],
        ["2026-01-13", -50],
      ]),
    );

    expect(last(returns)).toBeCloseTo(0.05, 10);
  });

  it("shows the commission as a loss on the first day", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000)],
      new Map([["2026-01-12", 1005]]),
    );

    expect(last(returns)).toBeCloseTo(1000 / 1005 - 1, 10);
  });

  it("compounds over periods", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000), point("2026-01-13", 1100), point("2026-01-14", 1210)],
      new Map([["2026-01-12", 1000]]),
    );

    expect(last(returns)).toBeCloseTo(0.21, 10);
  });

  it("keeps the return earned so far while nothing is held, and continues after re-entry", () => {
    const returns = timeWeightedReturns(
      [
        point("2026-01-12", 1000),
        point("2026-01-13", 0),
        point("2026-01-14", 0),
        point("2026-01-15", 500),
        point("2026-01-16", 550),
      ],
      new Map([
        ["2026-01-12", 1000],
        ["2026-01-13", -1100],
        ["2026-01-15", 500],
      ]),
    );

    expect(returns.map((r) => Number(r.twr.toFixed(6)))).toEqual([0, 0.1, 0.1, 0.1, 0.21]);
  });

  it("skips days without a value and carries their flows to the next valued day", () => {
    const returns = timeWeightedReturns(
      [point("2026-01-12", 1000), point("2026-01-13", null), point("2026-01-14", 2200)],
      new Map([
        ["2026-01-12", 1000],
        ["2026-01-13", 1000],
      ]),
    );

    expect(returns.map((r) => r.date)).toEqual(["2026-01-12", "2026-01-14"]);
    expect(last(returns)).toBeCloseTo(0.2, 10);
  });

  it("is flat before anything is bought", () => {
    const returns = timeWeightedReturns([point("2026-01-11", 0)], new Map());

    expect(returns).toEqual([{ date: "2026-01-11", twr: 0 }]);
  });
});

describe("xirr", () => {
  const flow = (date: string, amount: number) => ({ date, amount });

  it("is the simple yearly rate for one payment in and one value a year later", () => {
    expect(xirr([flow("2025-01-01", -1000), flow("2026-01-01", 1100)])).toBeCloseTo(0.1, 6);
  });

  it("annualizes a result earned over two years", () => {
    expect(xirr([flow("2025-01-01", -1000), flow("2027-01-01", 1210)])).toBeCloseTo(0.1, 6);
  });

  it("annualizes a result earned in half a year", () => {
    // +5% in 182.5 days is (1.05)^2 − 1 per year.
    const result = xirr([flow("2026-01-01", -1000), flow("2026-07-02", 1050)]);

    expect(result).toBeCloseTo(1.05 ** (365 / 182) - 1, 6);
  });

  it("is negative for a loss", () => {
    expect(xirr([flow("2025-01-01", -1000), flow("2026-01-01", 900)])).toBeCloseTo(-0.1, 6);
  });

  it("weights money by how long it was invested", () => {
    // 1000 for a whole year and another 1000 for the last half, ending at 2150.
    const result = xirr([
      flow("2025-01-01", -1000),
      flow("2025-07-02", -1000),
      flow("2026-01-01", 2150),
    ])!;

    const check = -1000 - 1000 / (1 + result) ** (182 / 365) + 2150 / (1 + result);
    expect(check).toBeCloseTo(0, 6);
    expect(result).toBeGreaterThan(0.075);
    expect(result).toBeLessThan(0.15);
  });

  it("handles a total loss", () => {
    const result = xirr([flow("2025-01-01", -1000), flow("2026-01-01", 0.01)]);

    expect(result).toBeCloseTo(-0.99999, 4);
  });

  it("does not depend on the order of the flows", () => {
    expect(xirr([flow("2026-01-01", 1100), flow("2025-01-01", -1000)])).toBeCloseTo(0.1, 6);
  });

  it.each([
    ["no flows", []],
    ["only payments in", [flow("2025-01-01", -1000), flow("2025-06-01", -500)]],
    ["only money received", [flow("2025-01-01", 1000)]],
    ["everything on one day", [flow("2025-01-01", -1000), flow("2025-01-01", 1100)]],
    ["only zero amounts", [flow("2025-01-01", 0), flow("2026-01-01", 0)]],
  ])("does not exist for %s", (_reason, flows) => {
    expect(xirr(flows)).toBeNull();
  });
});
