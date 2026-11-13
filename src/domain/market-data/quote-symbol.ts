import type { Market } from "@/domain/portfolio/markets";

type QuotedInstrument = {
  symbol: string;
  market: string;
  currency: string;
};

/** Suffix Yahoo Finance uses for each market; null where the symbol cannot be derived. */
const YAHOO_SUFFIX: Record<Market, string | null> = {
  GPW: ".WA",
  NEWCONNECT: ".WA",
  XETRA: ".DE",
  LSE: ".L",
  NYSE: "",
  NASDAQ: "",
  // Euronext spans several exchanges (.PA, .AS, .BR, ...): the user has to say which.
  EURONEXT: null,
  CATALYST: null,
  OTHER: null,
  // Crypto is quoted as a pair, handled below.
  CRYPTO: null,
};

/**
 * The Yahoo Finance symbol for an instrument, e.g. "CDR.WA" for CDR on GPW, or null when it
 * cannot be derived and has to be entered by hand.
 */
export function defaultQuoteSymbol(instrument: QuotedInstrument): string | null {
  if (instrument.market === "CRYPTO") {
    return `${instrument.symbol}-${instrument.currency}`;
  }

  const suffix = YAHOO_SUFFIX[instrument.market as Market];
  if (suffix === null || suffix === undefined) {
    return null;
  }

  // US share classes are written with a dot on the exchange and a hyphen at Yahoo (BRK.B).
  const symbol = suffix === "" ? instrument.symbol.replace(".", "-") : instrument.symbol;
  return `${symbol}${suffix}`;
}

/** The symbol actually used for fetching: the user's override, or the derived one. */
export function effectiveQuoteSymbol(
  instrument: QuotedInstrument & { quoteSymbol: string | null },
): string | null {
  return instrument.quoteSymbol?.trim() || defaultQuoteSymbol(instrument);
}
