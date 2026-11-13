import { describe, expect, it } from "vitest";
import { CURRENCIES, isCurrency } from "./currencies";
import { isMarket, MARKETS } from "./markets";

describe("currencies", () => {
  it("lists the reporting currency first", () => {
    expect(CURRENCIES[0]).toBe("PLN");
  });

  it("recognizes supported codes only, in upper case", () => {
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("eur")).toBe(false);
    expect(isCurrency("XYZ")).toBe(false);
    expect(isCurrency("")).toBe(false);
  });

  it("has no duplicates", () => {
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
  });
});

describe("markets", () => {
  it("recognizes supported codes only", () => {
    expect(isMarket("GPW")).toBe(true);
    expect(isMarket("gpw")).toBe(false);
    expect(isMarket("MOON")).toBe(false);
  });

  it("has no duplicates", () => {
    expect(new Set(MARKETS).size).toBe(MARKETS.length);
  });
});
