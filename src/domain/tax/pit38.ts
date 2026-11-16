import { Decimal } from "@/domain/decimal";
import {
  deductLosses,
  isUsable,
  LOSS_WINDOW_YEARS,
  type LossDeduction,
  type LossPool,
} from "./losses";
import { addDays } from "@/domain/market-data/nbp";
import type { IsoDate } from "@/domain/portfolio/dates";
import { computeLedger, type LedgerEntry, type TradeEntry } from "@/domain/portfolio/ledger";
import type { DatedValue } from "@/domain/valuation/series";
import { REPORTING_CURRENCY, sumOrNull } from "@/domain/valuation/valuation";

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/** Flat rate on capital income (art. 30a and 30b of the PIT act). */
export const CAPITAL_TAX_RATE = new Decimal("0.19");

/**
 * NBP publishes a rate every working day, so the rate "of the last working day before" is
 * never older than a long weekend. An older one means the rates were not downloaded.
 */
const MAX_RATE_AGE_DAYS = 10;

/**
 * How an instrument is taxed:
 * - `security`: shares, ETFs and listed bonds; sales settled yearly, cost matched FIFO,
 * - `crypto`: virtual currencies; every purchase is a cost of the year it was made in,
 * - `savingsBond`: retail treasury bonds; the payer withholds the tax at redemption,
 * - `commodity`: physical gold and the like; not a security, so its sale is not part of
 *   PIT-38 at all. It is listed so that nothing looks forgotten.
 */
export type TaxCategory = "security" | "crypto" | "savingsBond" | "commodity";

export type TaxInstrument = {
  currency: string;
  category: TaxCategory;
  /** Listed outside Poland: its dividends are settled by the taxpayer, not by the payer. */
  foreign: boolean;
};

/** One taxable account (IKE, IKZE and OKI accounts are left out by the caller). */
export type TaxAccount = {
  accountId: string;
  entries: readonly LedgerEntry[];
};

/** The last NBP average rate published on or before a day. */
export type RateLookup = (currency: string, date: IsoDate) => DatedValue<Decimal> | null;

/** One sale, with the cost of the units it sold. Amounts are in PLN; null without a rate. */
export type SaleLine = {
  transactionId: string;
  accountId: string;
  instrumentId: string;
  date: IsoDate;
  quantity: Decimal;
  /** When the oldest units sold here were bought. */
  acquiredFrom: IsoDate;
  revenue: Decimal | null;
  /** Purchase price and commissions of both the purchase and the sale. */
  costs: Decimal | null;
  income: Decimal | null;
};

/** A purchase or a sale of a virtual currency. */
export type CryptoLine = {
  transactionId: string;
  accountId: string;
  instrumentId: string;
  date: IsoDate;
  type: "BUY" | "SELL";
  quantity: Decimal;
  revenue: Decimal | null;
  costs: Decimal | null;
};

/** A dividend or interest payment. */
export type IncomeLine = {
  transactionId: string;
  accountId: string;
  instrumentId: string | null;
  date: IsoDate;
  kind: "DIVIDEND" | "INTEREST";
  currency: string;
  /** Amounts as received, in `currency`. */
  grossOriginal: Decimal;
  taxOriginal: Decimal;
  /** PLN per one unit of `currency`; null for payments in PLN and when the rate is missing. */
  rate: DatedValue<Decimal> | null;
  gross: Decimal | null;
  withheld: Decimal | null;
};

