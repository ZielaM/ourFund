import type { IsoDate } from "@/domain/portfolio/dates";

/** Polish retail treasury bonds (obligacje oszczędnościowe). One unit always costs 100 PLN. */
export const BOND_KINDS = ["OTS", "ROR", "DOR", "TOS", "COI", "EDO", "ROS", "ROD"] as const;

export type BondKind = (typeof BOND_KINDS)[number];

export const BOND_NOMINAL = 100;

export type BondRules = {
  /** Months from purchase to maturity. */
  termMonths: number;
  /** Length of one interest period in months. */
  periodMonths: number;
  /**
   * What happens to interest at the end of a period: it is added to the bond's value
   * ("capitalize") or paid out to the owner ("payout"). At maturity it is always paid.
   */
  interest: "capitalize" | "payout";
  /**
   * How the rate of the second and later periods is set: it stays as in the first period
   * ("fixed") or is announced for each period ("floating": reference rate or inflation,
   * plus the margin of the series).
   */
  rate: "fixed" | "floating";
  /** What the floating rate follows; shown to the user as a reminder of where to look it up. */
  follows: "none" | "nbpReferenceRate" | "inflation";
};

export const BOND_RULES: Record<BondKind, BondRules> = {
  OTS: { termMonths: 3, periodMonths: 3, interest: "payout", rate: "fixed", follows: "none" },
  ROR: {
    termMonths: 12,
    periodMonths: 1,
    interest: "payout",
    rate: "floating",
    follows: "nbpReferenceRate",
  },
  DOR: {
    termMonths: 24,
    periodMonths: 1,
    interest: "payout",
    rate: "floating",
    follows: "nbpReferenceRate",
  },
  TOS: { termMonths: 36, periodMonths: 12, interest: "capitalize", rate: "fixed", follows: "none" },
  COI: {
    termMonths: 48,
    periodMonths: 12,
    interest: "payout",
    rate: "floating",
    follows: "inflation",
  },
  ROS: {
    termMonths: 72,
    periodMonths: 12,
    interest: "capitalize",
    rate: "floating",
    follows: "inflation",
  },
  EDO: {
    termMonths: 120,
    periodMonths: 12,
    interest: "capitalize",
    rate: "floating",
    follows: "inflation",
  },
  ROD: {
    termMonths: 144,
    periodMonths: 12,
    interest: "capitalize",
    rate: "floating",
    follows: "inflation",
  },
};

/** A series symbol such as "EDO1135": the kind, then the month and year of maturity. */
export const BOND_SERIES_PATTERN = /^(OTS|ROR|DOR|TOS|COI|EDO|ROS|ROD)(0[1-9]|1[0-2])(\d{2})$/;

export function bondKindOf(series: string): BondKind | null {
  return (BOND_SERIES_PATTERN.exec(series)?.[1] as BondKind | undefined) ?? null;
}

export function periodCount(kind: BondKind): number {
  const { termMonths, periodMonths } = BOND_RULES[kind];
  return termMonths / periodMonths;
}

/** The fee rules changed for bonds bought from this day on. */
const FEE_CHANGE_DATE: IsoDate = "2024-09-01";

const EARLY_REDEMPTION_FEES: Record<BondKind, { before: string; since: string }> = {
  OTS: { before: "0", since: "0" },
  ROR: { before: "0.50", since: "0.50" },
  DOR: { before: "0.70", since: "0.70" },
  TOS: { before: "0.70", since: "1.00" },
  COI: { before: "0.70", since: "2.00" },
  ROS: { before: "0.70", since: "2.00" },
  EDO: { before: "2.00", since: "3.00" },
  ROD: { before: "2.00", since: "3.00" },
};

/** The fee per bond for redeeming before maturity, as a decimal string in PLN. */
export function earlyRedemptionFee(kind: BondKind, purchaseDate: IsoDate): string {
  const fees = EARLY_REDEMPTION_FEES[kind];
  return purchaseDate < FEE_CHANGE_DATE ? fees.before : fees.since;
}

const BOND_NAMES: Record<BondKind, string> = {
  OTS: "Obligacje 3-miesięczne",
  ROR: "Obligacje roczne",
  DOR: "Obligacje 2-letnie",
  TOS: "Obligacje 3-letnie",
  COI: "Obligacje 4-letnie",
  ROS: "Obligacje rodzinne 6-letnie",
  EDO: "Obligacje 10-letnie",
  ROD: "Obligacje rodzinne 12-letnie",
};

/** The name under which a series is listed in the catalogue, e.g. "Obligacje 10-letnie EDO1135". */
export function bondName(series: string): string | null {
  const kind = bondKindOf(series);
  return kind ? `${BOND_NAMES[kind]} ${series}` : null;
}
