import { z } from "zod";
import { Decimal } from "@/domain/decimal";
import { isIsoDate, type IsoDate } from "@/domain/portfolio/dates";

export type DailyRate = {
  date: IsoDate;
  /** PLN per one unit of the currency. */
  rate: Decimal;
};

const ratesSchema = z.object({
  rates: z.array(
    z.object({
      effectiveDate: z.string().refine(isIsoDate),
      mid: z.number().positive(),
    }),
  ),
});

/** Reads the average rates out of an NBP "table A" response; null when it is not one. */
export function parseNbpRates(json: unknown): DailyRate[] | null {
  const parsed = ratesSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }

  return parsed.data.rates.map(({ effectiveDate, mid }) => ({
    date: effectiveDate,
    // NBP publishes at most six decimal places; this also drops binary float noise.
    rate: new Decimal(mid).toDecimalPlaces(8),
  }));
}

/** The NBP API accepts ranges of at most 367 days; longer periods are fetched in pieces. */
export const NBP_MAX_RANGE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Splits [from, to] into consecutive ranges no longer than `maxDays` days each. */
export function splitDateRange(
  from: IsoDate,
  to: IsoDate,
  maxDays: number = NBP_MAX_RANGE_DAYS,
): { from: IsoDate; to: IsoDate }[] {
  const ranges: { from: IsoDate; to: IsoDate }[] = [];
  let start = from;

  while (start <= to) {
    const end = addDays(start, maxDays - 1);
    ranges.push({ from: start, to: end < to ? end : to });
    start = addDays(end, 1);
  }

  return ranges;
}