export type TaxYear = {
  year: number;
  /** Sales of securities (PIT-38, income from the disposal of securities). */
  securities: {
    revenue: Decimal | null;
    costs: Decimal | null;
    /** Negative for a loss. */
    income: Decimal | null;
    /**
     * The most that losses of the previous five years allow to deduct from this year's
     * income, assuming the same was done in every earlier year. Null when a loss of one of
     * those years could not be established (a missing NBP rate).
     */
    lossDeduction: LossDeduction | null;
    /** Losses that can still be deducted in later years, after this year's deduction. */
    lossesLeft: { year: number; amount: Decimal }[];
    /** Income less the deducted losses, rounded to full złoty; zero for a loss. */
    base: Decimal | null;
    tax: Decimal | null;
    sales: SaleLine[];
  };
  /** Virtual currencies (PIT-38, a section of its own). */
  crypto: {
    revenue: Decimal | null;
    /** Purchases and commissions paid this year, sold or not. */
    costs: Decimal | null;
    /** Costs of earlier years that revenue has not covered yet. */
    carriedCosts: Decimal | null;
    income: Decimal | null;
    /** Costs left for the following year. */
    carryForward: Decimal | null;
    base: Decimal | null;
    tax: Decimal | null;
    lines: CryptoLine[];
  };
  /** Dividends and interest from abroad: the taxpayer settles the difference up to 19%. */
  foreignIncome: {
    gross: Decimal | null;
    /** 19% of the gross amount. */
    taxDue: Decimal | null;
    paidAbroad: Decimal | null;
    /** Tax paid abroad that lowers the Polish tax: never more than 19% of a payment. */
    deductible: Decimal | null;
    /** Rounded to full złoty. */
    toPay: Decimal | null;
    lines: IncomeLine[];
  };
  /** Dividends and interest taxed by the Polish payer; not part of the return. */
  domesticIncome: {
    gross: Decimal | null;
    withheld: Decimal | null;
    lines: IncomeLine[];
  };
  /** Redemptions of retail treasury bonds; the tax is withheld by the payer. */
  savingsBonds: {
    income: Decimal | null;
    sales: SaleLine[];
  };
  /** Sales of physical commodities such as gold; not securities, so outside PIT-38. */
  commodities: {
    income: Decimal | null;
    sales: SaleLine[];
  };
  /** Currencies whose NBP rate was missing for some day of this report. */
  missingRates: string[];
  /** Nothing to report this year. */
  empty: boolean;
};

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

