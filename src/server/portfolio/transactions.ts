import { Decimal } from "@/domain/decimal";
import { isoDateToUtc, todayInWarsaw, utcToIsoDate, type IsoDate } from "@/domain/portfolio/dates";
import { cashFlow, computeLedger, LedgerError, type LedgerEntry } from "@/domain/portfolio/ledger";
import type { TransactionInput } from "@/domain/portfolio/transaction-input";
import type { Prisma, PrismaClient, TransactionType } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { findOwnAccount, getPortfolio, isUuid } from "./portfolios";

type DecimalLike = { toString(): string };

/** The stored shape of a transaction, as far as the ledger is concerned. */
export type StoredTransaction = {
  id: string;
  type: TransactionType;
  date: Date;
  instrumentId: string | null;
  quantity: DecimalLike | null;
  price: DecimalLike | null;
  currency: string;
  fxRate: DecimalLike;
  amount: DecimalLike | null;
  fee: DecimalLike;
  tax: DecimalLike;
  splitRatio: DecimalLike | null;
};

export type TransactionView = {
  id: string;
  portfolioId: string;
  accountId: string;
  accountName: string;
  type: TransactionType;
  date: IsoDate;
  instrument: { id: string; symbol: string; name: string; currency: string } | null;
  quantity: Decimal | null;
  price: Decimal | null;
  currency: string;
  fxRate: Decimal;
  amount: Decimal | null;
  fee: Decimal;
  tax: Decimal;
  splitRatio: Decimal | null;
  note: string | null;
  /** How the transaction changed the account's cash; null for a split. */
  cash: { currency: string; amount: Decimal } | null;
};

export type SaveTransactionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "notFound"
        | "accountNotFound"
        | "instrumentNotFound"
        | "futureDate"
        | "insufficientQuantity";
    };

export type DeleteTransactionResult =
  { ok: true } | { ok: false; reason: "notFound" | "insufficientQuantity" };

function toDecimal(value: DecimalLike): Decimal {
  return new Decimal(value.toString());
}

function required<T>(value: T | null, field: string, id: string): T {
  if (value === null) {
    throw new Error(`Transaction ${id} is missing "${field}"`);
  }
  return value;
}

/** Converts a stored transaction into an entry the ledger engine understands. */
export function toLedgerEntry(row: StoredTransaction): LedgerEntry {
  const base = { id: row.id, date: utcToIsoDate(row.date) };

  switch (row.type) {
    case "BUY":
    case "SELL":
      return {
        ...base,
        type: row.type,
        instrumentId: required(row.instrumentId, "instrumentId", row.id),
        quantity: toDecimal(required(row.quantity, "quantity", row.id)),
        price: toDecimal(required(row.price, "price", row.id)),
        fee: toDecimal(row.fee),
        currency: row.currency,
        fxRate: toDecimal(row.fxRate),
      };
    case "DIVIDEND":
    case "INTEREST":
      return {
        ...base,
        type: row.type,
        instrumentId: row.instrumentId,
        amount: toDecimal(required(row.amount, "amount", row.id)),
        tax: toDecimal(row.tax),
        currency: row.currency,
      };
    case "FEE":
    case "DEPOSIT":
    case "WITHDRAWAL":
      return {
        ...base,
        type: row.type,
        amount: toDecimal(required(row.amount, "amount", row.id)),
        currency: row.currency,
      };
    case "SPLIT":
      return {
        ...base,
        type: row.type,
        instrumentId: required(row.instrumentId, "instrumentId", row.id),
        splitRatio: toDecimal(required(row.splitRatio, "splitRatio", row.id)),
      };
  }
}

