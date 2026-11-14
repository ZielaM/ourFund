import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";
import type { AccountLedger } from "@/domain/portfolio/holdings";
import type { Position } from "@/domain/portfolio/ledger";

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/** The reporting currency: everything is valued in złoty. */
export const REPORTING_CURRENCY = "PLN";

/** PLN per one unit of a currency on a day, or null when the rate is not known. */
export type FxOn = (currency: string, date: IsoDate) => Decimal | null;

export type PricePoint = {
  date: IsoDate;
  close: Decimal;
  /** True when no market price is known and the price of the last trade stands in for it. */
  fromTrade: boolean;
};

/** The price of an instrument on a day, in its own currency, or null when none is known. */
export type PriceOn = (instrumentId: string, date: IsoDate) => PricePoint | null;

type Settlement = {
  date: IsoDate;
  settlementCurrency: string;
  fxRate: Decimal;
};

/**
 * PLN per one unit of the instrument's currency for a purchase or a sale. When the account
 * paid in złoty, the broker's own rate is the true cost; otherwise the NBP rate of that day.
 */
export function rateToPln(
  settlement: Settlement,
  instrumentCurrency: string,
  fxOn: FxOn,
): Decimal | null {
  if (instrumentCurrency === REPORTING_CURRENCY) {
    return ONE;
  }
  if (settlement.settlementCurrency === REPORTING_CURRENCY) {
    return settlement.fxRate;
  }
  return fxOn(instrumentCurrency, settlement.date);
}

function currentRate(currency: string, date: IsoDate, fxOn: FxOn): Decimal | null {
  return currency === REPORTING_CURRENCY ? ONE : fxOn(currency, date);
}

/** Adds values; the sum is null as soon as one of them is unknown. */
export function sumOrNull(values: readonly (Decimal | null)[]): Decimal | null {
  let total = ZERO;
  for (const value of values) {
    if (value === null) {
      return null;
    }
    total = total.plus(value);
  }
  return total;
}

/** A position valued in PLN. A field is null when a price or exchange rate it needs is missing. */
export type PositionValuation = {
  instrumentId: string;
  quantity: Decimal;
  price: PricePoint | null;
  value: Decimal | null;
  /** What the units still held cost. */
  cost: Decimal | null;
  /** value − cost, and its two parts: */
  unrealized: Decimal | null;
  /** the part that comes from the price changing, */
  priceEffect: Decimal | null;
  /** and the part that comes from the exchange rate changing. */
  fxEffect: Decimal | null;
  /** Result of all sales so far. */
  realized: Decimal | null;
  /** Dividends and coupons after withheld tax. */
  income: Decimal | null;
};

export function valuePosition(
  position: Position,
  instrumentCurrency: string,
  date: IsoDate,
  priceOn: PriceOn,
  fxOn: FxOn,
): PositionValuation {
  const price = position.quantity.isZero() ? null : priceOn(position.instrumentId, date);
  const rateNow = currentRate(instrumentCurrency, date, fxOn);
  const lots = position.lots.map((lot) => ({
    lot,
    rateAtPurchase: rateToPln(lot, instrumentCurrency, fxOn),
  }));

  const cost = sumOrNull(
    lots.map(({ lot, rateAtPurchase }) =>
      rateAtPurchase ? lot.quantity.times(lot.unitCost).times(rateAtPurchase) : null,
    ),
  );

  const held = !position.quantity.isZero();
  const known = !held || (price !== null && rateNow !== null);

  const value = !held ? ZERO : known ? position.quantity.times(price!.close).times(rateNow!) : null;

  const priceEffect = !held
    ? ZERO
    : known
      ? sumOrNull(
          lots.map(({ lot }) =>
            lot.quantity.times(price!.close.minus(lot.unitCost)).times(rateNow!),
          ),
        )
      : null;

  const fxEffect = !held
    ? ZERO
    : known
      ? sumOrNull(
          lots.map(({ lot, rateAtPurchase }) =>
            rateAtPurchase
              ? lot.quantity.times(lot.unitCost).times(rateNow!.minus(rateAtPurchase))
              : null,
          ),
        )
      : null;

  const realized = sumOrNull(
    position.realizations.map((realization) => {
      const rateAtSale = rateToPln(realization, instrumentCurrency, fxOn);
      const rateAtPurchase = rateToPln(realization.lot, instrumentCurrency, fxOn);
      if (!rateAtSale || !rateAtPurchase) {
        return null;
      }
      return realization.quantity.times(
        realization.unitProceeds
          .times(rateAtSale)
          .minus(realization.lot.unitCost.times(rateAtPurchase)),
      );
    }),
  );

  const income = sumOrNull(
    position.incomeEvents.map((event) => {
      const rate = currentRate(event.currency, event.date, fxOn);
      return rate ? event.gross.minus(event.tax).times(rate) : null;
    }),
  );

  return {
    instrumentId: position.instrumentId,
    quantity: position.quantity,
    price,
    value,
    cost,
    unrealized: value && cost ? value.minus(cost) : null,
    priceEffect,
    fxEffect,
    realized,
    income,
  };
}

