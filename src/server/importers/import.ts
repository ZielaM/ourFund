import { Decimal } from "@/domain/decimal";
import type { ImportedInstrument, ImportedOperation, ImportedReport } from "@/domain/import/types";
import { isoDateToUtc, type IsoDate } from "@/domain/portfolio/dates";
import { cashFlow, computeLedger, LedgerError, type LedgerEntry } from "@/domain/portfolio/ledger";
import { isTradable } from "@/domain/portfolio/naming";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { findOwnAccount } from "@/server/portfolio/portfolios";
import { loadAccountHistory, lockAccount, toLedgerEntry } from "@/server/portfolio/transactions";

const ZERO = new Decimal(0);

/** One operation that an import would add, as shown before it is confirmed. */
export type ImportRow = {
  date: IsoDate;
  type: ImportedOperation["type"];
  symbol: string | null;
  quantity: Decimal | null;
  price: Decimal | null;
  /** How the operation changes the account's cash. */
  cash: Decimal;
  currency: string;
  note: string | null;
};

export type NewInstrument = {
  symbol: string;
  market: string;
  name: string;
  type: "STOCK" | "ETF";
  currency: string;
};

/** What an import would do to an account. Nothing is written while planning. */
export type ImportPlan = {
  source: ImportedReport["source"];
  accountNumber: string;
  currency: string;
  /** Operations that would be added, oldest first. */
  rows: ImportRow[];
  /** Operations already imported from an earlier file. */
  duplicates: number;
  skipped: ImportedReport["skipped"];
  /** Instruments that would be added to the catalogue. */
  newInstruments: NewInstrument[];
  /** Symbols left out because the catalogue has them with another currency or as an index. */
  conflicts: string[];
  holdingMismatches: ImportedReport["holdingMismatches"];
  /** Why the import cannot go ahead: a sale of more than the account would hold. */
  problem: { symbol: string; date: IsoDate } | null;
};

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; reason: "accountNotFound" };

export type ImportResult =
  | { ok: true; imported: number; duplicates: number; instrumentsCreated: number }
  | { ok: false; reason: "accountNotFound" | "nothingToImport" }
  | { ok: false; reason: "insufficientQuantity"; symbol: string; date: IsoDate };

type Resolved = { id: string | null; create: NewInstrument | null };

type Prepared = {
  plan: ImportPlan;
  fresh: ImportedOperation[];
  /** Catalogue entry of each imported instrument: its id, or what has to be created. */
  resolved: Map<string, Resolved>;
};

const instrumentKey = (instrument: ImportedInstrument) =>
  `${instrument.symbol}|${instrument.markets[0]}`;

const placeholderId = (key: string) => `new:${key}`;

function toEntry(operation: ImportedOperation, instrumentId: string | null): LedgerEntry {
  const base = { id: `import:${operation.externalId}`, date: operation.date };

  switch (operation.type) {
    case "BUY":
    case "SELL":
      return {
        ...base,
        type: operation.type,
        instrumentId: instrumentId!,
        quantity: operation.quantity,
        price: operation.price,
        fee: ZERO,
        currency: operation.currency,
        fxRate: operation.fxRate,
      };
    case "DIVIDEND":
      return {
        ...base,
        type: "DIVIDEND",
        instrumentId: instrumentId!,
        amount: operation.amount,
        tax: operation.tax,
        currency: operation.currency,
      };
    case "INTEREST":
      return {
        ...base,
        type: "INTEREST",
        instrumentId: null,
        amount: operation.amount,
        tax: operation.tax,
        currency: operation.currency,
      };
    case "DEPOSIT":
    case "WITHDRAWAL":
    case "FEE":
      return {
        ...base,
        type: operation.type,
        amount: operation.amount,
        currency: operation.currency,
      };
  }
}

