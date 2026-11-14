import type { IsoDate } from "@/domain/portfolio/dates";

export type DatedValue<T> = {
  date: IsoDate;
  value: T;
};

/**
 * Builds a lookup that returns the last known value on or before a date. Prices and
 * exchange rates carry forward this way over weekends and holidays.
 */
export function createLookup<T>(
  points: readonly DatedValue<T>[],
): (date: IsoDate) => DatedValue<T> | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));

  return (date) => {
    let low = 0;
    let high = sorted.length - 1;
    let found: DatedValue<T> | null = null;

    while (low <= high) {
      const middle = (low + high) >> 1;
      if (sorted[middle].date <= date) {
        found = sorted[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return found;
  };
}
