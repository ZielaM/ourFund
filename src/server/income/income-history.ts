import { Decimal } from "@/domain/decimal";
import {
  incomeByInstrument,
  incomeByMonth,
  incomeByYear,
  incomePayments,
  type IncomePayment,
} from "@/domain/income/history";
import { todayInWarsaw, utcToIsoDate } from "@/domain/portfolio/dates";
import { createLookup } from "@/domain/valuation/series";
import { REPORTING_CURRENCY, sumOrNull, type FxOn } from "@/domain/valuation/valuation";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { ledgerOrder, toLedgerEntry } from "@/server/portfolio/transactions";

export type IncomeHistoryView = {
  /** The year shown; the current one when the requested year has no payments to show. */
  year: number;
  /** Years that can be shown, newest first. Empty when nothing was ever received. */
  years: number[];
  /** Net income of the shown year in PLN; null when a rate is missing. */
  total: Decimal | null;
  /** Net income since the first payment. */
  allTime: Decimal | null;
  /** The twelve months of the shown year. */
  months: { month: number; net: Decimal | null }[];
  /** Every year since the first payment, oldest first. */
  byYear: { year: number; net: Decimal | null }[];
  /** The shown year by instrument, largest first. */
  byInstrument: { instrumentId: string | null; net: Decimal | null; count: number }[];
  /** Payments of the shown year, newest first. */
  payments: IncomePayment[];
  instruments: Record<string, { symbol: string; name: string }>;
  accounts: Record<string, { name: string; portfolioName: string }>;
  /** Currencies without an NBP rate for some payment of the shown year. */
  missingRates: string[];
};

/**
 * Dividends and interest the user received on all accounts of all their portfolios,
 * in PLN after withheld tax, with one year shown in detail.
 */
export async function getIncomeHistory(
  db: Db,
  actor: SessionUser,
  requestedYear: number | null,
  now: Date = new Date(),
): Promise<IncomeHistoryView> {
  const currentYear = Number(todayInWarsaw(now).slice(0, 4));
  const accounts = await db.account.findMany({
    where: { portfolio: { userId: actor.id } },
    select: { id: true, name: true, portfolio: { select: { name: true } } },
  });
  const rows = await db.transaction.findMany({
    where: {
      accountId: { in: accounts.map((account) => account.id) },
      type: { in: ["DIVIDEND", "INTEREST"] },
    },
    orderBy: [...ledgerOrder],
  });

  const instrumentIds = [
    ...new Set(rows.flatMap((row) => (row.instrumentId ? [row.instrumentId] : []))),
  ];
  const currencies = [...new Set(rows.map((row) => row.currency))].filter(
    (currency) => currency !== REPORTING_CURRENCY,
  );
  const [instruments, rates] = await Promise.all([
    db.instrument.findMany({
      where: { id: { in: instrumentIds } },
      select: { id: true, symbol: true, name: true },
    }),
    db.fxRate.findMany({ where: { currency: { in: currencies } } }),
  ]);

  const lookups = new Map(
    currencies.map((currency) => [
      currency,
      createLookup(
        rates
          .filter((rate) => rate.currency === currency)
          .map((rate) => ({
            date: utcToIsoDate(rate.date),
            value: new Decimal(rate.rate.toString()),
          })),
      ),
    ]),
  );
  const fxOn: FxOn = (currency, date) => lookups.get(currency)?.(date)?.value ?? null;

  const all = incomePayments(
    accounts.map((account) => ({
      accountId: account.id,
      entries: rows.filter((row) => row.accountId === account.id).map(toLedgerEntry),
    })),
    fxOn,
  );
  const byYear = incomeByYear(all, currentYear);
  const years = byYear.map((entry) => entry.year).reverse();
  const year =
    requestedYear !== null && years.includes(requestedYear) ? requestedYear : currentYear;
  const payments = all.filter((payment) => Number(payment.date.slice(0, 4)) === year);

  return {
    year,
    years,
    total: sumOrNull(payments.map((payment) => payment.netPln)),
    allTime: sumOrNull(all.map((payment) => payment.netPln)),
    months: incomeByMonth(all, year),
    byYear,
    byInstrument: incomeByInstrument(payments),
    payments,
    instruments: Object.fromEntries(
      instruments.map((instrument) => [
        instrument.id,
        { symbol: instrument.symbol, name: instrument.name },
      ]),
    ),
    accounts: Object.fromEntries(
      accounts.map((account) => [
        account.id,
        { name: account.name, portfolioName: account.portfolio.name },
      ]),
    ),
    missingRates: [
      ...new Set(
        payments.filter((payment) => payment.netPln === null).map((payment) => payment.currency),
      ),
    ].sort(),
  };
}
