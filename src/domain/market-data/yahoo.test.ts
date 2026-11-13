import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { barDate, cleanClose, closesInCurrency, parseYahooChart } from "./yahoo";

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

    expect(parseYahooChart(empty)).toEqual({ ok: true, currency: "PLN", closes: [] });
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
