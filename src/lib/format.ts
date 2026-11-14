import type { Decimal } from "@/domain/decimal";

const LOCALE = "pl-PL";

// Formatters receive exact decimal strings, so no precision is lost to floating point.
// Thousands are always grouped ("3 005,00"); by default Polish formatting only starts at 10 000.
function format(formatter: Intl.NumberFormat, value: Decimal, decimalPlaces: number): string {
  return formatter.format(value.toFixed(decimalPlaces) as Intl.StringNumericLiteral);
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** An amount of money with its currency, e.g. "1 234,56 zł" or "-12,00 USD". */
export function formatMoney(value: Decimal, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      useGrouping: "always",
      // "zł" for the home currency; unambiguous codes for the rest (never a bare "$").
      currencyDisplay: currency === "PLN" ? "symbol" : "code",
    });
    moneyFormatters.set(currency, formatter);
  }
  return format(formatter, value, 2);
}

const priceFormatter = new Intl.NumberFormat(LOCALE, {
  useGrouping: "always",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** A unit price: at least two decimal places, up to four when the price needs them. */
export function formatPrice(value: Decimal): string {
  return format(priceFormatter, value, 4);
}

const quantityFormatter = new Intl.NumberFormat(LOCALE, {
  useGrouping: "always",
  maximumFractionDigits: 10,
});

/** A number of units without trailing zeros, e.g. "10" or "0,12345678". */
export function formatQuantity(value: Decimal): string {
  return format(quantityFormatter, value, 10);
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** A calendar day ("YYYY-MM-DD") the way it is written in Poland: "13.11.2026". */
export function formatDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00.000Z`));
}

/** The plain text of a decimal for a form field, with a comma: "1234,5". */
export function toInputValue(value: Decimal): string {
  return value.toFixed().replace(".", ",");
}

const percentFormatter = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A ratio as a percentage with an explicit sign for gains: 0.1234 becomes "+12,34%". */
export function formatSignedPercent(ratio: number): string {
  const text = percentFormatter.format(ratio);
  return ratio > 0 ? `+${text}` : text;
}

const shareFormatter = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A share of a whole: 0.256 becomes "25,6%". */
export function formatShare(ratio: number): string {
  return shareFormatter.format(ratio);
}

const compactFormatter = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A short amount for chart axes: 12500 becomes "12,5 tys.". */
export function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

const wholeMoneyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "PLN",
  useGrouping: "always",
});

/** An amount in PLN given as a plain number (chart data), e.g. "1 234,56 zł". */
export function formatPln(value: number): string {
  return wholeMoneyFormatter.format(value);
}
