import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";

export type LimitedAccountType = "IKE" | "IKZE";

type YearLimits = {
  IKE: string;
  IKZE: string;
  /** IKZE of a person running a business; a separate, higher limit exists since 2021. */
  IKZE_SELF_EMPLOYED?: string;
};

/**
 * Yearly limits of contributions, in PLN, as announced in Monitor Polski. They follow the
 * forecast average wage of the year: three times it for IKE, 1.2 times for IKZE and
 * 1.8 times for IKZE of the self-employed. A new year is added here once it is announced
 * (usually in November).
 */
const LIMITS: Record<number, YearLimits> = {
  2019: { IKE: "14295", IKZE: "5718" },
  2020: { IKE: "15681", IKZE: "6272.40" },
  2021: { IKE: "15777", IKZE: "6310.80", IKZE_SELF_EMPLOYED: "9466.20" },
  2022: { IKE: "17766", IKZE: "7106.40", IKZE_SELF_EMPLOYED: "10659.60" },
  2023: { IKE: "20805", IKZE: "8322", IKZE_SELF_EMPLOYED: "12483" },
  2024: { IKE: "23472", IKZE: "9388.80", IKZE_SELF_EMPLOYED: "14083.20" },
  2025: { IKE: "26019", IKZE: "10407.60", IKZE_SELF_EMPLOYED: "15611.40" },
  2026: { IKE: "28260", IKZE: "11304", IKZE_SELF_EMPLOYED: "16956" },
  2027: { IKE: "30099", IKZE: "12039.60", IKZE_SELF_EMPLOYED: "18059.40" },
};

export type ContributionLimit = {
  limit: Decimal;
  /** IKZE only: the higher limit of a person running a business. */
  selfEmployedLimit: Decimal | null;
};

/** The limit of a year, or null for a year that is not in the table (yet). */
export function contributionLimit(
  type: LimitedAccountType,
  year: number,
): ContributionLimit | null {
  const limits = LIMITS[year];
  if (!limits) {
    return null;
  }

  return {
    limit: new Decimal(limits[type]),
    selfEmployedLimit:
      type === "IKZE" && limits.IKZE_SELF_EMPLOYED ? new Decimal(limits.IKZE_SELF_EMPLOYED) : null,
  };
}

export type CashDeposit = { date: IsoDate; amount: Decimal; currency: string };

export type ContributionUsage = {
  /** Deposits in PLN recorded in the year. */
  contributed: Decimal;
  /** Never below zero. */
  remaining: Decimal;
  exceeded: boolean;
  /** A deposit in another currency was left out: the total may be too low. */
  incomplete: boolean;
};

/**
 * How much of a year's limit the recorded deposits have used. Every deposit counts and a
 * withdrawal gives nothing back, as the law has it. A transfer from another account of the
 * same kind does not count against the limit, but cannot be told apart from a contribution
 * here: it has to be left out by whoever records it.
 */
export function contributionUsage(
  deposits: readonly CashDeposit[],
  year: number,
  limit: Decimal,
): ContributionUsage {
  const inYear = deposits.filter((deposit) => Number(deposit.date.slice(0, 4)) === year);
  const contributed = inYear
    .filter((deposit) => deposit.currency === "PLN")
    .reduce((sum, deposit) => sum.plus(deposit.amount), new Decimal(0));

  return {
    contributed,
    remaining: Decimal.max(limit.minus(contributed), new Decimal(0)),
    exceeded: contributed.gt(limit),
    incomplete: inYear.some((deposit) => deposit.currency !== "PLN"),
  };
}
