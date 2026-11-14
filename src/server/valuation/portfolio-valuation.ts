import { Decimal } from "@/domain/decimal";
import { todayInWarsaw, utcToIsoDate, type IsoDate } from "@/domain/portfolio/dates";
import { aggregateHoldings } from "@/domain/portfolio/holdings";
import { computeLedger, type LedgerEntry } from "@/domain/portfolio/ledger";
import {
  benchmarkLevels,
  buildCostTimeline,
  buildQuantityTimeline,
  contributions,
  createPriceLookup,
  cumulativeReturns,
  dailyDates,
  timeWeightedReturns,
  valueSeries,
  xirr,
} from "@/domain/valuation/performance";
import { createLookup } from "@/domain/valuation/series";
import {
  allocate,
  combineByInstrument,
  REPORTING_CURRENCY,
  valuePortfolio,
  type AllocationSlice,
  type CashValuation,
  type FxOn,
  type PortfolioValuation,
  type PositionValuation,
} from "@/domain/valuation/valuation";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import type { InstrumentSummary } from "@/server/portfolio/instruments";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { ledgerOrder, toLedgerEntry } from "@/server/portfolio/transactions";

/** At most this many points are sent to the chart; longer histories are thinned out. */
const MAX_CHART_POINTS = 260;

export type ValuedHolding = PositionValuation & {
  instrument: InstrumentSummary;
  /** Cost per unit in the instrument's own currency; null for a closed position. */
  averageCost: Decimal | null;
  /** The accounts that hold the instrument now. */
  accounts: { accountName: string; quantity: Decimal }[];
};

export type ChartPoint = {
  date: IsoDate;
  /** Market value of the securities in PLN; null on days it could not be computed. */
  value: number | null;
  /** What the securities held that day cost; null when it could not be computed. */
  cost: number | null;
};

export type BenchmarkComparison = {
  instrument: { id: string; symbol: string; name: string };
  /** The benchmark's return in PLN over the period the portfolio's TWR covers. */
  return: number | null;
  /** Cumulative returns of both, day by day. */
  chart: { date: IsoDate; portfolio: number | null; benchmark: number | null }[];
};

export type PortfolioValuationView = {
  date: IsoDate;
  totals: PortfolioValuation["totals"];
  /** One row per instrument, across accounts; closed positions included. */
  holdings: ValuedHolding[];
  cash: (CashValuation & { accountName: string })[];
  allocation: {
    /** Keys are instrument types, plus "CASH". */
    byClass: AllocationSlice[];
    byCurrency: AllocationSlice[];
    /** Keys are account names. */
    byAccount: AllocationSlice[];
  };
  performance: {
    /** Cumulative time-weighted return since the first transaction. */
    twr: number | null;
    /** Yearly money-weighted return. */
    xirr: number | null;
    since: IsoDate | null;
    chart: ChartPoint[];
    /** Null when no benchmark was chosen for the portfolio. */
    benchmark: BenchmarkComparison | null;
  };
  /** What stands between the user and a complete valuation. */
  missing: {
    /** Symbols valued at the price of their last trade, for lack of a market price. */
    marketPrices: string[];
    /** Currencies without an NBP rate. */
    rates: string[];
  };
};

/** Keeps every n-th point so that at most `max` remain; the last point always stays. */
export function thinOut<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) {
    return [...points];
  }

  const step = Math.ceil(points.length / max);
  const thinned = points.filter((_, index) => index % step === 0);

  if (thinned.at(-1) !== points.at(-1)) {
    thinned.push(points.at(-1)!);
  }
  return thinned;
}

/**
 * Values a portfolio in PLN as of today: positions, cash, allocation, returns and the
 * history of its value. Null when the portfolio does not exist or is not the user's.
 */
