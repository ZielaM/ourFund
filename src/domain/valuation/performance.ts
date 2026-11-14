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

/** Units of each instrument held at the end of a day, across all accounts. */
export type QuantitySnapshot = {
  date: IsoDate;
  quantities: Map<string, Decimal>;
};

/**
 * Replays the trades and splits of every account and records what was held after each day
 * on which something changed. Splits are applied per account, as they are recorded.
 */
export function buildQuantityTimeline(
  entriesByAccount: readonly (readonly LedgerEntry[])[],
): QuantitySnapshot[] {
  const tagged = entriesByAccount
    .flatMap((entries, account) => entries.map((entry, index) => ({ entry, account, index })))
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) || a.account - b.account || a.index - b.index,
    );

  // Keyed by account and instrument.
  const held = new Map<string, { instrumentId: string; quantity: Decimal }>();
  const snapshots: QuantitySnapshot[] = [];

  const snapshot = (date: IsoDate) => {
    const quantities = new Map<string, Decimal>();
    for (const { instrumentId, quantity } of held.values()) {
      if (!quantity.isZero()) {
        quantities.set(instrumentId, (quantities.get(instrumentId) ?? ZERO).plus(quantity));
      }
    }
    snapshots.push({ date, quantities });
  };

  tagged.forEach(({ entry, account }, position) => {
    if (entry.type === "BUY" || entry.type === "SELL" || entry.type === "SPLIT") {
      const key = `${account}|${entry.instrumentId}`;
      const current = held.get(key)?.quantity ?? ZERO;
      let quantity: Decimal;

      if (entry.type === "SPLIT") {
        quantity = current.times(entry.splitRatio);
      } else if (entry.type === "BUY") {
        quantity = current.plus(entry.quantity);
      } else {
        quantity = current.minus(entry.quantity);
      }

      held.set(key, { instrumentId: entry.instrumentId, quantity });
    }

    const next = tagged[position + 1];
    if (!next || next.entry.date !== entry.date) {
      snapshot(entry.date);
    }
  });

  return snapshots;
}

export type CostSnapshot = {
  date: IsoDate;
  /** What the securities held at the end of the day cost, in PLN; null without a rate. */
  cost: Decimal | null;
};

/**
 * The cost of the securities held (FIFO, per account) after each day on which a trade or
 * a split happened. Between two snapshots the cost does not change.
 */
export function buildCostTimeline(
  entriesByAccount: readonly (readonly LedgerEntry[])[],
  instrumentCurrency: (instrumentId: string) => string,
  fxOn: FxOn,
): CostSnapshot[] {
  const changesHoldings = (entry: LedgerEntry) =>
    entry.type === "BUY" || entry.type === "SELL" || entry.type === "SPLIT";
  const dates = [
    ...new Set(
      entriesByAccount
        .flatMap((entries) => entries.filter(changesHoldings))
        .map((entry) => entry.date),
    ),
  ].sort();

  return dates.map((date) => ({
    date,
    cost: sumOrNull(
      entriesByAccount.flatMap((entries) =>
        computeLedger(entries.filter((entry) => entry.date <= date)).positions.flatMap((position) =>
          position.lots.map((lot) => {
            const rate = rateToPln(lot, instrumentCurrency(position.instrumentId), fxOn);
            return rate ? lot.quantity.times(lot.unitCost).times(rate) : null;
          }),
        ),
      ),
    ),
  }));
}

/**
 * A price lookup that prefers market prices and falls back to the price of the most recent
 * trade, so that a position is never left without a value just because quotes are missing.
 */
export function createPriceLookup(
  marketPrices: ReadonlyMap<string, readonly { date: IsoDate; close: Decimal }[]>,
  entries: readonly LedgerEntry[],
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

  return (instrumentId, date): PricePoint | null => {
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
  timeline: readonly QuantitySnapshot[],
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
    for (const [instrumentId, quantity] of index >= 0 ? timeline[index].quantities : []) {
      const currency = instrumentCurrency(instrumentId);
      const price = priceOn(instrumentId, date);
      const rate = currency === REPORTING_CURRENCY ? new Decimal(1) : fxOn(currency, date);

      if (!price || !rate) {
        value = null;
        break;
      }
      value = value.plus(quantity.times(price.close).times(rate));
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
