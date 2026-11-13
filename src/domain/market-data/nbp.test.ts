import { describe, expect, it } from "vitest";
import { addDays, parseNbpRates, splitDateRange } from "./nbp";

describe("parseNbpRates", () => {
  // Shape and values taken from a real response of api.nbp.pl.
  const response = {
    table: "A",
    currency: "dolar amerykański",
    code: "USD",
    rates: [
      { no: "213/A/NBP/2026", effectiveDate: "2026-11-02", mid: 3.9389 },
      { no: "214/A/NBP/2026", effectiveDate: "2026-11-03", mid: 3.9526 },
    ],
  };

  it("reads the average rates", () => {
    const rates = parseNbpRates(response);

    expect(rates?.map(({ date, rate }) => [date, rate.toFixed()])).toEqual([
      ["2026-11-02", "3.9389"],
      ["2026-11-03", "3.9526"],
    ]);
  });

  it("keeps small rates such as the yen exactly", () => {
    const rates = parseNbpRates({ rates: [{ effectiveDate: "2026-11-10", mid: 0.024729 }] });

    expect(rates?.[0].rate.toFixed()).toBe("0.024729");
  });

  it.each([
    ["the plain-text 'no data' answer", "404 NotFound - Not Found - Brak danych"],
    ["a response without rates", { table: "A" }],
    ["a rate that is not positive", { rates: [{ effectiveDate: "2026-11-10", mid: 0 }] }],
    ["a malformed date", { rates: [{ effectiveDate: "10.11.2026", mid: 3.9 }] }],
    ["nothing", undefined],
  ])("returns null for %s", (_reason, json) => {
    expect(parseNbpRates(json)).toBeNull();
  });
});

describe("addDays", () => {
  it("moves across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("is not thrown off by daylight saving time", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("splitDateRange", () => {
  it("keeps a short range whole", () => {
    expect(splitDateRange("2026-11-02", "2026-11-13")).toEqual([
      { from: "2026-11-02", to: "2026-11-13" },
    ]);
  });

  it("handles a single day", () => {
    expect(splitDateRange("2026-11-13", "2026-11-13")).toEqual([
      { from: "2026-11-13", to: "2026-11-13" },
    ]);
  });

  it("splits a long range into consecutive pieces without gaps or overlaps", () => {
    expect(splitDateRange("2026-01-01", "2026-01-10", 4)).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
      { from: "2026-01-09", to: "2026-01-10" },
    ]);
  });

  it("never exceeds the limit of the NBP API", () => {
    const ranges = splitDateRange("2020-01-01", "2026-11-13");

    expect(ranges[0].from).toBe("2020-01-01");
    expect(ranges.at(-1)?.to).toBe("2026-11-13");
    for (const range of ranges) {
      const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(365);
    }
  });

  it("returns nothing when the range is empty", () => {
    expect(splitDateRange("2026-11-13", "2026-11-12")).toEqual([]);
  });
});
