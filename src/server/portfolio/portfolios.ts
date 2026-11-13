import { z } from "zod";
import type { AccountInput, PortfolioInput } from "@/domain/portfolio/naming";
import { Prisma, type AccountType } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";

export type AccountSummary = {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  transactionCount: number;
};

export type PortfolioSummary = {
  id: string;
  name: string;
  accountCount: number;
  transactionCount: number;
};

export type PortfolioDetail = {
  id: string;
  name: string;
  accounts: AccountSummary[];
};

export type SavePortfolioResult =
  { ok: true; id: string } | { ok: false; reason: "notFound" | "nameTaken" };

export type DeleteAccountResult =
  { ok: true } | { ok: false; reason: "notFound" | "hasTransactions" };

export function isUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The user's portfolios, oldest first. Other users' portfolios are never visible. */
export async function listPortfolios(db: Db, actor: SessionUser): Promise<PortfolioSummary[]> {
  const portfolios = await db.portfolio.findMany({
    where: { userId: actor.id },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    include: { accounts: { select: { _count: { select: { transactions: true } } } } },
  });

  return portfolios.map((portfolio) => ({
    id: portfolio.id,
    name: portfolio.name,
    accountCount: portfolio.accounts.length,
    transactionCount: portfolio.accounts.reduce(
      (total, account) => total + account._count.transactions,
      0,
    ),
  }));
}

/** A portfolio with its accounts, or null when it does not exist or belongs to someone else. */
export async function getPortfolio(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
): Promise<PortfolioDetail | null> {
  if (!isUuid(portfolioId)) {
    return null;
  }

  const portfolio = await db.portfolio.findFirst({
    where: { id: portfolioId, userId: actor.id },
    include: {
      accounts: {
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        include: { _count: { select: { transactions: true } } },
      },
    },
  });

  if (!portfolio) {
    return null;
  }

  return {
    id: portfolio.id,
    name: portfolio.name,
    accounts: portfolio.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      institution: account.institution,
      transactionCount: account._count.transactions,
    })),
  };
}

export async function createPortfolio(
  db: Db,
  actor: SessionUser,
  input: PortfolioInput,
): Promise<SavePortfolioResult> {
  try {
    const portfolio = await db.portfolio.create({ data: { userId: actor.id, name: input.name } });
    return { ok: true, id: portfolio.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "nameTaken" };
    }
    throw error;
  }
}

export async function renamePortfolio(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
  input: PortfolioInput,
): Promise<SavePortfolioResult> {
  if (!(await getPortfolio(db, actor, portfolioId))) {
    return { ok: false, reason: "notFound" };
  }

  try {
    await db.portfolio.update({ where: { id: portfolioId }, data: { name: input.name } });
    return { ok: true, id: portfolioId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "nameTaken" };
    }
    throw error;
  }
}

/** Deletes a portfolio together with its accounts and transactions. */
export async function deletePortfolio(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
): Promise<{ ok: true } | { ok: false; reason: "notFound" }> {
  if (!isUuid(portfolioId)) {
    return { ok: false, reason: "notFound" };
  }

  const { count } = await db.portfolio.deleteMany({
    where: { id: portfolioId, userId: actor.id },
  });

  return count > 0 ? { ok: true } : { ok: false, reason: "notFound" };
}

export async function createAccount(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
  input: AccountInput,
): Promise<SavePortfolioResult> {
  if (!(await getPortfolio(db, actor, portfolioId))) {
    return { ok: false, reason: "notFound" };
  }

  try {
    const account = await db.account.create({ data: { portfolioId, ...input } });
    return { ok: true, id: account.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "nameTaken" };
    }
    throw error;
  }
}

/** Finds an account the user owns. */
export async function findOwnAccount(db: Db, actor: SessionUser, accountId: string) {
  if (!isUuid(accountId)) {
    return null;
  }

  return db.account.findFirst({
    where: { id: accountId, portfolio: { userId: actor.id } },
  });
}

export async function updateAccount(
  db: Db,
  actor: SessionUser,
  accountId: string,
  input: AccountInput,
): Promise<SavePortfolioResult> {
  if (!(await findOwnAccount(db, actor, accountId))) {
    return { ok: false, reason: "notFound" };
  }

  try {
    await db.account.update({ where: { id: accountId }, data: input });
    return { ok: true, id: accountId };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "nameTaken" };
    }
    throw error;
  }
}

/** Only an empty account can be deleted, so that a history is never lost by one click. */
export async function deleteAccount(
  db: Db,
  actor: SessionUser,
  accountId: string,
): Promise<DeleteAccountResult> {
  if (!(await findOwnAccount(db, actor, accountId))) {
    return { ok: false, reason: "notFound" };
  }

  if ((await db.transaction.count({ where: { accountId } })) > 0) {
    return { ok: false, reason: "hasTransactions" };
  }

  await db.account.delete({ where: { id: accountId } });
  return { ok: true };
}
