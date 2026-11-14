import { bondValue, type BondSeries } from "@/domain/bonds/valuation";
import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";
import { computeLedger, type LedgerEntry } from "@/domain/portfolio/ledger";
import { createLookup } from "./series";
import {
  rateToPln,
  REPORTING_CURRENCY,
  sumOrNull,
  type FxOn,
  type PriceOn,
  type PricePoint,
} from "./valuation";

const ZERO = new Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every calendar day from `from` to `to`, inclusive. */
export function dailyDates(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);

  for (let time = Date.parse(`${from}T00:00:00.000Z`); time <= end; time += DAY_MS) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }

  return dates;
}

/** Units bought together and still held at the end of a day. */
export type HeldLot = {
  instrumentId: string;
  /** The day the units were bought. */
  acquiredOn: IsoDate;
  quantity: Decimal;
  /** Cost of one unit in the instrument's currency. */
  unitCost: Decimal;
  settlementCurrency: string;
  fxRate: Decimal;
};

export type LotSnapshot = {
  date: IsoDate;
  lots: HeldLot[];
};

/**
 * What was held (FIFO lots, per account) after each day on which a trade or a split
 * happened. Between two snapshots the holdings do not change.
 */
export function buildLotTimeline(
  entriesByAccount: readonly (readonly LedgerEntry[])[],
): LotSnapshot[] {
  const changesHoldings = (entry: LedgerEntry) =>
    entry.type === "BUY" || entry.type === "SELL" || entry.type === "SPLIT";
  const dates = [
    ...new Set(
      entriesByAccount.flatMap((entries) =>
        entries.filter(changesHoldings).map((entry) => entry.date),
      ),
    ),
  ].sort();

  return dates.map((date) => ({
    date,
    lots: entriesByAccount.flatMap((entries) =>
      computeLedger(entries.filter((entry) => entry.date <= date)).positions.flatMap((position) =>
        position.lots.map((lot) => ({
          instrumentId: position.instrumentId,
          acquiredOn: lot.date,
          quantity: lot.quantity,
          unitCost: lot.unitCost,
          settlementCurrency: lot.settlementCurrency,
          fxRate: lot.fxRate,
        })),
      ),
    ),
  }));
}

/** What the lots of a snapshot cost in PLN; null when an exchange rate is missing. */
export function costOfLots(
  lots: readonly HeldLot[],
  instrumentCurrency: (instrumentId: string) => string,
  fxOn: FxOn,
): Decimal | null {
  return sumOrNull(
    lots.map((lot) => {
      const rate = rateToPln(
        { date: lot.acquiredOn, settlementCurrency: lot.settlementCurrency, fxRate: lot.fxRate },
        instrumentCurrency(lot.instrumentId),
        fxOn,
      );
      return rate ? lot.quantity.times(lot.unitCost).times(rate) : null;
    }),
  );
}

/**
 * A price lookup. In order of preference:
 * - a retail treasury bond is worth what it has accrued since the day it was bought,
 * - otherwise the market price, carried forward over days without one,
 * - otherwise the price of the most recent trade, so that a position is never left without
 *   a value just because quotes are missing.
 */
