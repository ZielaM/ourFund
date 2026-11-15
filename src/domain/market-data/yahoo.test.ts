import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import {
  barDate,
  cleanClose,
  closesInCurrency,
  currencyScale,
  parseYahooChart,
  undoSplitAdjustment,
} from "./yahoo";

// Shapes and values taken from real responses of the chart endpoint.
const warsaw = {
  chart: {
    result: [
      {
        meta: { currency: "PLN", symbol: "CDR.WA", gmtoffset: 3600 },
        timestamp: [1793952000, 1794211200, 1794297600, 1794470400],
        indicators: {
          quote: [{ close: [266.8999938964844, 269.0, 274.5, 278.20001220703125] }],
        },
      },
    ],
    error: null,
  },
};

const notFound = {
  chart: {
    result: null,
    error: { code: "Not Found", description: "No data found, symbol may be delisted" },
  },
};

const closes = (json: unknown) => {
  const chart = parseYahooChart(json);
  if (!chart.ok) throw new Error(`expected closes, got ${chart.reason}`);
  return chart.closes.map(({ date, close }) => [date, close.toFixed()]);
};

describe("cleanClose", () => {
  it.each([
    [266.8999938964844, "266.9"],
    [278.20001220703125, "278.2"],
    [189.6199951171875, "189.62"],
    [354.8800048828125, "354.88"],
    [117.3499984741211, "117.35"],
    [71342.96875, "71342.97"],
    [269, "269"],
  ])("recovers the quoted price from %d", (raw, expected) => {
    expect(cleanClose(raw).toFixed()).toBe(expected);
  });
});

describe("barDate", () => {
  it("uses the exchange's local day", () => {
    // 09:00 in Warsaw, 09:30 in New York, 00:00 UTC for crypto.
    expect(barDate(1794470400, 3600)).toBe("2026-11-12");
    expect(barDate(1794493800, -18000)).toBe("2026-11-12");
    expect(barDate(1794528000, 0)).toBe("2026-11-13");
  });

  it("does not slip to the previous day for an exchange ahead of UTC", () => {
    // 09:00 in Tokyo is still the previous day in UTC.
    const midnightUtc = Date.parse("2026-11-12T00:00:00Z") / 1000;

    expect(barDate(midnightUtc, 9 * 3600)).toBe("2026-11-12");
  });
});