function toGrosz(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Tax bases and taxes are rounded to full złoty: under 50 gr down, from 50 gr up. */
export function toFullZloty(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

function difference(a: Decimal | null, b: Decimal | null): Decimal | null {
  return a && b ? a.minus(b) : null;
}

type Draft = {
  securities: SaleLine[];
  savingsBonds: SaleLine[];
  commodities: SaleLine[];
  crypto: CryptoLine[];
  foreign: IncomeLine[];
  domestic: IncomeLine[];
  missing: Set<string>;
};

/**
 * Prepares the figures of the yearly PIT-38 return for every year from the first
 * transaction to `throughYear`.
 *
 * Amounts in foreign currencies are converted at the NBP average rate of the last working
 * day before the transaction. When the account paid or was paid in złoty, the amount in
 * złoty is taken as it was, at the broker's rate.
 */
export function computeTaxYears(
  accounts: readonly TaxAccount[],
  instrumentOf: (instrumentId: string) => TaxInstrument,
  rateOn: RateLookup,
  throughYear: number,
): TaxYear[] {
  const drafts = new Map<number, Draft>();
  const draftFor = (year: number): Draft => {
    let draft = drafts.get(year);
    if (!draft) {
      draft = {
        securities: [],
        savingsBonds: [],
        commodities: [],
        crypto: [],
        foreign: [],
        domestic: [],
        missing: new Set(),
      };
      drafts.set(year, draft);
    }
    return draft;
  };

  const nbpRate = (currency: string, date: IsoDate, draft: Draft): DatedValue<Decimal> | null => {
    const dayBefore = addDays(date, -1);
    const found = rateOn(currency, dayBefore);

    if (!found || found.date < addDays(dayBefore, -MAX_RATE_AGE_DAYS)) {
      draft.missing.add(currency);
      return null;
    }
    return found;
  };

  /** PLN per one unit of the instrument's currency for a purchase or a sale. */
  const tradeRate = (
    trade: { date: IsoDate; settlementCurrency: string; fxRate: Decimal },
    instrumentCurrency: string,
    draft: Draft,
  ): Decimal | null => {
    if (instrumentCurrency === REPORTING_CURRENCY) {
      return ONE;
    }
    if (trade.settlementCurrency === REPORTING_CURRENCY) {
      return trade.fxRate;
    }
    return nbpRate(instrumentCurrency, trade.date, draft)?.value ?? null;
  };

  const entryRate = (entry: TradeEntry, instrumentCurrency: string, draft: Draft) =>
    tradeRate(
      { date: entry.date, settlementCurrency: entry.currency, fxRate: entry.fxRate },
      instrumentCurrency,
      draft,
    );

  for (const account of accounts) {
    const sells = new Map<string, TradeEntry>();

    for (const entry of account.entries) {
      if (entry.type === "SELL") {
        sells.set(entry.id, entry);
      }

      if (entry.type === "BUY" || entry.type === "SELL") {
        const instrument = instrumentOf(entry.instrumentId);
        if (instrument.category !== "crypto") {
          continue;
        }

        const draft = draftFor(yearOf(entry.date));
        const rate = entryRate(entry, instrument.currency, draft);
        const amount = rate ? toGrosz(entry.quantity.times(entry.price).times(rate)) : null;
        const fee = rate ? toGrosz(entry.fee.div(entry.fxRate).times(rate)) : null;

        draft.crypto.push({
          transactionId: entry.id,
          accountId: account.accountId,
          instrumentId: entry.instrumentId,
          date: entry.date,
          type: entry.type,
          quantity: entry.quantity,
          revenue: entry.type === "SELL" ? amount : ZERO,
          costs: entry.type === "BUY" ? sumOrNull([amount, fee]) : fee,
        });
      }

      if (entry.type === "DIVIDEND" || entry.type === "INTEREST") {
        const draft = draftFor(yearOf(entry.date));
        const foreign = entry.instrumentId
          ? instrumentOf(entry.instrumentId).foreign
          : entry.currency !== REPORTING_CURRENCY;
        const inPln = entry.currency === REPORTING_CURRENCY;
        const rate = inPln ? null : nbpRate(entry.currency, entry.date, draft);
        const factor = inPln ? ONE : (rate?.value ?? null);

        (foreign ? draft.foreign : draft.domestic).push({
          transactionId: entry.id,
          accountId: account.accountId,
          instrumentId: entry.instrumentId,
          date: entry.date,
          kind: entry.type,
          currency: entry.currency,
          grossOriginal: entry.amount,
          taxOriginal: entry.tax,
          rate,
          gross: factor ? toGrosz(entry.amount.times(factor)) : null,
          withheld: factor ? toGrosz(entry.tax.times(factor)) : null,
        });
      }
    }

    for (const position of computeLedger(account.entries).positions) {
      const instrument = instrumentOf(position.instrumentId);
      if (instrument.category === "crypto") {
        continue;
      }

      const bySale = new Map<string, typeof position.realizations>();
      for (const realization of position.realizations) {
        bySale.set(realization.transactionId, [
          ...(bySale.get(realization.transactionId) ?? []),
          realization,
        ]);
      }

      for (const [transactionId, realizations] of bySale) {
        const sale = sells.get(transactionId)!;
        const draft = draftFor(yearOf(sale.date));
        const saleRate = entryRate(sale, instrument.currency, draft);

        const revenue = saleRate ? toGrosz(sale.quantity.times(sale.price).times(saleRate)) : null;
        const saleFee = saleRate ? toGrosz(sale.fee.div(sale.fxRate).times(saleRate)) : null;
        const purchaseCosts = realizations.map((realization) => {
          const rate = tradeRate(realization.lot, instrument.currency, draft);
          return rate
            ? toGrosz(realization.quantity.times(realization.lot.unitCost).times(rate))
            : null;
        });
        const costs = sumOrNull([saleFee, ...purchaseCosts]);

        const line: SaleLine = {
          transactionId,
          accountId: account.accountId,
          instrumentId: position.instrumentId,
          date: sale.date,
          quantity: sale.quantity,
          acquiredFrom: realizations
            .map((realization) => realization.lot.date)
            .reduce((earliest, date) => (date < earliest ? date : earliest)),
          revenue,
          costs,
          income: difference(revenue, costs),
        };

        const lines =
          instrument.category === "savingsBond"
            ? draft.savingsBonds
            : instrument.category === "commodity"
              ? draft.commodities
              : draft.securities;
        lines.push(line);
      }
    }
  }

  const entryYears = accounts.flatMap((account) =>
    account.entries.map((entry) => yearOf(entry.date)),
  );
  if (entryYears.length === 0) {
    return [];
  }

  const firstYear = Math.min(...entryYears);
  const lastYear = Math.max(throughYear, ...entryYears);
  const byDate = <T extends { date: IsoDate }>(lines: T[]): T[] =>
    [...lines].sort((a, b) => a.date.localeCompare(b.date));
  const taxOn = (income: Decimal | null) => {
    const base = income ? toFullZloty(Decimal.max(income, ZERO)) : null;
    return { base, tax: base ? toFullZloty(base.times(CAPITAL_TAX_RATE)) : null };
  };

  const years: TaxYear[] = [];
  let carriedCosts: Decimal | null = ZERO;
  let losses: LossPool[] = [];
  // A year whose result is unknown may have been a loss: until it expires, so is the deduction.
  let lossesUnknownThrough = Number.NEGATIVE_INFINITY;

  for (let year = firstYear; year <= lastYear; year += 1) {
    const draft = draftFor(year);

    const sales = byDate(draft.securities);
    const revenue = sumOrNull(sales.map((line) => line.revenue));
    const costs = sumOrNull(sales.map((line) => line.costs));
    const income = difference(revenue, costs);

    let lossDeduction: LossDeduction | null = null;
    if (!income) {
      lossesUnknownThrough = year + LOSS_WINDOW_YEARS;
    } else if (year > lossesUnknownThrough) {
      const result = deductLosses(losses, year, income);
      lossDeduction = result.deduction;
      losses = result.pools;
    }
    if (income?.lt(0)) {
      losses.push({
        year,
        original: income.negated(),
        remaining: income.negated(),
        oneOffUsed: false,
      });
    }
    const lossesLeft = losses
      .filter((pool) => isUsable(pool, year + 1))
      .map((pool) => ({ year: pool.year, amount: pool.remaining }));
    const taxable = income && lossDeduction ? income.minus(lossDeduction.total) : income;

    const cryptoLines = byDate(draft.crypto);
    const cryptoRevenue = sumOrNull(cryptoLines.map((line) => line.revenue));
    const cryptoCosts = sumOrNull(cryptoLines.map((line) => line.costs));
    const cryptoResult = difference(cryptoRevenue, sumOrNull([cryptoCosts, carriedCosts]));
    const cryptoIncome = cryptoResult ? Decimal.max(cryptoResult, ZERO) : null;
    const carryForward = cryptoResult ? Decimal.max(cryptoResult.negated(), ZERO) : null;

    const foreign = byDate(draft.foreign);
    const foreignGross = sumOrNull(foreign.map((line) => line.gross));
    const taxDue = foreignGross ? toGrosz(foreignGross.times(CAPITAL_TAX_RATE)) : null;
    const deductible = sumOrNull(
      foreign.map((line) =>
        line.gross && line.withheld
          ? Decimal.min(line.withheld, toGrosz(line.gross.times(CAPITAL_TAX_RATE)))
          : null,
      ),
    );
    const owed = difference(taxDue, deductible);

    const domestic = byDate(draft.domestic);
    const bonds = byDate(draft.savingsBonds);
    const commodities = byDate(draft.commodities);

    years.push({
      year,
      securities: {
        revenue,
        costs,
        income,
        lossDeduction,
        lossesLeft,
        ...taxOn(taxable),
        sales,
      },
      crypto: {
        revenue: cryptoRevenue,
        costs: cryptoCosts,
        carriedCosts,
        income: cryptoIncome,
        carryForward,
        ...taxOn(cryptoIncome),
        lines: cryptoLines,
      },
      foreignIncome: {
        gross: foreignGross,
        taxDue,
        paidAbroad: sumOrNull(foreign.map((line) => line.withheld)),
        deductible,
        toPay: owed ? toFullZloty(Decimal.max(owed, ZERO)) : null,
        lines: foreign,
      },
      domesticIncome: {
        gross: sumOrNull(domestic.map((line) => line.gross)),
        withheld: sumOrNull(domestic.map((line) => line.withheld)),
        lines: domestic,
      },
      savingsBonds: {
        income: sumOrNull(bonds.map((line) => line.income)),
        sales: bonds,
      },
      commodities: {
        income: sumOrNull(commodities.map((line) => line.income)),
        sales: commodities,
      },
      missingRates: [...draft.missing].sort(),
      empty:
        sales.length +
          cryptoLines.length +
          foreign.length +
          domestic.length +
          bonds.length +
          commodities.length ===
        0,
    });

    carriedCosts = carryForward;
  }

  return years;
}