export function createPriceLookup(
  marketPrices: ReadonlyMap<string, readonly { date: IsoDate; close: Decimal }[]>,
  entries: readonly LedgerEntry[],
  bonds: ReadonlyMap<string, BondSeries> = new Map(),
): PriceOn {
  const tradePrices = new Map<string, { date: IsoDate; value: Decimal }[]>();
  for (const entry of entries) {
    if (entry.type === "BUY" || entry.type === "SELL") {
      tradePrices.set(entry.instrumentId, [
        ...(tradePrices.get(entry.instrumentId) ?? []),
        { date: entry.date, value: entry.price },
      ]);
    }
  }

  const market = new Map(
    [...marketPrices].map(([instrumentId, prices]) => [
      instrumentId,
      createLookup(prices.map(({ date, close }) => ({ date, value: close }))),
    ]),
  );
  const trades = new Map(
    [...tradePrices].map(([instrumentId, prices]) => [instrumentId, createLookup(prices)]),
  );

  return (instrumentId, date, acquiredOn): PricePoint | null => {
    const bond = bonds.get(instrumentId);
    if (bond && acquiredOn) {
      const { value, ratesKnown } = bondValue(bond, acquiredOn, date);
      return { date, close: value, fromTrade: false, estimated: !ratesKnown || undefined };
    }

    const quoted = market.get(instrumentId)?.(date);
    if (quoted) {
      return { date: quoted.date, close: quoted.value, fromTrade: false };
    }

    const traded = trades.get(instrumentId)?.(date);
    return traded ? { date: traded.date, close: traded.value, fromTrade: true } : null;
  };
}

export type ValuePoint = {
  date: IsoDate;
  /** Market value of the securities held in PLN; null when it cannot be computed that day. */
  value: number | null;
};

/** The market value of the securities (cash excluded) on each of the given days. */
export function valueSeries(
  timeline: readonly LotSnapshot[],
  dates: readonly IsoDate[],
  instrumentCurrency: (instrumentId: string) => string,
  priceOn: PriceOn,
  fxOn: FxOn,
): ValuePoint[] {
  let index = -1;

  return dates.map((date) => {
    while (index + 1 < timeline.length && timeline[index + 1].date <= date) {
      index += 1;
    }

    let value: Decimal | null = ZERO;
    for (const lot of index >= 0 ? timeline[index].lots : []) {
      const currency = instrumentCurrency(lot.instrumentId);
      const price = priceOn(lot.instrumentId, date, lot.acquiredOn);
      const rate = currency === REPORTING_CURRENCY ? new Decimal(1) : fxOn(currency, date);

      if (!price || !rate) {
        value = null;
        break;
      }
      value = value.plus(lot.quantity.times(price.close).times(rate));
    }

    return { date, value: value?.toNumber() ?? null };
  });
}

export type Contributions = {
  /** PLN put into securities on each day (negative: taken out as sale proceeds or income). */
  byDate: Map<IsoDate, number>;
  /** True when an exchange rate was missing and some flow could not be counted. */
  incomplete: boolean;
};

/**
 * The investor's flows in and out of securities. Returns are measured on the securities
 * themselves: buying is a contribution, selling and receiving a dividend are withdrawals.
 * Cash movements on the account (deposits, withdrawals, fees) are deliberately left out,
 * so the result does not depend on whether the user records them.
 */
export function contributions(entries: readonly LedgerEntry[], fxOn: FxOn): Contributions {
  const byDate = new Map<IsoDate, number>();
  let incomplete = false;

  for (const entry of entries) {
    let amount: Decimal;

    if (entry.type === "BUY") {
      amount = entry.quantity.times(entry.price).times(entry.fxRate).plus(entry.fee);
    } else if (entry.type === "SELL") {
      amount = entry.quantity.times(entry.price).times(entry.fxRate).minus(entry.fee).negated();
    } else if ((entry.type === "DIVIDEND" || entry.type === "INTEREST") && entry.instrumentId) {
      amount = entry.amount.minus(entry.tax).negated();
    } else {
      continue;
    }

    const rate =
      entry.currency === REPORTING_CURRENCY ? new Decimal(1) : fxOn(entry.currency, entry.date);
    if (!rate) {
      incomplete = true;
      continue;
    }

    byDate.set(entry.date, (byDate.get(entry.date) ?? 0) + amount.times(rate).toNumber());
  }

  return { byDate, incomplete };
}

export type ReturnPoint = {
  date: IsoDate;
  /** Cumulative time-weighted return since the first day, e.g. 0.12 for +12%. */
  twr: number;
};