describe("parseYahooChart", () => {
  it("reads daily closes with their dates and the quote currency", () => {
    expect(parseYahooChart(warsaw)).toMatchObject({ ok: true, currency: "PLN" });
    expect(closes(warsaw)).toEqual([
      ["2026-11-06", "266.9"],
      ["2026-11-09", "269"],
      ["2026-11-10", "274.5"],
      ["2026-11-12", "278.2"],
    ]);
  });

  it("skips days without a price", () => {
    const withGap = structuredClone(warsaw);
    withGap.chart.result[0].indicators.quote[0].close = [266.9, null as never, 274.5, 0];

    expect(closes(withGap)).toEqual([
      ["2026-11-06", "266.9"],
      ["2026-11-10", "274.5"],
    ]);
  });

  it("keeps the later bar when two fall on the same day", () => {
    const doubled = structuredClone(warsaw);
    doubled.chart.result[0].timestamp = [1794470400, 1794470400 + 3600];
    doubled.chart.result[0].indicators.quote[0].close = [278.2, 279.5];

    expect(closes(doubled)).toEqual([["2026-11-12", "279.5"]]);
  });

  it("returns no closes for a symbol without bars in the range", () => {
    const empty = {
      chart: {
        result: [{ meta: { currency: "PLN", gmtoffset: 3600 }, indicators: { quote: [{}] } }],
        error: null,
      },
    };

    expect(parseYahooChart(empty)).toEqual({
      ok: true,
      currency: "PLN",
      closes: [],
      dividends: [],
      splits: [],
    });
  });

  it("reports an unknown symbol", () => {
    expect(parseYahooChart(notFound)).toEqual({ ok: false, reason: "notFound" });
  });

  it.each([
    ["an HTML error page", "<html>Too Many Requests</html>"],
    ["an unrelated object", { quoteResponse: {} }],
    ["an empty result", { chart: { result: [], error: null } }],
    ["another provider error", { chart: { result: null, error: { code: "Bad Request" } } }],
    ["nothing", null],
  ])("reports %s as malformed", (_reason, json) => {
    expect(parseYahooChart(json)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("closesInCurrency", () => {
  const sample = [{ date: "2026-11-12", close: new Decimal("118.05") }];

  it("returns the closes unchanged when the currency matches", () => {
    expect(closesInCurrency(sample, "PLN", "PLN")).toBe(sample);
  });

  it.each(["GBp", "GBX"])("converts London pence (%s) to pounds", (quotedIn) => {
    const converted = closesInCurrency(sample, quotedIn, "GBP");

    expect(converted?.[0].close.toFixed()).toBe("1.1805");
  });

  it("refuses prices quoted in another currency", () => {
    expect(closesInCurrency(sample, "USD", "PLN")).toBeNull();
    expect(closesInCurrency(sample, "GBp", "USD")).toBeNull();
    expect(closesInCurrency(sample, "GBP", "GBp")).toBeNull();
  });
});

describe("dividends and splits", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  // A 10:1 split on 10 June: Yahoo divides every earlier close and dividend by ten.
  const split = {
    chart: {
      result: [
        {
          meta: { currency: "USD", gmtoffset: -14400 },
          timestamp: [
            at("2024-06-06T13:30:00Z"),
            at("2024-06-07T13:30:00Z"),
            at("2024-06-10T13:30:00Z"),
            at("2024-06-11T13:30:00Z"),
          ],
          indicators: { quote: [{ close: [120.5, 121.25, 122.0, 121.0] }] },
          events: {
            dividends: {
              a: { date: at("2024-06-05T13:30:00Z"), amount: 0.004 },
              b: { date: at("2024-06-11T13:30:00Z"), amount: 0.01 },
            },
            splits: {
              a: { date: at("2024-06-10T13:30:00Z"), numerator: 10, denominator: 1 },
            },
          },
        },
      ],
      error: null,
    },
  };

  function parsed(json: unknown) {
    const chart = parseYahooChart(json);
    if (!chart.ok) throw new Error(`expected a chart, got ${chart.reason}`);
    return chart;
  }

  it("reads splits as new units per old unit, dated on the first day after the split", () => {
    expect(parsed(split).splits.map(({ date, ratio }) => [date, ratio.toFixed()])).toEqual([
      ["2024-06-10", "10"],
    ]);
  });

  it("returns closes as they were traded: earlier ones are multiplied back by the ratio", () => {
    expect(parsed(split).closes.map(({ date, close }) => [date, close.toFixed()])).toEqual([
      ["2024-06-06", "1205"],
      ["2024-06-07", "1212.5"],
      ["2024-06-10", "122"],
      ["2024-06-11", "121"],
    ]);
  });

  it("returns dividends as they were paid", () => {
    expect(parsed(split).dividends.map(({ date, amount }) => [date, amount.toFixed()])).toEqual([
      ["2024-06-05", "0.04"],
      ["2024-06-11", "0.01"],
    ]);
  });

  it("reads a reverse split as a ratio below one", () => {
    const reverse = structuredClone(split);
    reverse.chart.result[0].events.splits.a = {
      date: at("2024-06-10T13:30:00Z"),
      numerator: 1,
      denominator: 4,
    };

    const chart = parsed(reverse);
    expect(chart.splits[0].ratio.toFixed()).toBe("0.25");
    expect(chart.closes[0].close.toFixed()).toBe("30.125");
  });

  it("ignores splits that change nothing and events without a positive value", () => {
    const noise = structuredClone(split);
    noise.chart.result[0].events.splits.a.numerator = 1;
    noise.chart.result[0].events.dividends.a.amount = 0;

    const chart = parsed(noise);
    expect(chart.splits).toEqual([]);
    expect(chart.dividends).toHaveLength(1);
    expect(chart.closes[0].close.toFixed()).toBe("120.5");
  });

  it("multiplies by every later split, not by earlier ones", () => {
    const items = [
      { date: "2026-01-10", value: new Decimal(3) },
      { date: "2026-02-10", value: new Decimal(3) },
      { date: "2026-03-10", value: new Decimal(3) },
    ];
    const splits = [
      { date: "2026-02-01", ratio: new Decimal(2) },
      { date: "2026-03-01", ratio: new Decimal(5) },
    ];

    const result = undoSplitAdjustment(
      items,
      splits,
      (item) => item.value,
      (item, value) => ({ ...item, value }),
    );

    expect(result.map((item) => item.value.toFixed())).toEqual(["30", "15", "3"]);
  });
});

describe("currencyScale", () => {
  it("is one for the same currency, a hundredth for pence, null otherwise", () => {
    expect(currencyScale("PLN", "PLN")?.toFixed()).toBe("1");
    expect(currencyScale("GBp", "GBP")?.toFixed()).toBe("0.01");
    expect(currencyScale("GBX", "GBP")?.toFixed()).toBe("0.01");
    expect(currencyScale("USD", "EUR")).toBeNull();
  });
});
