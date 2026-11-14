import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { LedgerEntry } from "@/domain/portfolio/ledger";
import {
  benchmarkLevels,
  buildLotTimeline,
  contributions,
  costOfLots,
  createPriceLookup,
  cumulativeReturns,
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

/** Units held per instrument in a snapshot, with the purchase day of each lot. */
const held = (snapshot: {
  lots: { instrumentId: string; acquiredOn: string; quantity: Decimal }[];
}) => snapshot.lots.map((lot) => [lot.instrumentId, lot.acquiredOn, lot.quantity.toFixed()]);

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

describe("buildLotTimeline", () => {
  it("records the lots held after each day with a trade", () => {
    const timeline = buildLotTimeline([
      [
        trade("BUY", "2026-01-10", "10", "100"),
        trade("BUY", "2026-02-10", "5", "200"),
        trade("SELL", "2026-03-10", "12", "300"),
      ],
    ]);

    expect(timeline.map((snapshot) => [snapshot.date, held(snapshot)])).toEqual([
      ["2026-01-10", [["CDR", "2026-01-10", "10"]]],
      [
        "2026-02-10",
        [
          ["CDR", "2026-01-10", "10"],
          ["CDR", "2026-02-10", "5"],
        ],
      ],
      // The sale used up the first lot and two units of the second.
      ["2026-03-10", [["CDR", "2026-02-10", "3"]]],
    ]);
  });

  it("keeps the lots of each account, each with its own FIFO", () => {
    const timeline = buildLotTimeline([
      [trade("BUY", "2026-01-10", "10", "100")],
      [trade("BUY", "2026-01-20", "3", "100"), trade("SELL", "2026-02-10", "1", "120")],
    ]);

    expect(held(timeline.at(-1)!)).toEqual([
      ["CDR", "2026-01-10", "10"],
      ["CDR", "2026-01-20", "2"],
    ]);
  });

  it("applies a split only to the account it was recorded on", () => {
    const timeline = buildLotTimeline([
      [trade("BUY", "2026-01-10", "10", "100"), split("2026-02-01", "2")],
      [trade("BUY", "2026-01-10", "3", "100")],
    ]);

    expect(held(timeline.at(-1)!)).toEqual([
      ["CDR", "2026-01-10", "20"],
      ["CDR", "2026-01-10", "3"],
    ]);
  });

  it("has no lots once everything is sold", () => {
    const timeline = buildLotTimeline([
      [trade("BUY", "2026-01-10", "10", "100"), trade("SELL", "2026-02-10", "10", "120")],
    ]);

    expect(timeline.at(-1)).toEqual({ date: "2026-02-10", lots: [] });
  });

  it("ignores days with only cash movements or income", () => {
    const deposit: LedgerEntry = {
      id: "dep",
      type: "DEPOSIT",
      date: "2026-01-02",
      amount: d(1000),
      currency: "PLN",
    };

    expect(buildLotTimeline([[deposit]])).toEqual([]);
    expect(buildLotTimeline([])).toEqual([]);
  });
});

describe("costOfLots", () => {
  const plnOnly = () => "PLN";
  const costAfter = (entries: LedgerEntry[], currencyOf = plnOnly, fx: FxOn = noFx) =>
    buildLotTimeline([entries]).map((snapshot) => [
      snapshot.date,
      costOfLots(snapshot.lots, currencyOf, fx)?.toFixed() ?? null,
    ]);

  it("is the cost of what is still held, commissions included", () => {
    const costs = costAfter([
      trade("BUY", "2026-01-10", "10", "100", { fee: "5" }),
      trade("BUY", "2026-02-10", "10", "200"),
      trade("SELL", "2026-03-10", "15", "300"),
    ]);

    // The sale removes the whole first lot (1005) and half of the second (1000).
    expect(costs).toEqual([
      ["2026-01-10", "1005"],
      ["2026-02-10", "3005"],
      ["2026-03-10", "1000"],
    ]);
  });

  it("never goes below zero, even after everything is sold at a profit", () => {
    const costs = costAfter([
      trade("BUY", "2026-01-10", "10", "100"),
      trade("SELL", "2026-03-10", "10", "500"),
    ]);

    expect(costs.at(-1)).toEqual(["2026-03-10", "0"]);
  });

  it("is not changed by a split", () => {
    const [, afterSplit] = buildLotTimeline([
      [trade("BUY", "2026-01-10", "10", "100"), split("2026-02-01", "3")],
    ]);

    expect(costOfLots(afterSplit.lots, plnOnly, noFx)?.toFixed(6)).toBe("1000.000000");
  });

  it("converts foreign purchases at the rate of the purchase", () => {
    const entries = [
      trade("BUY", "2026-01-10", "2", "100", { instrumentId: "AAPL", currency: "USD" }),
    ];

    expect(costAfter(entries, () => "USD", usdAt("4"))).toEqual([["2026-01-10", "800"]]);
    expect(costAfter(entries, () => "USD", noFx)).toEqual([["2026-01-10", null]]);
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

  it("values a retail treasury bond by what it has accrued since the purchase", () => {
    const bonds = new Map([
      ["TOS", { kind: "TOS" as const, firstRate: d("0.044"), laterRates: new Map() }],
    ]);
    const priceOn = createPriceLookup(new Map(), [], bonds);

    expect(priceOn("TOS", "2027-11-01", "2026-11-01")).toEqual({
      date: "2027-11-01",
      close: d("104.4"),
      fromTrade: false,
      estimated: undefined,
    });
    // The same series bought later has accrued less.
    expect(priceOn("TOS", "2027-11-01", "2026-11-30")?.close.lt(d("104.4"))).toBe(true);
    // Without a purchase day there is no price for a bond.
    expect(priceOn("TOS", "2027-11-01")).toBeNull();
  });

  it("marks a bond price as an estimate when a rate has not been announced", () => {
    const bonds = new Map([
      ["EDO", { kind: "EDO" as const, firstRate: d("0.0535"), laterRates: new Map() }],
    ]);
    const priceOn = createPriceLookup(new Map(), [], bonds);

    expect(priceOn("EDO", "2027-06-01", "2026-11-01")?.estimated).toBeUndefined();
    expect(priceOn("EDO", "2028-06-01", "2026-11-01")?.estimated).toBe(true);
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
  const timeline = buildLotTimeline([entries]);
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

describe("benchmarkLevels", () => {
  const priceOn = createPriceLookup(
    new Map([
      [
        "SPX",
        [
          { date: "2026-01-12", close: d(5000) },
          { date: "2026-01-14", close: d(5100) },
        ],
      ],
    ]),
    [],
  );
  const days = dailyDates("2026-01-11", "2026-01-14");

  it("is the benchmark's price in PLN, carried forward over days without a quote", () => {
    const levels = benchmarkLevels("SPX", "USD", days, priceOn, usdAt("4"));

    expect(levels).toEqual([
      { date: "2026-01-11", level: null },
      { date: "2026-01-12", level: 20000 },
      { date: "2026-01-13", level: 20000 },
      { date: "2026-01-14", level: 20400 },
    ]);
  });

  it("needs no exchange rate for a benchmark quoted in PLN", () => {
    const levels = benchmarkLevels("SPX", "PLN", days, priceOn, noFx);

    expect(levels.map((point) => point.level)).toEqual([null, 5000, 5000, 5100]);
  });

  it("is unknown without an exchange rate", () => {
    const levels = benchmarkLevels("SPX", "USD", days, priceOn, noFx);

    expect(levels.every((point) => point.level === null)).toBe(true);
  });
});

describe("cumulativeReturns", () => {
  const level = (date: string, value: number | null) => ({ date, level: value });

  it("starts at zero on the first known day and follows the level", () => {
    const returns = cumulativeReturns([
      level("2026-01-11", null),
      level("2026-01-12", 200),
      level("2026-01-13", 220),
      level("2026-01-14", 190),
    ]);

    expect(returns.map((point) => point.value && Number(point.value.toFixed(6)))).toEqual([
      null,
      0,
      0.1,
      -0.05,
    ]);
  });

  it("keeps gaps as gaps", () => {
    const returns = cumulativeReturns([
      level("2026-01-12", 200),
      level("2026-01-13", null),
      level("2026-01-14", 210),
    ]);

    expect(returns.map((point) => point.value)).toEqual([0, null, expect.closeTo(0.05, 10)]);
  });

  it("has no returns when no level is known", () => {
    expect(cumulativeReturns([level("2026-01-12", null)])).toEqual([
      { date: "2026-01-12", value: null },
    ]);
    expect(cumulativeReturns([])).toEqual([]);
  });
});