/**
 * Time-weighted return: the growth of one złoty that stayed invested the whole time, which
 * makes it independent of when and how much money was added or withdrawn.
 *
 * Each day's return is (value − contribution) / previous value − 1, treating the day's
 * flows as happening before the close. Days without a value are skipped and their flows
 * carried to the next valued day.
 */
export function timeWeightedReturns(
  points: readonly ValuePoint[],
  byDate: ReadonlyMap<IsoDate, number>,
): ReturnPoint[] {
  const result: ReturnPoint[] = [];
  let growth = 1;
  let previous = 0;
  let pending = 0;

  for (const { date, value } of points) {
    pending += byDate.get(date) ?? 0;

    if (value === null) {
      continue;
    }

    if (previous > 0) {
      growth *= (value - pending) / previous;
    } else if (pending > 0) {
      // Money entering an empty portfolio: the first day's return is against what was paid.
      growth *= value / pending;
    }

    previous = value;
    pending = 0;
    result.push({ date, twr: growth - 1 });
  }

  return result;
}

export type DatedAmount = {
  date: IsoDate;
  /** Negative: money the investor paid in. Positive: money received (or the value today). */
  amount: number;
};

/**
 * Money-weighted return (XIRR): the yearly rate at which all payments in and out, at their
 * actual dates, are worth zero today. Null when it does not exist, e.g. without both a
 * payment in and a value coming back.
 */
export function xirr(flows: readonly DatedAmount[]): number | null {
  const relevant = flows.filter((flow) => flow.amount !== 0);
  if (!relevant.some((flow) => flow.amount < 0) || !relevant.some((flow) => flow.amount > 0)) {
    return null;
  }

  const start = Math.min(...relevant.map((flow) => Date.parse(flow.date)));
  const dated = relevant.map((flow) => ({
    years: (Date.parse(flow.date) - start) / DAY_MS / 365,
    amount: flow.amount,
  }));

  // Everything on one day: there is no time for a yearly rate to act on.
  if (dated.every((flow) => flow.years === 0)) {
    return null;
  }

  const presentValue = (rate: number) =>
    dated.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** flow.years, 0);

  let low = -0.999999;
  let high = 1000;
  let atLow = presentValue(low);
  const atHigh = presentValue(high);

  if (!Number.isFinite(atLow) || !Number.isFinite(atHigh) || atLow * atHigh > 0) {
    return null;
  }

  for (let iteration = 0; iteration < 200; iteration++) {
    const middle = (low + high) / 2;
    const atMiddle = presentValue(middle);

    if (Math.abs(atMiddle) < 1e-9 || high - low < 1e-10) {
      return middle;
    }

    if (atLow * atMiddle <= 0) {
      high = middle;
    } else {
      low = middle;
      atLow = atMiddle;
    }
  }

  return (low + high) / 2;
}

export type LevelPoint = {
  date: IsoDate;
  /** The benchmark's price in PLN that day; null when it is not known. */
  level: number | null;
};

/** The price of a benchmark in PLN on each of the given days. */
export function benchmarkLevels(
  instrumentId: string,
  currency: string,
  dates: readonly IsoDate[],
  priceOn: PriceOn,
  fxOn: FxOn,
): LevelPoint[] {
  return dates.map((date) => {
    const price = priceOn(instrumentId, date);
    const rate = currency === REPORTING_CURRENCY ? new Decimal(1) : fxOn(currency, date);

    return { date, level: price && rate ? price.close.times(rate).toNumber() : null };
  });
}

/**
 * Cumulative return of a series of levels since the first known level: 0 on that day,
 * 0.1 once the level is 10% higher. Days before the first level have no return.
 */
export function cumulativeReturns(
  points: readonly LevelPoint[],
): { date: IsoDate; value: number | null }[] {
  const base = points.find((point) => point.level !== null && point.level > 0)?.level;

  return points.map(({ date, level }) => ({
    date,
    value: base && level !== null ? level / base - 1 : null,
  }));
}