/** Order in which an account's history is replayed: by date, then as recorded. */
export const ledgerOrder = [
  { date: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] as const satisfies Prisma.TransactionOrderByWithRelationInput[];

/** Values written to the database; decimals travel as exact strings. */
type TransactionData = {
  type: TransactionType;
  date: Date;
  instrumentId: string | null;
  quantity: string | null;
  price: string | null;
  currency: string;
  fxRate: string;
  amount: string | null;
  fee: string;
  tax: string;
  splitRatio: string | null;
  note: string | null;
};

type Normalized =
  { ok: true; data: TransactionData } | { ok: false; reason: "instrumentNotFound" | "futureDate" };

/** Fills in defaults that depend on the instrument and turns the input into stored values. */
async function normalize(db: Db, input: TransactionInput, now: Date): Promise<Normalized> {
  if (input.date > todayInWarsaw(now)) {
    return { ok: false, reason: "futureDate" };
  }

  const instrumentId = "instrumentId" in input ? input.instrumentId : null;
  const instrument = instrumentId
    ? await db.instrument.findUnique({ where: { id: instrumentId } })
    : null;

  if (instrumentId && !instrument) {
    return { ok: false, reason: "instrumentNotFound" };
  }

  const empty = {
    type: input.type,
    date: isoDateToUtc(input.date),
    instrumentId,
    quantity: null,
    price: null,
    fxRate: "1",
    amount: null,
    fee: "0",
    tax: "0",
    splitRatio: null,
    note: input.note,
  };

  switch (input.type) {
    case "BUY":
    case "SELL": {
      // `instrument` is set: trades always carry an instrument id.
      const instrumentCurrency = instrument!.currency;
      const currency = input.currency ?? instrumentCurrency;
      return {
        ok: true,
        data: {
          ...empty,
          quantity: input.quantity.toFixed(),
          price: input.price.toFixed(),
          fee: input.fee.toFixed(),
          currency,
          // A rate only makes sense when the account paid in another currency.
          fxRate: currency === instrumentCurrency ? "1" : input.fxRate.toFixed(),
        },
      };
    }
    case "DIVIDEND":
    case "INTEREST":
      return {
        ok: true,
        data: {
          ...empty,
          amount: input.amount.toFixed(),
          tax: input.tax.toFixed(),
          currency: input.currency,
        },
      };
    case "FEE":
    case "DEPOSIT":
    case "WITHDRAWAL":
      return {
        ok: true,
        data: { ...empty, amount: input.amount.toFixed(), currency: input.currency },
      };
    case "SPLIT":
      return {
        ok: true,
        data: {
          ...empty,
          splitRatio: input.splitRatio.toFixed(),
          currency: instrument!.currency,
        },
      };
  }
}

/** True when replaying the history never sells more than is held. */
function isConsistent(rows: readonly StoredTransaction[]): boolean {
  try {
    computeLedger(rows.map(toLedgerEntry));
    return true;
  } catch (error) {
    if (error instanceof LedgerError) {
      return false;
    }
    throw error;
  }
}

/** Serializes changes to one account, so two requests cannot both pass the consistency check. */
async function lockAccount(tx: Prisma.TransactionClient, accountId: string): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "accounts" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
}

function loadAccountHistory(tx: Prisma.TransactionClient, accountId: string) {
  return tx.transaction.findMany({ where: { accountId }, orderBy: [...ledgerOrder] });
}

export async function addTransaction(
  db: PrismaClient,
  actor: SessionUser,
  input: TransactionInput,
  now: Date = new Date(),
): Promise<SaveTransactionResult> {
  if (!(await findOwnAccount(db, actor, input.accountId))) {
    return { ok: false, reason: "accountNotFound" };
  }

  const normalized = await normalize(db, input, now);
  if (!normalized.ok) {
    return normalized;
  }

  return db.$transaction(async (tx) => {
    await lockAccount(tx, input.accountId);
    const history = await loadAccountHistory(tx, input.accountId);

    // Recorded last, so it also comes last among the entries of its day.
    if (!isConsistent([...history, { id: "new", ...normalized.data }])) {
      return { ok: false, reason: "insufficientQuantity" };
    }

    const created = await tx.transaction.create({
      data: { accountId: input.accountId, ...normalized.data },
    });
    return { ok: true, id: created.id };
  });
}

