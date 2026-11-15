import { Decimal } from "@/domain/decimal";
import { addDays } from "@/domain/market-data/nbp";
import type { IsoDate } from "@/domain/portfolio/dates";
import { BOND_RULES, BOND_SERIES_PATTERN, periodCount, type BondKind } from "./kinds";

/** A calendar month; `month` is 1 for January. */
export type YearMonth = { year: number; month: number };

export function monthKey({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonths({ year, month }: YearMonth, by: number): YearMonth {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * The month in which a series was on sale. The symbol names the month of maturity
 * ("EDO1135" matures in November 2035), and a series is sold for one calendar month.
 */
export function saleMonth(series: string): YearMonth | null {
  const match = BOND_SERIES_PATTERN.exec(series);
  if (!match) {
    return null;
  }

  const kind = match[1] as BondKind;
  const maturity = { year: 2000 + Number(match[3]), month: Number(match[2]) };
  return shiftMonths(maturity, -BOND_RULES[kind].termMonths);
}

/** The calendar month in which an interest period starts, whatever the day of purchase. */
export function periodStartMonth(series: string, period: number): YearMonth | null {
  const sold = saleMonth(series);
  const kind = BOND_SERIES_PATTERN.exec(series)?.[1] as BondKind | undefined;
  if (!sold || !kind) {
    return null;
  }
  return shiftMonths(sold, (period - 1) * BOND_RULES[kind].periodMonths);
}

/** Easter Sunday by the anonymous Gregorian algorithm. */
function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const FIXED_HOLIDAYS = [
  "01-01",
  "01-06",
  "05-01",
  "05-03",
  "08-15",
  "11-01",
  "11-11",
  "12-25",
  "12-26",
];

/** Days off work by Polish law, other than Sundays: fixed dates, Easter Monday, Corpus Christi. */
export function isPolishHoliday(date: IsoDate): boolean {
  const year = Number(date.slice(0, 4));
  const monthDay = date.slice(5);
  if (FIXED_HOLIDAYS.includes(monthDay)) {
    return true;
  }
  // Christmas Eve has been a day off since 2025.
  if (monthDay === "12-24" && year >= 2025) {
    return true;
  }

  const easter = easterSunday(year);
  return date === addDays(easter, 1) || date === addDays(easter, 60);
}

export function isBusinessDay(date: IsoDate): boolean {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isPolishHoliday(date);
}

/** The `count`-th business day before `date` (1 is the last business day before it). */
export function businessDaysBefore(date: IsoDate, count: number): IsoDate {
  let day = date;
  for (let found = 0; found < count;) {
    day = addDays(day, -1);
    if (isBusinessDay(day)) {
      found += 1;
    }
  }
  return day;
}

/** What floating rates follow, as published by GUS and NBP. All values are in percent. */
export type IndexData = {
  /** Yearly change of consumer prices for a month, keyed like "2026-09". */
  inflation: ReadonlyMap<string, Decimal>;
  /** Changes of the NBP reference rate, oldest first. */
  referenceRates: readonly { validFrom: IsoDate; rate: Decimal }[];
};

const ZERO = new Decimal(0);

/**
 * The yearly rates (in percent) of the second and later periods of a series, for every
 * period whose rate can already be worked out. The rules are those of the issue letters:
 *
 * - inflation-linked bonds: the yearly change of consumer prices "announced by the President
 *   of GUS in the month preceding the first month of the period" plus the margin. GUS
 *   announces a month's figure in the middle of the next one, so that is the reading for
 *   two months before the period starts;
 * - bonds linked to the NBP reference rate: the rate "in force on the tenth business day
 *   before the first day of the calendar month in which the period starts" plus the margin.
 *
 * An index below zero counts as zero. The Ministry announces the same rates before each
 * period; an announced rate entered by hand should always win over these.
 */
export function indexedRates(
  series: string,
  margin: Decimal | null,
  data: IndexData,
  today: IsoDate,
): Map<number, Decimal> {
  const rates = new Map<number, Decimal>();
  const kind = BOND_SERIES_PATTERN.exec(series)?.[1] as BondKind | undefined;
  if (!kind || !margin || BOND_RULES[kind].rate !== "floating") {
    return rates;
  }

  for (let period = 2; period <= periodCount(kind); period += 1) {
    const start = periodStartMonth(series, period);
    if (!start) {
      break;
    }

    let index: Decimal | undefined;
    if (BOND_RULES[kind].follows === "inflation") {
      index = data.inflation.get(monthKey(shiftMonths(start, -2)));
    } else {
      const day = businessDaysBefore(`${monthKey(start)}-01`, 10);
      if (day <= today) {
        index = data.referenceRates.findLast((change) => change.validFrom <= day)?.rate;
      }
    }

    if (index) {
      rates.set(period, Decimal.max(index, ZERO).plus(margin));
    }
  }

  return rates;
}