export type CashValuation = {
  accountId: string;
  currency: string;
  balance: Decimal;
  value: Decimal | null;
};

export type PortfolioValuation = {
  positions: (PositionValuation & { accountId: string })[];
  cash: CashValuation[];
  totals: {
    /** Securities plus cash. */
    value: Decimal;
    holdingsValue: Decimal;
    cashValue: Decimal;
    cost: Decimal;
    unrealized: Decimal;
    priceEffect: Decimal;
    fxEffect: Decimal;
    realized: Decimal;
    income: Decimal;
    /** unrealized + realized + income */
    gain: Decimal;
    /** True when some value could not be computed and is missing from the totals. */
    incomplete: boolean;
  };
};

/** Values every position and cash balance of a portfolio in PLN as of `date`. */
export function valuePortfolio(
  accountLedgers: readonly AccountLedger[],
  instrumentCurrency: (instrumentId: string) => string,
  date: IsoDate,
  priceOn: PriceOn,
  fxOn: FxOn,
): PortfolioValuation {
  const positions = accountLedgers.flatMap(({ accountId, ledger }) =>
    ledger.positions.map((position) => ({
      accountId,
      ...valuePosition(position, instrumentCurrency(position.instrumentId), date, priceOn, fxOn),
    })),
  );

  const cash = accountLedgers.flatMap(({ accountId, ledger }) =>
    Object.entries(ledger.cash)
      .filter(([, balance]) => !balance.isZero())
      .map(([currency, balance]): CashValuation => {
        const rate = currentRate(currency, date, fxOn);
        return { accountId, currency, balance, value: rate ? balance.times(rate) : null };
      }),
  );

  let incomplete = false;
  const total = (values: (Decimal | null)[]) =>
    values.reduce<Decimal>((sum, value) => {
      if (value === null) {
        incomplete = true;
        return sum;
      }
      return sum.plus(value);
    }, ZERO);

  const holdingsValue = total(positions.map((position) => position.value));
  const cashValue = total(cash.map((balance) => balance.value));
  const unrealized = total(positions.map((position) => position.unrealized));
  const realized = total(positions.map((position) => position.realized));
  const income = total(positions.map((position) => position.income));

  return {
    positions,
    cash,
    totals: {
      value: holdingsValue.plus(cashValue),
      holdingsValue,
      cashValue,
      cost: total(positions.map((position) => position.cost)),
      unrealized,
      priceEffect: total(positions.map((position) => position.priceEffect)),
      fxEffect: total(positions.map((position) => position.fxEffect)),
      realized,
      income,
      gain: unrealized.plus(realized).plus(income),
      incomplete,
    },
  };
}

/** Combines the valuations of one instrument held on several accounts. */
export function combineByInstrument(positions: readonly PositionValuation[]): PositionValuation[] {
  const groups = new Map<string, PositionValuation[]>();
  for (const position of positions) {
    groups.set(position.instrumentId, [...(groups.get(position.instrumentId) ?? []), position]);
  }

  return [...groups.values()].map((group) => ({
    instrumentId: group[0].instrumentId,
    quantity: Decimal.sum(ZERO, ...group.map((position) => position.quantity)),
    price: group.find((position) => position.price)?.price ?? null,
    value: sumOrNull(group.map((position) => position.value)),
    cost: sumOrNull(group.map((position) => position.cost)),
    unrealized: sumOrNull(group.map((position) => position.unrealized)),
    priceEffect: sumOrNull(group.map((position) => position.priceEffect)),
    fxEffect: sumOrNull(group.map((position) => position.fxEffect)),
    realized: sumOrNull(group.map((position) => position.realized)),
    income: sumOrNull(group.map((position) => position.income)),
  }));
}

export type AllocationSlice = {
  key: string;
  value: Decimal;
  /** Share of the total, from 0 to 1. */
  share: number;
};

/** Groups positive values by key and expresses each group as a share of the total. */
export function allocate(items: readonly { key: string; value: Decimal }[]): AllocationSlice[] {
  const byKey = new Map<string, Decimal>();
  for (const { key, value } of items) {
    if (value.gt(0)) {
      byKey.set(key, (byKey.get(key) ?? ZERO).plus(value));
    }
  }

  const total = Decimal.sum(ZERO, ...byKey.values());

  return [...byKey]
    .map(([key, value]) => ({ key, value, share: value.div(total).toNumber() }))
    .sort((a, b) => b.value.comparedTo(a.value) || a.key.localeCompare(b.key));
}