/** Works out what importing `report` into an account would add. Reads only. */
async function prepare(db: Db, accountId: string, report: ImportedReport): Promise<Prepared> {
  const [history, imported] = await Promise.all([
    loadAccountHistory(db, accountId),
    db.transaction.findMany({
      where: {
        accountId,
        source: report.source,
        externalId: { in: report.operations.map((operation) => operation.externalId) },
      },
      select: { externalId: true },
    }),
  ]);
  const known = new Set(imported.map((row) => row.externalId));
  const candidates = report.operations.filter((operation) => !known.has(operation.externalId));

  const wanted = new Map<string, ImportedInstrument>();
  for (const operation of candidates) {
    if ("instrument" in operation) {
      wanted.set(instrumentKey(operation.instrument), operation.instrument);
    }
  }

  const catalogue = await db.instrument.findMany({
    where: { symbol: { in: [...wanted.values()].map((instrument) => instrument.symbol) } },
    select: { id: true, symbol: true, market: true, currency: true, type: true },
  });

  const resolved = new Map<string, Resolved>();
  const conflicts = new Set<string>();
  const symbolById = new Map<string, string>();

  for (const [key, instrument] of wanted) {
    const existing = instrument.markets
      .map((market) =>
        catalogue.find((entry) => entry.symbol === instrument.symbol && entry.market === market),
      )
      .find((entry) => entry !== undefined);

    if (!existing) {
      resolved.set(key, {
        id: null,
        create: {
          symbol: instrument.symbol,
          market: instrument.markets[0],
          name: instrument.name,
          type: instrument.type,
          currency: instrument.currency,
        },
      });
      symbolById.set(placeholderId(key), instrument.symbol);
    } else if (existing.currency !== instrument.currency || !isTradable(existing.type)) {
      conflicts.add(instrument.symbol);
    } else {
      resolved.set(key, { id: existing.id, create: null });
      symbolById.set(existing.id, instrument.symbol);
    }
  }

  const fresh = candidates.filter(
    (operation) =>
      !("instrument" in operation) || resolved.has(instrumentKey(operation.instrument)),
  );
  const entryOf = (operation: ImportedOperation) => {
    if (!("instrument" in operation)) {
      return toEntry(operation, null);
    }
    const key = instrumentKey(operation.instrument);
    return toEntry(operation, resolved.get(key)!.id ?? placeholderId(key));
  };
  const entries = fresh.map(entryOf);

  // Entries already on the account come first within a day: they were recorded earlier.
  let problem: ImportPlan["problem"] = null;
  try {
    computeLedger([...history.map(toLedgerEntry), ...entries]);
  } catch (error) {
    if (!(error instanceof LedgerError)) {
      throw error;
    }
    const { instrumentId, transactionId } = error.details;
    const failing = entries.find((entry) => entry.id === transactionId);
    const existing = history.find((row) => row.id === transactionId);
    const symbol =
      symbolById.get(instrumentId) ??
      (await db.instrument.findUnique({ where: { id: instrumentId }, select: { symbol: true } }))
        ?.symbol ??
      "";

    problem = {
      symbol,
      date: failing?.date ?? (existing ? toLedgerEntry(existing).date : report.operations[0].date),
    };
  }

  return {
    fresh,
    resolved,
    plan: {
      source: report.source,
      accountNumber: report.accountNumber,
      currency: report.currency,
      rows: fresh.map((operation, index) => ({
        date: operation.date,
        type: operation.type,
        symbol: "instrument" in operation ? operation.instrument.symbol : null,
        quantity: "quantity" in operation ? operation.quantity : null,
        price: "price" in operation ? operation.price : null,
        cash: cashFlow(entries[index])!.amount,
        currency: operation.currency,
        note: operation.note,
      })),
      duplicates: report.operations.length - candidates.length,
      skipped: report.skipped,
      newInstruments: [...resolved.values()].flatMap((entry) =>
        entry.create ? [entry.create] : [],
      ),
      conflicts: [...conflicts].sort(),
      holdingMismatches: report.holdingMismatches,
      problem,
    },
  };
}

/** Shows what importing a report into the user's account would do, without changing anything. */
export async function planImport(
  db: Db,
  actor: SessionUser,
  accountId: string,
  report: ImportedReport,
): Promise<PlanResult> {
  if (!(await findOwnAccount(db, actor, accountId))) {
    return { ok: false, reason: "accountNotFound" };
  }
  return { ok: true, plan: (await prepare(db, accountId, report)).plan };
}

/**
 * Adds the operations of a report to the user's account, all or nothing. Operations that an
 * earlier import already added are left alone, so importing a longer report later is safe.
 */
export async function runImport(
  db: PrismaClient,
  actor: SessionUser,
  accountId: string,
  report: ImportedReport,
  now: Date = new Date(),
): Promise<ImportResult> {
  if (!(await findOwnAccount(db, actor, accountId))) {
    return { ok: false, reason: "accountNotFound" };
  }

  return db.$transaction(async (tx): Promise<ImportResult> => {
    await lockAccount(tx, accountId);
    const { plan, fresh, resolved } = await prepare(tx, accountId, report);

    if (plan.problem) {
      return { ok: false, reason: "insufficientQuantity", ...plan.problem };
    }
    if (fresh.length === 0) {
      return { ok: false, reason: "nothingToImport" };
    }

    let instrumentsCreated = 0;
    const instrumentIds = new Map<string, string>();
    for (const [key, entry] of resolved) {
      if (entry.id) {
        instrumentIds.set(key, entry.id);
        continue;
      }

      const { symbol, market } = entry.create!;
      // Another import may have added the instrument since it was looked up.
      const existing = await tx.instrument.findUnique({
        where: { symbol_market: { symbol, market } },
        select: { id: true },
      });
      const instrument =
        existing ??
        (await tx.instrument.create({
          data: { ...entry.create!, createdById: actor.id },
          select: { id: true },
        }));

      instrumentsCreated += existing ? 0 : 1;
      instrumentIds.set(key, instrument.id);
    }

    await tx.transaction.createMany({
      data: fresh.map((operation, index): Prisma.TransactionCreateManyInput => {
        const instrumentId =
          "instrument" in operation
            ? instrumentIds.get(instrumentKey(operation.instrument))!
            : null;

        return {
          accountId,
          type: operation.type,
          date: isoDateToUtc(operation.date),
          instrumentId,
          quantity: "quantity" in operation ? operation.quantity.toFixed() : null,
          price: "price" in operation ? operation.price.toFixed() : null,
          currency: operation.currency,
          fxRate: "fxRate" in operation ? operation.fxRate.toFixed() : "1",
          amount: "amount" in operation ? operation.amount.toFixed() : null,
          tax: "tax" in operation ? operation.tax.toFixed() : "0",
          note: operation.note,
          source: report.source,
          externalId: operation.externalId,
          // An account is replayed in the order entries were recorded: keep the file's order.
          createdAt: new Date(now.getTime() + index),
        };
      }),
    });

    return { ok: true, imported: fresh.length, duplicates: plan.duplicates, instrumentsCreated };
  });
}
