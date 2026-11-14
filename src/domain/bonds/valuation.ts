import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";
import { BOND_NOMINAL, BOND_RULES, periodCount, type BondKind } from "./kinds";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOMINAL = new Decimal(BOND_NOMINAL);

export type BondSeries = {
  kind: BondKind;
  /** Yearly rate of the first interest period, as a fraction (0.0535 for 5.35%). */
  firstRate: Decimal;
  /**
   * Announced yearly rates of later periods, by period number (2 is the second period).
   * A period without an entry uses the rate of the last period that has one.
   */
  laterRates: ReadonlyMap<number, Decimal>;
};

export type BondPeriod = {
  /** 1 for the first period. */
  number: number;
  start: IsoDate;
  /** The first day of the next period; interest for this period is due on this day. */
  end: IsoDate;
};

/** `date` moved by whole months, keeping the day of the month where that month has it. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));

  return target.toISOString().slice(0, 10);
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * The interest periods of a bond bought on `purchaseDate`. Periods are counted from the day
 * of purchase: every period ends the same day of the month, or on the last day of a month
 * that is shorter.
 */
export function bondPeriods(kind: BondKind, purchaseDate: IsoDate): BondPeriod[] {
  const { periodMonths } = BOND_RULES[kind];

  return Array.from({ length: periodCount(kind) }, (_, index) => ({
    number: index + 1,
    start: addMonths(purchaseDate, index * periodMonths),
    end: addMonths(purchaseDate, (index + 1) * periodMonths),
  }));
}

export function maturityDate(kind: BondKind, purchaseDate: IsoDate): IsoDate {
  return addMonths(purchaseDate, BOND_RULES[kind].termMonths);
}

/** The yearly rate of a period and whether it was announced or carried over from an earlier one. */
export function periodRate(series: BondSeries, period: number): { rate: Decimal; known: boolean } {
  if (period === 1 || BOND_RULES[series.kind].rate === "fixed") {
    return { rate: series.firstRate, known: true };
  }

  for (let number = period; number >= 2; number--) {
    const rate = series.laterRates.get(number);
    if (rate) {
      return { rate, known: number === period };
    }
  }

  return { rate: series.firstRate, known: false };
}

/** Interest for a whole period on `base`, rounded to the grosz as the issuer does. */
function fullPeriodInterest(base: Decimal, yearlyRate: Decimal, periodMonths: number): Decimal {
  return base.times(yearlyRate).times(periodMonths).div(12).toDecimalPlaces(2);
}

export type BondValue = {
  /** Value of one bond: what it is worth with the interest accrued so far, before tax. */
  value: Decimal;
  /** Interest accrued in the current period and not yet paid or capitalized. */
  accrued: Decimal;
  /** Number of the period `date` falls in. */
  period: number;
  /** False when a rate needed for the valuation has not been entered yet. */
  ratesKnown: boolean;
  matured: boolean;
};

/**
 * What one bond bought on `purchaseDate` is worth on `date`.
 *
 * Interest accrues day by day within a period, in proportion to the days elapsed. At the
 * end of a period it is either added to the bond's value (capitalizing kinds) or paid out
 * (the value then returns to 100 PLN). From maturity on the value no longer changes: it is
 * the amount paid at redemption.
 */
export function bondValue(series: BondSeries, purchaseDate: IsoDate, date: IsoDate): BondValue {
  const rules = BOND_RULES[series.kind];
  const periods = bondPeriods(series.kind, purchaseDate);
  const matured = date >= periods.at(-1)!.end;

  // Before the purchase there is nothing to accrue.
  if (date <= purchaseDate) {
    return { value: NOMINAL, accrued: new Decimal(0), period: 1, ratesKnown: true, matured: false };
  }

  let base = NOMINAL;
  let ratesKnown = true;

  for (const period of periods) {
    const { rate, known } = periodRate(series, period.number);
    const interest = fullPeriodInterest(base, rate, rules.periodMonths);
    const isLast = period.number === periods.length;
    const current = date < period.end || (isLast && matured);
    ratesKnown &&= known;

    if (current) {
      const elapsed = matured
        ? 1
        : daysBetween(period.start, date) / daysBetween(period.start, period.end);
      const accrued = matured
        ? interest
        : base.times(rate).times(rules.periodMonths).div(12).times(elapsed).toDecimalPlaces(2);

      return { value: base.plus(accrued), accrued, period: period.number, ratesKnown, matured };
    }

    if (rules.interest === "capitalize") {
      base = base.plus(interest);
    }
  }

  // Unreachable: the last period always matches above.
  throw new Error("bond valuation fell through its periods");
}

/** Interest paid to the owner at the end of a period, per bond; zero for capitalizing kinds. */
export function periodPayout(series: BondSeries, period: number): Decimal {
  const rules = BOND_RULES[series.kind];
  if (rules.interest !== "payout") {
    return new Decimal(0);
  }

  return fullPeriodInterest(NOMINAL, periodRate(series, period).rate, rules.periodMonths);
}
