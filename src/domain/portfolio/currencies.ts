/** ISO 4217 codes the app accepts. PLN first: it is the reporting currency. */
export const CURRENCIES = [
  "PLN",
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "HUF",
  "CAD",
  "AUD",
  "JPY",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}
