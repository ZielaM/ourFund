/** A calendar day as "YYYY-MM-DD". Transactions have dates, not moments in time. */
export type IsoDate = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The earliest date a transaction may have; guards against typos like year 0202. */
export const EARLIEST_DATE: IsoDate = "1990-01-01";

export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  // Rejects days that do not exist, such as 2026-02-30.
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Today's date for users of the app, who live by Polish time. */
export function todayInWarsaw(now: Date): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Converts between "YYYY-MM-DD" and the UTC-midnight Date used for SQL DATE columns. */
export function isoDateToUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function utcToIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}
