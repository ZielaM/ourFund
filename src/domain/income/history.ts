import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";
import type { LedgerEntry } from "@/domain/portfolio/ledger";
import { REPORTING_CURRENCY, sumOrNull, type FxOn } from "@/domain/valuation/valuation";

/** A dividend or interest payment as it reached an account. */
export type IncomePayment = {
  transactionId: string;
  accountId: string;
  /** Null for interest that does not come from an instrument, e.g. on cash. */
  instrumentId: string | null;
  date: IsoDate;
  kind: "DIVIDEND" | "INTEREST";
  currency: string;
  gross: Decimal;
  /** Tax withheld at source. */
  tax: Decimal;
  net: Decimal;
  /** Net amount in PLN at the NBP rate of the payment day; null without a rate. */
  netPln: Decimal | null;
};

/** Every dividend and interest payment of the given accounts, newest first. */
export function incomePayments(
  accounts: readonly { accountId: string; entries: readonly LedgerEntry[] }[],
  fxOn: FxOn,
): IncomePayment[] {
  const payments: IncomePayment[] = [];

  for (const account of accounts) {
    for (const entry of account.entries) {
      if (entry.type !== "DIVIDEND" && entry.type !== "INTEREST") {
        continue;
      }

      const net = entry.amount.minus(entry.tax);
      const rate =
        entry.currency === REPORTING_CURRENCY ? new Decimal(1) : fxOn(entry.currency, entry.date);

      payments.push({
        transactionId: entry.id,
        accountId: account.accountId,
        instrumentId: entry.instrumentId,
        date: entry.date,
        kind: entry.type,
        currency: entry.currency,
        gross: entry.amount,
        tax: entry.tax,
        net,
        netPln: rate ? net.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null,
      });
    }
  }

  return payments.sort((a, b) => b.date.localeCompare(a.date));
}

const yearOf = (payment: IncomePayment) => Number(payment.date.slice(0, 4));
const monthOf = (payment: IncomePayment) => Number(payment.date.slice(5, 7));
const total = (payments: readonly IncomePayment[]) =>
  sumOrNull(payments.map((payment) => payment.netPln));

/** Net income in PLN of every month of a year, January first; a month without payments is zero. */
export function incomeByMonth(
  payments: readonly IncomePayment[],
  year: number,
): { month: number; net: Decimal | null }[] {
  const ofYear = payments.filter((payment) => yearOf(payment) === year);

  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    net: total(ofYear.filter((payment) => monthOf(payment) === index + 1)),
  }));
}

/** Net income in PLN of every year from the first payment to `throughYear`, oldest first. */
export function incomeByYear(
  payments: readonly IncomePayment[],
  throughYear: number,
): { year: number; net: Decimal | null }[] {
  if (payments.length === 0) {
    return [];
  }

  const years = payments.map(yearOf);
  const first = Math.min(...years);
  const last = Math.max(throughYear, ...years);

  return Array.from({ length: last - first + 1 }, (_, index) => ({
    year: first + index,
    net: total(payments.filter((payment) => yearOf(payment) === first + index)),
  }));
}

/** Net income in PLN per instrument, largest first; amounts that could not be converted last. */
export function incomeByInstrument(
  payments: readonly IncomePayment[],
): { instrumentId: string | null; net: Decimal | null; count: number }[] {
  const groups = new Map<string | null, IncomePayment[]>();
  for (const payment of payments) {
    groups.set(payment.instrumentId, [...(groups.get(payment.instrumentId) ?? []), payment]);
  }

  return [...groups.entries()]
    .map(([instrumentId, group]) => ({ instrumentId, net: total(group), count: group.length }))
    .sort((a, b) => {
      if (a.net && b.net) {
        return b.net.comparedTo(a.net);
      }
      return a.net ? -1 : b.net ? 1 : 0;
    });
}
