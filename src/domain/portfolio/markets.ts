/** Where an instrument is listed. Together with the symbol it identifies the instrument. */
export const MARKETS = [
  "GPW",
  "NEWCONNECT",
  "CATALYST",
  "XETRA",
  "LSE",
  "EURONEXT",
  "NYSE",
  "NASDAQ",
  "CRYPTO",
  "SKARB",
  "OTHER",
] as const;

/** Retail treasury bonds are not listed anywhere; this code stands for "bought from the state". */
export const TREASURY_MARKET = "SKARB";

export type Market = (typeof MARKETS)[number];

export function isMarket(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value);
}

/** Markets a user can pick when adding an instrument by hand; bonds have their own form. */
export const LISTED_MARKETS = MARKETS.filter((market) => market !== TREASURY_MARKET);

/** Markets run in Poland: a Polish payer withholds the tax on dividends of what is listed here. */
const DOMESTIC_MARKETS: readonly string[] = ["GPW", "NEWCONNECT", "CATALYST", TREASURY_MARKET];

export function isDomesticMarket(market: string): boolean {
  return DOMESTIC_MARKETS.includes(market);
}
