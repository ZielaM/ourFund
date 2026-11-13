import { describe, expect, it } from "vitest";
import {
  accountInputSchema,
  INSTRUMENT_NAME_MAX_LENGTH,
  instrumentInputSchema,
  NAME_MAX_LENGTH,
  portfolioInputSchema,
} from "./naming";

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${String(issue.path[0])}:${issue.message}`);
}

describe("portfolioInputSchema", () => {
  it("trims the name and collapses repeated spaces", () => {
    expect(portfolioInputSchema.parse({ name: "  Portfel   emerytalny " })).toEqual({
      name: "Portfel emerytalny",
    });
  });

  it("requires a name", () => {
    expect(issues(portfolioInputSchema.safeParse({ name: "   " }))).toEqual(["name:required"]);
    expect(issues(portfolioInputSchema.safeParse({}))).toEqual(["name:required"]);
  });

  it("limits the length", () => {
    expect(portfolioInputSchema.safeParse({ name: "a".repeat(NAME_MAX_LENGTH) }).success).toBe(
      true,
    );
    expect(
      issues(portfolioInputSchema.safeParse({ name: "a".repeat(NAME_MAX_LENGTH + 1) })),
    ).toEqual(["name:name.tooLong"]);
  });
});

describe("accountInputSchema", () => {
  it.each(["STANDARD", "IKE", "IKZE", "OKI"])("accepts the %s account type", (type) => {
    expect(accountInputSchema.parse({ name: "XTB", type }).type).toBe(type);
  });

  it("makes the institution optional", () => {
    expect(accountInputSchema.parse({ name: "IKE", type: "IKE" }).institution).toBeNull();
    expect(
      accountInputSchema.parse({ name: "IKE", type: "IKE", institution: "  " }).institution,
    ).toBeNull();
    expect(
      accountInputSchema.parse({ name: "IKE", type: "IKE", institution: " mBank " }).institution,
    ).toBe("mBank");
  });

  it("rejects an unknown type and a too long institution", () => {
    expect(issues(accountInputSchema.safeParse({ name: "X", type: "PPK" }))).toEqual([
      "type:required",
    ]);
    expect(
      issues(
        accountInputSchema.safeParse({
          name: "X",
          type: "IKE",
          institution: "a".repeat(NAME_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(["institution:name.tooLong"]);
  });
});

describe("instrumentInputSchema", () => {
  const valid = {
    symbol: "cdr",
    market: "GPW",
    name: "CD Projekt",
    type: "STOCK",
    currency: "pln",
  };

  it("normalizes the symbol and the currency to upper case", () => {
    expect(instrumentInputSchema.parse(valid)).toEqual({
      symbol: "CDR",
      market: "GPW",
      name: "CD Projekt",
      type: "STOCK",
      currency: "PLN",
    });
  });

  it.each(["BRK.B", "VWCE", "BTC-USD", "11B", "A"])("accepts the symbol %s", (symbol) => {
    expect(instrumentInputSchema.safeParse({ ...valid, symbol }).success).toBe(true);
  });

  it.each([
    ["a space", "CD R"],
    ["a leading dot", ".CDR"],
    ["more than 20 characters", "A".repeat(21)],
    ["Polish letters", "ŻABKA"],
  ])("rejects a symbol with %s", (_reason, symbol) => {
    expect(issues(instrumentInputSchema.safeParse({ ...valid, symbol }))).toEqual([
      "symbol:symbol.invalid",
    ]);
  });

  it("requires every field", () => {
    expect(issues(instrumentInputSchema.safeParse({}))).toEqual([
      "symbol:required",
      "market:required",
      "name:required",
      "type:required",
      "currency:required",
    ]);
  });

  it("rejects unknown markets, types and currencies", () => {
    expect(
      issues(
        instrumentInputSchema.safeParse({ ...valid, market: "MOON", type: "NFT", currency: "XYZ" }),
      ),
    ).toEqual(["market:required", "type:required", "currency:currency.invalid"]);
  });

  it("limits the name length", () => {
    expect(
      issues(
        instrumentInputSchema.safeParse({
          ...valid,
          name: "a".repeat(INSTRUMENT_NAME_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(["name:name.tooLong"]);
  });
});