async function findOwnTransaction(db: Db, actor: SessionUser, transactionId: string) {
  if (!isUuid(transactionId)) {
    return null;
  }

  return db.transaction.findFirst({
    where: { id: transactionId, account: { portfolio: { userId: actor.id } } },
  });
}

/** Changes a transaction in place. It stays on its account; `input.accountId` is ignored. */
export async function updateTransaction(
  db: PrismaClient,
  actor: SessionUser,
  transactionId: string,
  input: TransactionInput,
  now: Date = new Date(),
): Promise<SaveTransactionResult> {
  const existing = await findOwnTransaction(db, actor, transactionId);
  if (!existing) {
    return { ok: false, reason: "notFound" };
  }

  const normalized = await normalize(db, input, now);
  if (!normalized.ok) {
    return normalized;
  }

  return db.$transaction(async (tx) => {
    await lockAccount(tx, existing.accountId);
    const history = await loadAccountHistory(tx, existing.accountId);
    const changed = history.map((row) =>
      row.id === transactionId ? { ...row, ...normalized.data } : row,
    );

    if (!isConsistent(changed)) {
      return { ok: false, reason: "insufficientQuantity" };
    }

    await tx.transaction.update({ where: { id: transactionId }, data: normalized.data });
    return { ok: true, id: transactionId };
  });
}

/** Deletes a transaction unless later sales depend on it. */
export async function deleteTransaction(
  db: PrismaClient,
  actor: SessionUser,
  transactionId: string,
): Promise<DeleteTransactionResult> {
  const existing = await findOwnTransaction(db, actor, transactionId);
  if (!existing) {
    return { ok: false, reason: "notFound" };
  }

  return db.$transaction(async (tx) => {
    await lockAccount(tx, existing.accountId);
    const history = await loadAccountHistory(tx, existing.accountId);

    if (!isConsistent(history.filter((row) => row.id !== transactionId))) {
      return { ok: false, reason: "insufficientQuantity" };
    }

    await tx.transaction.delete({ where: { id: transactionId } });
    return { ok: true };
  });
}

const viewInclude = {
  account: { select: { name: true, portfolioId: true } },
  instrument: { select: { id: true, symbol: true, name: true, currency: true } },
} as const;

type RowWithRelations = Prisma.TransactionGetPayload<{ include: typeof viewInclude }>;

function toView(row: RowWithRelations): TransactionView {
  const optional = (value: DecimalLike | null) => (value === null ? null : toDecimal(value));

  return {
    id: row.id,
    portfolioId: row.account.portfolioId,
    accountId: row.accountId,
    accountName: row.account.name,
    type: row.type,
    date: utcToIsoDate(row.date),
    instrument: row.instrument,
    quantity: optional(row.quantity),
    price: optional(row.price),
    currency: row.currency,
    fxRate: toDecimal(row.fxRate),
    amount: optional(row.amount),
    fee: toDecimal(row.fee),
    tax: toDecimal(row.tax),
    splitRatio: optional(row.splitRatio),
    note: row.note,
    cash: cashFlow(toLedgerEntry(row)),
  };
}

/** A portfolio's transactions, newest first; null when the portfolio is not the user's. */
export async function listTransactions(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
): Promise<TransactionView[] | null> {
  if (!(await getPortfolio(db, actor, portfolioId))) {
    return null;
  }

  const rows = await db.transaction.findMany({
    where: { account: { portfolioId } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    include: viewInclude,
  });

  return rows.map(toView);
}

export async function getTransaction(
  db: Db,
  actor: SessionUser,
  transactionId: string,
): Promise<TransactionView | null> {
  if (!isUuid(transactionId)) {
    return null;
  }

  const row = await db.transaction.findFirst({
    where: { id: transactionId, account: { portfolio: { userId: actor.id } } },
    include: viewInclude,
  });

  return row ? toView(row) : null;
}
