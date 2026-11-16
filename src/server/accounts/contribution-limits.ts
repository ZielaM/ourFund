import {
  contributionLimit,
  contributionUsage,
  type ContributionUsage,
  type LimitedAccountType,
} from "@/domain/accounts/contribution-limits";
import { Decimal } from "@/domain/decimal";
import { todayInWarsaw, utcToIsoDate } from "@/domain/portfolio/dates";
import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";

export type ContributionLimitView = {
  type: LimitedAccountType;
  year: number;
  limit: Decimal;
  selfEmployedLimit: Decimal | null;
  usage: ContributionUsage;
  /** The accounts whose deposits were added up; the limit is one per person. */
  accounts: { id: string; name: string; portfolioName: string }[];
  /** None of those accounts has a deposit at all: contributions were probably not recorded. */
  noDeposits: boolean;
  /** The limit of the following year, once announced. */
  next: { year: number; limit: Decimal } | null;
};

const TYPES: LimitedAccountType[] = ["IKE", "IKZE"];

/**
 * This year's contribution limits of the actor's IKE and IKZE accounts and how much of them
 * the recorded deposits have used. A person may have one account of each kind, so accounts
 * of the same kind (for example before and after a transfer) share one limit.
 */
export async function getContributionLimits(
  db: PrismaClient,
  actor: SessionUser,
  now: Date = new Date(),
): Promise<ContributionLimitView[]> {
  const year = Number(todayInWarsaw(now).slice(0, 4));
  const accounts = await db.account.findMany({
    where: { type: { in: TYPES }, portfolio: { userId: actor.id } },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      portfolio: { select: { name: true } },
      transactions: {
        where: { type: "DEPOSIT" },
        select: { date: true, amount: true, currency: true },
      },
    },
  });

  return TYPES.flatMap((type) => {
    const own = accounts.filter((account) => account.type === type);
    const limits = contributionLimit(type, year);
    if (own.length === 0 || !limits) {
      return [];
    }

    const deposits = own.flatMap((account) =>
      account.transactions.map((row) => ({
        date: utcToIsoDate(row.date),
        amount: new Decimal(row.amount?.toString() ?? 0),
        currency: row.currency,
      })),
    );
    const next = contributionLimit(type, year + 1);

    return {
      type,
      year,
      ...limits,
      usage: contributionUsage(deposits, year, limits.limit),
      accounts: own.map((account) => ({
        id: account.id,
        name: account.name,
        portfolioName: account.portfolio.name,
      })),
      noDeposits: deposits.length === 0,
      next: next ? { year: year + 1, limit: next.limit } : null,
    };
  });
}
