import { Decimal } from "@/domain/decimal";

// Regular, non-breaking and narrow non-breaking spaces, all used as thousands separators.
const SPACES = /[\s  ]/g;
const NUMBER_PATTERN = /^\d+(?:[.,]\d+)?$/;

/**
 * Parses a number typed by a user: "1 234,56" and "1234.56" both mean the same.
 * A comma or a dot is always the decimal separator; only spaces may group thousands.
 * Returns null for anything else, including negative numbers and empty input.
 */
export function parseDecimalInput(raw: string): Decimal | null {
  const compact = raw.replace(SPACES, "");

  if (!NUMBER_PATTERN.test(compact)) {
    return null;
  }

  return new Decimal(compact.replace(",", "."));
}
