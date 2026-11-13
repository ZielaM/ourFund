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
  "OTHER",
] as const;

export type Market = (typeof MARKETS)[number];

export function isMarket(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value);
}
