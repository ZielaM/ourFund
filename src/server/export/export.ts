import { APP_NAME } from "@/config/app";
import { Decimal } from "@/domain/decimal";
import { csvNumber, csvText, toCsv } from "@/domain/export/csv";
import { utcToIsoDate, type IsoDate } from "@/domain/portfolio/dates";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { ledgerOrder } from "@/server/portfolio/transactions";

/** Changes whenever the shape of the exported document changes. */
export const EXPORT_VERSION = 1;

type InstrumentKey = { symbol: string; market: string };

export type ExportedTransaction = {
  date: IsoDate;
  type: string;
  instrument: InstrumentKey | null;
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

export type ExportedInstrument = InstrumentKey & {
  name: string;
  type: string;
  currency: string;
  priceSource: string;
  quoteSymbol: string | null;
  /** Terms of a retail treasury bond series; rates in percent. */
  bond: {
    kind: string;
    firstRate: string;
    margin: string | null;
    rates: { period: number; rate: string }[];
  } | null;
  /** Prices entered by hand; downloaded quotes are not part of a user's data. */
  manualPrices: { date: IsoDate; close: string }[];
};

/** Everything a user entered, in a form that does not depend on database identifiers. */
export type ExportDocument = {
  app: string;
  version: number;
  exportedAt: string;
  username: string;
  portfolios: {
    name: string;
    benchmark: InstrumentKey | null;
    accounts: {
      name: string;
      type: string;
      institution: string | null;
      transactions: ExportedTransaction[];
    }[];
  }[];
  /** The instruments the portfolios refer to. */
  instruments: ExportedInstrument[];
};

type DecimalLike = { toString(): string };
const plain = (value: DecimalLike) => new Decimal(value.toString()).toFixed();
const plainOrNull = (value: DecimalLike | null) => (value === null ? null : plain(value));

async function loadPortfolios(db: Db, actor: SessionUser) {
  return db.portfolio.findMany({
    where: { userId: actor.id },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    include: {
      benchmark: { select: { symbol: true, market: true } },
      accounts: {
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        include: {
          transactions: {
            orderBy: [...ledgerOrder],
            include: { instrument: { select: { symbol: true, market: true, name: true } } },
          },
        },
      },
    },
  });
}

/** A full copy of the user's data as one JSON document. */
export async function exportData(
  db: Db,
  actor: SessionUser,
  now: Date = new Date(),
): Promise<ExportDocument> {
  const portfolios = await loadPortfolios(db, actor);

  const instrumentIds = new Set<string>();
  for (const portfolio of portfolios) {
    if (portfolio.benchmarkInstrumentId) {
      instrumentIds.add(portfolio.benchmarkInstrumentId);
    }
    for (const account of portfolio.accounts) {
      for (const transaction of account.transactions) {
        if (transaction.instrumentId) {
          instrumentIds.add(transaction.instrumentId);
        }
      }
    }
  }

  const instruments = await db.instrument.findMany({
    where: { id: { in: [...instrumentIds] } },
    orderBy: [{ symbol: "asc" }, { market: "asc" }],
    include: {
      bondSeries: { include: { rates: { orderBy: { period: "asc" } } } },
      prices: { where: { source: "MANUAL" }, orderBy: { date: "asc" } },
    },
  });

  return {
    app: APP_NAME,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    username: actor.username,
    portfolios: portfolios.map((portfolio) => ({
      name: portfolio.name,
      benchmark: portfolio.benchmark,
      accounts: portfolio.accounts.map((account) => ({
        name: account.name,
        type: account.type,
        institution: account.institution,
        transactions: account.transactions.map((transaction) => ({
          date: utcToIsoDate(transaction.date),
          type: transaction.type,
          instrument: transaction.instrument
            ? { symbol: transaction.instrument.symbol, market: transaction.instrument.market }
            : null,
          quantity: plainOrNull(transaction.quantity),
          price: plainOrNull(transaction.price),
          currency: transaction.currency,
          fxRate: plain(transaction.fxRate),
          amount: plainOrNull(transaction.amount),
          fee: plain(transaction.fee),
          tax: plain(transaction.tax),
          splitRatio: plainOrNull(transaction.splitRatio),
          note: transaction.note,
        })),
      })),
    })),
    instruments: instruments.map((instrument) => ({
      symbol: instrument.symbol,
      market: instrument.market,
      name: instrument.name,
      type: instrument.type,
      currency: instrument.currency,
      priceSource: instrument.priceSource,
      quoteSymbol: instrument.quoteSymbol,
      bond: instrument.bondSeries
        ? {
            kind: instrument.bondSeries.kind,
            firstRate: plain(instrument.bondSeries.firstRate),
            margin: plainOrNull(instrument.bondSeries.margin),
            rates: instrument.bondSeries.rates.map((rate) => ({
              period: rate.period,
              rate: plain(rate.rate),
            })),
          }
        : null,
      manualPrices: instrument.prices.map((price) => ({
        date: utcToIsoDate(price.date),
        close: plain(price.close),
      })),
    })),
  };
}

/** Column names of the transactions file, in the given order. */
export type TransactionCsvLabels = {
  columns: Record<
    | "date"
    | "portfolio"
    | "account"
    | "type"
    | "symbol"
    | "market"
    | "name"
    | "quantity"
    | "price"
    | "currency"
    | "fxRate"
    | "amount"
    | "fee"
    | "tax"
    | "splitRatio"
    | "note",
    string
  >;
  /** Display names of transaction types, e.g. BUY -> "Kupno". */
  types: Record<string, string>;
};

/** All transactions of the user as a CSV file for a spreadsheet, oldest first. */
export async function exportTransactionsCsv(
  db: Db,
  actor: SessionUser,
  labels: TransactionCsvLabels,
): Promise<string> {
  const portfolios = await loadPortfolios(db, actor);
  const number = (value: DecimalLike | null) =>
    csvNumber(value === null ? null : new Decimal(value.toString()));

  const rows = portfolios
    .flatMap((portfolio) =>
      portfolio.accounts.flatMap((account) =>
        account.transactions.map((transaction) => ({
          date: utcToIsoDate(transaction.date),
          cells: [
            utcToIsoDate(transaction.date),
            csvText(portfolio.name),
            csvText(account.name),
            labels.types[transaction.type] ?? transaction.type,
            csvText(transaction.instrument?.symbol ?? null),
            transaction.instrument?.market ?? "",
            csvText(transaction.instrument?.name ?? null),
            number(transaction.quantity),
            number(transaction.price),
            transaction.currency,
            number(transaction.fxRate),
            number(transaction.amount),
            number(transaction.fee),
            number(transaction.tax),
            number(transaction.splitRatio),
            csvText(transaction.note),
          ],
        })),
      ),
    )
    // A stable sort: within a day the order of portfolios, accounts and entry is kept.
    .sort((a, b) => a.date.localeCompare(b.date));

  const { columns } = labels;
  return toCsv(
    [
      columns.date,
      columns.portfolio,
      columns.account,
      columns.type,
      columns.symbol,
      columns.market,
      columns.name,
      columns.quantity,
      columns.price,
      columns.currency,
      columns.fxRate,
      columns.amount,
      columns.fee,
      columns.tax,
      columns.splitRatio,
      columns.note,
    ],
    rows.map((row) => row.cells),
  );
}
