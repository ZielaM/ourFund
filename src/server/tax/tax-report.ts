import { Decimal } from "@/domain/decimal";
import { todayInWarsaw, utcToIsoDate } from "@/domain/portfolio/dates";
import { isDomesticMarket } from "@/domain/portfolio/markets";
import { createLookup } from "@/domain/valuation/series";
import { REPORTING_CURRENCY } from "@/domain/valuation/valuation";
import {
  computeTaxYears,
  type RateLookup,
  type TaxInstrument,
  type TaxYear,
} from "@/domain/tax/pit38";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import { ledgerOrder, toLedgerEntry } from "@/server/portfolio/transactions";

/** Accounts whose income is settled in the yearly return. */
const TAXABLE_ACCOUNT_TYPE = "STANDARD";

export type TaxReportView = {
  /** The year shown; the current one when the requested year has no report. */
  year: number;
  /** Years that can be shown, newest first. Empty when the user has no taxable transactions. */
  years: number[];
  /** Null when there is nothing to report at all. */
  report: TaxYear | null;
  /** Result on securities of the five years before `year`: losses can still be deducted. */
  earlierYears: { year: number; income: TaxYear["securities"]["income"] }[];
  instruments: Record<string, { symbol: string; name: string }>;
  accounts: Record<string, { name: string; portfolioName: string }>;
  /** Accounts left out because their income is not taxed this way. */
  excludedAccounts: { name: string; portfolioName: string; type: "IKE" | "IKZE" | "OKI" }[];
};

/**
 * Figures for the user's PIT-38 return of one year, across all their portfolios: a tax
 * return is filed by a person, not by a portfolio.
 */
export async function getTaxReport(
  db: Db,
  actor: SessionUser,
  requestedYear: number | null,
  now: Date = new Date(),
): Promise<TaxReportView> {
  const currentYear = Number(todayInWarsaw(now).slice(0, 4));
  const accounts = await db.account.findMany({
    where: { portfolio: { userId: actor.id } },
    orderBy: [{ portfolio: { createdAt: "asc" } }, { createdAt: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, portfolio: { select: { name: true } } },
  });

  const taxable = accounts.filter((account) => account.type === TAXABLE_ACCOUNT_TYPE);
  const rows = await db.transaction.findMany({
    where: { accountId: { in: taxable.map((account) => account.id) } },
    orderBy: [...ledgerOrder],
  });

  const instrumentIds = [
    ...new Set(rows.flatMap((row) => (row.instrumentId ? [row.instrumentId] : []))),
  ];
  const instruments = await db.instrument.findMany({
    where: { id: { in: instrumentIds } },
    select: {
      id: true,
      symbol: true,
      name: true,
      market: true,
      type: true,
      currency: true,
      priceSource: true,
    },
  });
  const taxInstruments = new Map(
    instruments.map((instrument): [string, TaxInstrument] => [
      instrument.id,
      {
        currency: instrument.currency,
        category:
          instrument.type === "CRYPTO"
            ? "crypto"
            : instrument.priceSource === "TREASURY"
              ? "savingsBond"
              : instrument.type === "COMMODITY"
                ? "commodity"
                : "security",
        foreign: !isDomesticMarket(instrument.market),
      },
    ]),
  );

  const currencies = [
    ...new Set([...instruments.map((i) => i.currency), ...rows.map((row) => row.currency)]),
  ].filter((currency) => currency !== REPORTING_CURRENCY);
  const rates = await db.fxRate.findMany({ where: { currency: { in: currencies } } });
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
  const rateOn: RateLookup = (currency, date) => lookups.get(currency)?.(date) ?? null;

  const years = computeTaxYears(
    taxable.map((account) => ({
      accountId: account.id,
      entries: rows.filter((row) => row.accountId === account.id).map(toLedgerEntry),
    })),
    (instrumentId) => taxInstruments.get(instrumentId)!,
    rateOn,
    currentYear,
  );

  const report =
    years.find((candidate) => candidate.year === requestedYear) ??
    years.find((candidate) => candidate.year === currentYear) ??
    null;
  const year = report?.year ?? currentYear;

  return {
    year,
    years: years.map((candidate) => candidate.year).reverse(),
    report,
    earlierYears: years
      .filter((candidate) => candidate.year < year && candidate.year >= year - 5)
      .map((candidate) => ({ year: candidate.year, income: candidate.securities.income }))
      .reverse(),
    instruments: Object.fromEntries(
      instruments.map((instrument) => [
        instrument.id,
        { symbol: instrument.symbol, name: instrument.name },
      ]),
    ),
    accounts: Object.fromEntries(
      taxable.map((account) => [
        account.id,
        { name: account.name, portfolioName: account.portfolio.name },
      ]),
    ),
    excludedAccounts: accounts.flatMap((account) =>
      account.type === TAXABLE_ACCOUNT_TYPE
        ? []
        : [{ name: account.name, portfolioName: account.portfolio.name, type: account.type }],
    ),
  };
}
