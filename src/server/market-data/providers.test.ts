import { describe, expect, it, vi } from "vitest";
import { createFixtureProviders, createLiveProviders, getMarketDataProviders } from "./providers";

type Reply = { status: number; body: unknown };

/** A stand-in for `fetch` that answers from a list and records the requested URLs. */
function fakeFetch(replies: Reply[] | ((url: string) => Reply)) {
  const urls: string[] = [];
  const queue = Array.isArray(replies) ? [...replies] : null;

  const fetchFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    void _init;
    const url = String(input);
    urls.push(url);
    const reply = queue ? queue.shift() : (replies as (url: string) => Reply)(url);
    if (!reply) throw new Error(`unexpected request: ${url}`);

    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
    });
  });

  return { fetchFn: fetchFn as unknown as typeof fetch, urls, calls: fetchFn };
}

const chart = (currency: string, bars: [number, number | null][], gmtoffset = 3600) => ({
  chart: {
    result: [
      {
        meta: { currency, gmtoffset },
        timestamp: bars.map(([time]) => time),
        indicators: { quote: [{ close: bars.map(([, close]) => close) }] },
      },
    ],
    error: null,
  },
});

const at = (iso: string) => Date.parse(iso) / 1000;

describe("live quotes (Yahoo Finance)", () => {
  it("requests the symbol for the period with a day of margin and returns the closes", async () => {
    const { fetchFn, urls, calls } = fakeFetch([
      {
        status: 200,
        body: chart("PLN", [
          [at("2026-11-09T08:00:00Z"), 269.0],
          [at("2026-11-10T08:00:00Z"), 274.5],
        ]),
      },
    ]);

    const result = await createLiveProviders(fetchFn).quotes(
      "CDR.WA",
      "PLN",
      "2026-11-09",
      "2026-11-10",
    );

    expect(result.ok && result.closes.map((c) => [c.date, c.close.toFixed()])).toEqual([
      ["2026-11-09", "269"],
      ["2026-11-10", "274.5"],
    ]);
    const url = new URL(urls[0]);
    expect(url.origin + url.pathname).toBe(
      "https://query1.finance.yahoo.com/v8/finance/chart/CDR.WA",
    );
    expect(url.searchParams.get("interval")).toBe("1d");
    expect(url.searchParams.get("period1")).toBe(String(at("2026-11-08T00:00:00Z")));
    expect(url.searchParams.get("period2")).toBe(String(at("2026-11-12T00:00:00Z")));
    const headers = calls.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toContain("ourFund");
  });

  it("drops bars outside the requested period", async () => {
    const { fetchFn } = fakeFetch([
      {
        status: 200,
        body: chart("PLN", [
          [at("2026-11-06T08:00:00Z"), 266.9],
          [at("2026-11-09T08:00:00Z"), 269.0],
          [at("2026-11-12T08:00:00Z"), 278.2],
        ]),
      },
    ]);

    const result = await createLiveProviders(fetchFn).quotes(
      "CDR.WA",
      "PLN",
      "2026-11-09",
      "2026-11-10",
    );

    expect(result.ok && result.closes.map((c) => c.date)).toEqual(["2026-11-09"]);
  });

  it("escapes symbols with special characters", async () => {
    const { fetchFn, urls } = fakeFetch([{ status: 200, body: chart("PLN", []) }]);

    await createLiveProviders(fetchFn).quotes("EURPLN=X", "PLN", "2026-11-09", "2026-11-10");

    expect(urls[0]).toContain("/chart/EURPLN%3DX?");
  });

  it("converts London pence to pounds", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: chart("GBp", [[at("2026-11-12T08:00:00Z"), 118.05]], 0) },
    ]);

    const result = await createLiveProviders(fetchFn).quotes(
      "VOD.L",
      "GBP",
      "2026-11-12",
      "2026-11-12",
    );

    expect(result.ok && result.closes[0].close.toFixed()).toBe("1.1805");
  });

  it("reports an unknown symbol", async () => {
    const { fetchFn } = fakeFetch([
      { status: 404, body: { chart: { result: null, error: { code: "Not Found" } } } },
    ]);

    await expect(
      createLiveProviders(fetchFn).quotes("NOPE.WA", "PLN", "2026-11-09", "2026-11-10"),
    ).resolves.toEqual({ ok: false, reason: "notFound" });
  });

  it("refuses prices quoted in a different currency than the instrument", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: chart("USD", [[at("2026-11-12T08:00:00Z"), 189.5]], 0) },
    ]);

    await expect(
      createLiveProviders(fetchFn).quotes("VWRA.L", "EUR", "2026-11-12", "2026-11-12"),
    ).resolves.toEqual({ ok: false, reason: "currencyMismatch" });
  });

  it.each([
    ["rate limiting", { status: 429, body: "Too Many Requests" }],
    ["a server error", { status: 500, body: { chart: { result: null, error: { code: "x" } } } }],
    ["a non-200 answer with a valid body", { status: 503, body: chart("PLN", []) }],
  ])("reports %s as unavailable", async (_reason, reply) => {
    const { fetchFn } = fakeFetch([reply]);

    await expect(
      createLiveProviders(fetchFn).quotes("CDR.WA", "PLN", "2026-11-09", "2026-11-10"),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports a network failure as unavailable instead of throwing", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      createLiveProviders(fetchFn).quotes("CDR.WA", "PLN", "2026-11-09", "2026-11-10"),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("live exchange rates (NBP)", () => {
  const usd = {
    rates: [
      { effectiveDate: "2026-11-09", mid: 3.9321 },
      { effectiveDate: "2026-11-10", mid: 3.9099 },
    ],
  };

  it("requests table A for the currency and period", async () => {
    const { fetchFn, urls } = fakeFetch([{ status: 200, body: usd }]);

    const result = await createLiveProviders(fetchFn).rates("USD", "2026-11-09", "2026-11-10");

    expect(urls).toEqual([
      "https://api.nbp.pl/api/exchangerates/rates/a/usd/2026-11-09/2026-11-10/?format=json",
    ]);
    expect(result.ok && result.rates.map((r) => [r.date, r.rate.toFixed()])).toEqual([
      ["2026-11-09", "3.9321"],
      ["2026-11-10", "3.9099"],
    ]);
  });

  it("treats 'no data' for a range without publications as an empty result", async () => {
    const { fetchFn } = fakeFetch([
      { status: 404, body: "404 NotFound - Not Found - Brak danych" },
    ]);

    await expect(
      createLiveProviders(fetchFn).rates("USD", "2026-11-07", "2026-11-08"),
    ).resolves.toEqual({ ok: true, rates: [] });
  });

  it("fetches a long period in pieces and joins them", async () => {
    const { fetchFn, urls } = fakeFetch((url) => ({
      status: 200,
      body: { rates: [{ effectiveDate: url.split("/").at(-3)!, mid: 4 }] },
    }));

    const result = await createLiveProviders(fetchFn).rates("EUR", "2025-01-01", "2026-06-30");

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/eur/2025-01-01/2025-12-31/");
    expect(urls[1]).toContain("/eur/2026-01-01/2026-06-30/");
    expect(result.ok && result.rates.map((r) => r.date)).toEqual(["2025-01-01", "2026-01-01"]);
  });

  it.each([
    ["a server error", { status: 500, body: "error" }],
    ["an unexpected body", { status: 200, body: { table: "A" } }],
  ])("reports %s as unavailable", async (_reason, reply) => {
    const { fetchFn } = fakeFetch([reply]);

    await expect(
      createLiveProviders(fetchFn).rates("USD", "2026-11-09", "2026-11-10"),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports a network failure as unavailable instead of throwing", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      createLiveProviders(fetchFn).rates("USD", "2026-11-09", "2026-11-10"),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("fixture providers", () => {
  const providers = createFixtureProviders();

  it("serve constant prices on weekdays only", async () => {
    const result = await providers.quotes("CDR.WA", "PLN", "2026-11-06", "2026-11-10");

    expect(result.ok && result.closes.map((c) => [c.date, c.close.toFixed()])).toEqual([
      ["2026-11-06", "250"],
      ["2026-11-09", "250"],
      ["2026-11-10", "250"],
    ]);
  });

  it("have a default price and a symbol that is never found", async () => {
    const known = await providers.quotes("XYZ", "PLN", "2026-11-09", "2026-11-09");

    expect(known.ok && known.closes[0].close.toFixed()).toBe("100");
    await expect(
      providers.quotes("MISSING.WA", "PLN", "2026-11-09", "2026-11-09"),
    ).resolves.toEqual({ ok: false, reason: "notFound" });
  });

  it("serve constant exchange rates", async () => {
    const usd = await providers.rates("USD", "2026-11-09", "2026-11-09");
    const other = await providers.rates("CHF", "2026-11-09", "2026-11-09");

    expect(usd.ok && usd.rates[0].rate.toFixed()).toBe("4");
    expect(other.ok && other.rates[0].rate.toFixed()).toBe("1");
  });
});

describe("getMarketDataProviders", () => {
  it("returns providers for the live and fixture modes and nothing when switched off", () => {
    expect(getMarketDataProviders("live")).not.toBeNull();
    expect(getMarketDataProviders("fixture")).not.toBeNull();
    expect(getMarketDataProviders("off")).toBeNull();
  });
});