export async function getPortfolioValuation(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
  now: Date = new Date(),
): Promise<PortfolioValuationView | null> {
  const portfolio = await getPortfolio(db, actor, portfolioId);
  if (!portfolio) {
    return null;
  }

  const today = todayInWarsaw(now);
  const rows = await db.transaction.findMany({
    where: { account: { portfolioId } },
    orderBy: [...ledgerOrder],
  });

  const entriesByAccount = portfolio.accounts.map((account) =>
    rows.filter((row) => row.accountId === account.id).map(toLedgerEntry),
  );
  const entries: LedgerEntry[] = entriesByAccount.flat();
  const accountLedgers = portfolio.accounts.map((account, index) => ({
    accountId: account.id,
    ledger: computeLedger(entriesByAccount[index]),
  }));

  const instrumentIds = [
    ...new Set(rows.flatMap((row) => (row.instrumentId ? [row.instrumentId] : []))),
  ];
  const [instruments, prices] = await Promise.all([
    db.instrument.findMany({
      where: { id: { in: instrumentIds } },
      select: { id: true, symbol: true, market: true, name: true, type: true, currency: true },
    }),
    db.price.findMany({
      where: { instrumentId: { in: instrumentIds } },
      select: { instrumentId: true, date: true, close: true },
    }),
  ]);
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const currencyOf = (instrumentId: string) => instrumentById.get(instrumentId)!.currency;

  const benchmark = portfolio.benchmarkInstrumentId
    ? await db.instrument.findUnique({
        where: { id: portfolio.benchmarkInstrumentId },
        select: { id: true, symbol: true, name: true, currency: true },
      })
    : null;
  const benchmarkPrices = benchmark
    ? await db.price.findMany({
        where: { instrumentId: benchmark.id },
        select: { date: true, close: true },
      })
    : [];

  const currencies = [
    ...new Set([
      ...instruments.map((i) => i.currency),
      ...rows.map((row) => row.currency),
      ...(benchmark ? [benchmark.currency] : []),
    ]),
  ].filter((currency) => currency !== REPORTING_CURRENCY);
  const rates = await db.fxRate.findMany({ where: { currency: { in: currencies } } });

  const rateLookups = new Map(
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
  const missingRates = new Set<string>();
  const fxOn: FxOn = (currency, date) => {
    const rate = rateLookups.get(currency)?.(date)?.value ?? null;
    if (!rate) {
      missingRates.add(currency);
    }
    return rate;
  };

  const marketPrices = new Map<string, { date: IsoDate; close: Decimal }[]>();
  for (const price of prices) {
    marketPrices.set(price.instrumentId, [
      ...(marketPrices.get(price.instrumentId) ?? []),
      { date: utcToIsoDate(price.date), close: new Decimal(price.close.toString()) },
    ]);
  }
  const priceOn = createPriceLookup(marketPrices, entries);

  const valuation = valuePortfolio(accountLedgers, currencyOf, today, priceOn, fxOn);
  const accountName = new Map(portfolio.accounts.map((account) => [account.id, account.name]));
  const inOwnCurrency = new Map(
    aggregateHoldings(accountLedgers).map((holding) => [holding.instrumentId, holding]),
  );
  const holdings = combineByInstrument(valuation.positions)
    .map((holding) => ({
      ...holding,
      instrument: instrumentById.get(holding.instrumentId)!,
      averageCost: inOwnCurrency.get(holding.instrumentId)!.averageCost,
      accounts: inOwnCurrency.get(holding.instrumentId)!.accounts.map((account) => ({
        accountName: accountName.get(account.accountId)!,
        quantity: account.quantity,
      })),
    }))
    .sort(
      (a, b) =>
        (b.value ?? new Decimal(0)).comparedTo(a.value ?? new Decimal(0)) ||
        a.instrument.symbol.localeCompare(b.instrument.symbol),
    );
  // History and returns, measured on the securities (cash excluded).
  const first = rows[0] ? utcToIsoDate(rows[0].date) : null;
  const dates = first ? dailyDates(first, today) : [];
  const series = valueSeries(
    buildQuantityTimeline(entriesByAccount),
    dates,
    currencyOf,
    priceOn,
    fxOn,
  );
  const flows = contributions(entries, fxOn);
  const returns = timeWeightedReturns(series, flows.byDate);

  const costOn = createLookup(
    buildCostTimeline(entriesByAccount, currencyOf, fxOn).map(({ date, cost }) => ({
      date,
      value: cost,
    })),
  );
  const chart = series.map((point) => {
    const cost = costOn(point.date);
    return {
      date: point.date,
      value: point.value,
      // Nothing has been bought yet before the first snapshot.
      cost: cost ? (cost.value?.toNumber() ?? null) : 0,
    };
  });

  // The benchmark over the days the portfolio has a return for.
  let comparison: BenchmarkComparison | null = null;
  if (benchmark) {
    const benchmarkPriceOn = createPriceLookup(
      new Map([
        [
          benchmark.id,
          benchmarkPrices.map((price) => ({
            date: utcToIsoDate(price.date),
            close: new Decimal(price.close.toString()),
          })),
        ],
      ]),
      [],
    );
    const benchmarkReturns = cumulativeReturns(
      benchmarkLevels(
        benchmark.id,
        benchmark.currency,
        returns.map((point) => point.date),
        benchmarkPriceOn,
        fxOn,
      ),
    );

    comparison = {
      instrument: { id: benchmark.id, symbol: benchmark.symbol, name: benchmark.name },
      return: benchmarkReturns.at(-1)?.value ?? null,
      chart: thinOut(
        returns.map((point, index) => ({
          date: point.date,
          portfolio: point.twr,
          benchmark: benchmarkReturns[index].value,
        })),
        MAX_CHART_POINTS,
      ),
    };
  }

  const complete = !valuation.totals.incomplete && !flows.incomplete;
  const moneyWeighted = complete
    ? xirr([
        ...[...flows.byDate].map(([date, amount]) => ({ date, amount: -amount })),
        { date: today, amount: valuation.totals.holdingsValue.toNumber() },
      ])
    : null;

  return {
    date: today,
    totals: valuation.totals,
    holdings,
    cash: valuation.cash.map((balance) => ({
      ...balance,
      accountName: accountName.get(balance.accountId)!,
    })),
    allocation: {
      byClass: allocate([
        ...holdings.flatMap((holding) =>
          holding.value ? [{ key: holding.instrument.type as string, value: holding.value }] : [],
        ),
        ...valuation.cash.flatMap((balance) =>
          balance.value ? [{ key: "CASH", value: balance.value }] : [],
        ),
      ]),
      byCurrency: allocate([
        ...holdings.flatMap((holding) =>
          holding.value ? [{ key: holding.instrument.currency, value: holding.value }] : [],
        ),
        ...valuation.cash.flatMap((balance) =>
          balance.value ? [{ key: balance.currency, value: balance.value }] : [],
        ),
      ]),
      byAccount: allocate([
        ...valuation.positions.flatMap((position) =>
          position.value
            ? [{ key: accountName.get(position.accountId)!, value: position.value }]
            : [],
        ),
        ...valuation.cash.flatMap((balance) =>
          balance.value ? [{ key: accountName.get(balance.accountId)!, value: balance.value }] : [],
        ),
      ]),
    },
    performance: {
      twr: complete && returns.length > 0 ? returns.at(-1)!.twr : null,
      xirr: moneyWeighted,
      since: first,
      chart: thinOut(chart, MAX_CHART_POINTS),
      benchmark: comparison,
    },
    missing: {
      marketPrices: holdings
        .filter((holding) => holding.price?.fromTrade)
        .map((holding) => holding.instrument.symbol)
        .sort(),
      rates: [...missingRates].sort(),
    },
  };
}
