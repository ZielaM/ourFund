import { describe, expect, it } from "vitest";
import { defaultQuoteSymbol, effectiveQuoteSymbol } from "./quote-symbol";

const instrument = (symbol: string, market: string, currency = "PLN") => ({
  symbol,
  market,
  currency,
});

describe("defaultQuoteSymbol", () => {
  it.each([
    ["CDR", "GPW", "PLN", "CDR.WA"],
    ["CRJ", "NEWCONNECT", "PLN", "CRJ.WA"],
    ["VWCE", "XETRA", "EUR", "VWCE.DE"],
    ["VWRA", "LSE", "USD", "VWRA.L"],
    ["AAPL", "NASDAQ", "USD", "AAPL"],
    ["BRK.B", "NYSE", "USD", "BRK-B"],
    ["BTC", "CRYPTO", "USD", "BTC-USD"],
    ["ETH", "CRYPTO", "EUR", "ETH-EUR"],
  ])("%s on %s (%s) is %s", (symbol, market, currency, expected) => {
    expect(defaultQuoteSymbol(instrument(symbol, market, currency))).toBe(expected);
  });

  it.each(["EURONEXT", "CATALYST", "OTHER", "UNKNOWN"])("cannot be derived for %s", (market) => {
    expect(defaultQuoteSymbol(instrument("ABC", market))).toBeNull();
  });
});

describe("effectiveQuoteSymbol", () => {
  it("prefers the symbol entered by the user", () => {
    expect(
      effectiveQuoteSymbol({ ...instrument("ASML", "EURONEXT", "EUR"), quoteSymbol: "ASML.AS" }),
    ).toBe("ASML.AS");
  });

  it("falls back to the derived symbol", () => {
    expect(effectiveQuoteSymbol({ ...instrument("CDR", "GPW"), quoteSymbol: null })).toBe("CDR.WA");
    expect(effectiveQuoteSymbol({ ...instrument("CDR", "GPW"), quoteSymbol: "  " })).toBe("CDR.WA");
  });

  it("is null when there is neither", () => {
    expect(effectiveQuoteSymbol({ ...instrument("ABC", "OTHER"), quoteSymbol: null })).toBeNull();
  });
});
