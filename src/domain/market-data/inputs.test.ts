import { describe, expect, it } from "vitest";
import { manualPriceSchema, quoteSettingsSchema } from "./inputs";

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${String(issue.path[0])}:${issue.message}`);
}

describe("quoteSettingsSchema", () => {
  it("accepts automatic quotes with a symbol, normalized to upper case", () => {
    expect(quoteSettingsSchema.parse({ priceSource: "YAHOO", quoteSymbol: " asml.as " })).toEqual({
      priceSource: "YAHOO",
      quoteSymbol: "ASML.AS",
    });
  });

  it("treats an empty symbol as 'derive it'", () => {
    expect(
      quoteSettingsSchema.parse({ priceSource: "MANUAL", quoteSymbol: "  " }).quoteSymbol,
    ).toBeNull();
    expect(quoteSettingsSchema.parse({ priceSource: "MANUAL" }).quoteSymbol).toBeNull();
  });

  it.each(["CDR.WA", "BRK-B", "BTC-USD", "EURPLN=X", "^GSPC".slice(1)])("accepts %s", (symbol) => {
    expect(
      quoteSettingsSchema.safeParse({ priceSource: "YAHOO", quoteSymbol: symbol }).success,
    ).toBe(true);
  });

  it.each(["CD R", "CDR/WA", "https://x", "A".repeat(31)])("rejects the symbol %s", (symbol) => {
    expect(
      issues(quoteSettingsSchema.safeParse({ priceSource: "YAHOO", quoteSymbol: symbol })),
    ).toEqual(["quoteSymbol:quoteSymbol.invalid"]);
  });

  it("requires a known source", () => {
    expect(issues(quoteSettingsSchema.safeParse({ priceSource: "STOOQ" }))).toEqual([
      "priceSource:required",
    ]);
  });
});

describe("manualPriceSchema", () => {
  it("reads a date and a price typed the Polish way", () => {
    const result = manualPriceSchema.parse({ date: "2026-11-12", close: "1 278,20" });

    expect(result.date).toBe("2026-11-12");
    expect(result.close.toFixed()).toBe("1278.2");
  });

  it("requires a real date and a positive price", () => {
    expect(issues(manualPriceSchema.safeParse({ date: "", close: "" }))).toEqual([
      "date:required",
      "close:required",
    ]);
    expect(issues(manualPriceSchema.safeParse({ date: "2026-02-30", close: "0" }))).toEqual([
      "date:date.invalid",
      "close:number.positive",
    ]);
  });
});
