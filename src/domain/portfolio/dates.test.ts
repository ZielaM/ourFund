import { describe, expect, it } from "vitest";
import { isIsoDate, isoDateToUtc, todayInWarsaw, utcToIsoDate } from "./dates";

describe("isIsoDate", () => {
  it.each(["2026-11-13", "2024-02-29", "1990-01-01"])("accepts %s", (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each([
    ["a day that does not exist", "2026-02-30"],
    ["29 February in a common year", "2026-02-29"],
    ["month 13", "2026-13-01"],
    ["the Polish format", "13.11.2026"],
    ["a date with time", "2026-11-13T10:00:00Z"],
    ["one-digit parts", "2026-1-3"],
    ["empty", ""],
  ])("rejects %s", (_reason, value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe("todayInWarsaw", () => {
  it("is already the next day in Poland late in the UTC evening", () => {
    expect(todayInWarsaw(new Date("2026-11-13T23:30:00Z"))).toBe("2026-11-14");
  });

  it("follows summer time", () => {
    expect(todayInWarsaw(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
    expect(todayInWarsaw(new Date("2026-07-01T22:00:00Z"))).toBe("2026-07-02");
  });

  it("follows winter time", () => {
    expect(todayInWarsaw(new Date("2026-01-01T22:59:00Z"))).toBe("2026-01-01");
    expect(todayInWarsaw(new Date("2026-01-01T23:00:00Z"))).toBe("2026-01-02");
  });
});

describe("conversion to and from database dates", () => {
  it("uses UTC midnight, so the day never shifts", () => {
    expect(isoDateToUtc("2026-11-13").toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(utcToIsoDate(new Date("2026-11-13T00:00:00.000Z"))).toBe("2026-11-13");
  });

  it("round-trips", () => {
    expect(utcToIsoDate(isoDateToUtc("2024-02-29"))).toBe("2024-02-29");
  });
});
