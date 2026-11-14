import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "./dates";

const ZERO = new Decimal(0);

type EntryBase = {
  id: string;
  date: IsoDate;
};

export type TradeEntry = EntryBase & {
  type: "BUY" | "SELL";
  instrumentId: string;
  quantity: Decimal;
  /** Price of one unit in the instrument's currency. */
  price: Decimal;
  /** Commission, in `currency`. */
  fee: Decimal;
  /** Currency in which cash moved on the account. */
  currency: string;
  /** Units of `currency` per one unit of the instrument's currency. */
  fxRate: Decimal;
};

export type IncomeEntry = EntryBase & {
  type: "DIVIDEND" | "INTEREST";
  instrumentId: string | null;
  /** Gross amount, in `currency`. */
  amount: Decimal;
  /** Tax withheld at source, in `currency`. */
  tax: Decimal;
  currency: string;
};

export type CashEntry = EntryBase & {
  type: "FEE" | "DEPOSIT" | "WITHDRAWAL";
  amount: Decimal;
  currency: string;
};

export type SplitEntry = EntryBase & {
  type: "SPLIT";
  instrumentId: string;
  /** New units per one old unit. */
  splitRatio: Decimal;
};

export type LedgerEntry = TradeEntry | IncomeEntry | CashEntry | SplitEntry;

/** Units bought together and not yet sold. Sales consume lots oldest first (FIFO). */
export type Lot = {
  transactionId: string;
  date: IsoDate;
  quantity: Decimal;
  /** Cost of one unit in the instrument's currency, including its share of the commission. */
  unitCost: Decimal;
  /** How the purchase was paid for; needed later to value the cost in PLN. */
  settlementCurrency: string;
  fxRate: Decimal;
};

/** Units of one lot sold in one sale. A sale that spans several lots yields several of these. */
export type Realization = {
  transactionId: string;
  date: IsoDate;
  quantity: Decimal;
  /** What one unit brought in, in the instrument's currency, after the commission. */
  unitProceeds: Decimal;
  /** How the sale was settled. */
  settlementCurrency: string;
  fxRate: Decimal;
  /** The lot the units came from. */
  lot: Omit<Lot, "quantity">;
};

/** A dividend or coupon received on a position. */
export type IncomeEvent = {
  transactionId: string;
  date: IsoDate;
  kind: "DIVIDEND" | "INTEREST";
  currency: string;
  gross: Decimal;
  tax: Decimal;
};

export type Position = {
  instrumentId: string;
  quantity: Decimal;
  /** Cost of the units still held, in the instrument's currency. */
  costBasis: Decimal;
  /** Cost basis per unit, or null when nothing is held. */
  averageCost: Decimal | null;
  lots: Lot[];
  /** Result of all sales so far, in the instrument's currency, after commissions. */
  realizedGain: Decimal;
  /** Dividends and coupons received after withheld tax, per currency. */
  income: Record<string, Decimal>;
  /** Every sale, matched to the lots it consumed (oldest first). */
  realizations: Realization[];
  /** Every dividend and coupon, in the order received. */
  incomeEvents: IncomeEvent[];
};

export type Ledger = {
  /** Every instrument that was ever held, including positions that are now closed. */
  positions: Position[];
  /** Cash balance per currency. May be negative when deposits were not recorded. */
  cash: Record<string, Decimal>;
};

export class LedgerError extends Error {
  constructor(
    readonly code: "insufficientQuantity",
    readonly details: {
      transactionId: string;
      instrumentId: string;
      available: Decimal;
      requested: Decimal;
    },
  ) {
    super(`Cannot sell ${details.requested} units: only ${details.available} held`);
    this.name = "LedgerError";
  }
}

type OpenPosition = {
  instrumentId: string;
  lots: Lot[];
  realizedGain: Decimal;
  income: Record<string, Decimal>;
  realizations: Realization[];
  incomeEvents: IncomeEvent[];
};

function addTo(balances: Record<string, Decimal>, currency: string, amount: Decimal): void {
  balances[currency] = (balances[currency] ?? ZERO).plus(amount);
}

/** How an entry changes the account's cash: the currency and the signed amount. */
export function cashFlow(entry: LedgerEntry): { currency: string; amount: Decimal } | null {
  switch (entry.type) {
    case "BUY":
      return {
        currency: entry.currency,
        amount: entry.quantity.times(entry.price).times(entry.fxRate).plus(entry.fee).negated(),
      };
    case "SELL":
      return {
        currency: entry.currency,
        amount: entry.quantity.times(entry.price).times(entry.fxRate).minus(entry.fee),
      };
    case "DIVIDEND":
    case "INTEREST":
      return { currency: entry.currency, amount: entry.amount.minus(entry.tax) };
    case "DEPOSIT":
      return { currency: entry.currency, amount: entry.amount };
    case "FEE":
    case "WITHDRAWAL":
      return { currency: entry.currency, amount: entry.amount.negated() };
    case "SPLIT":
      return null;
  }
}

/**
 * Replays the history of ONE account and returns what it holds now.
 *
 * Entries are processed by date; entries on the same day keep the order in which they were
 * given (callers pass them in the order they were recorded).
 */
export function computeLedger(entries: readonly LedgerEntry[]): Ledger {
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.index - b.index)
    .map(({ entry }) => entry);

  const open = new Map<string, OpenPosition>();
  const cash: Record<string, Decimal> = {};

  const positionFor = (instrumentId: string): OpenPosition => {
    let position = open.get(instrumentId);
    if (!position) {
      position = {
        instrumentId,
        lots: [],
        realizedGain: ZERO,
        income: {},
        realizations: [],
        incomeEvents: [],
      };
      open.set(instrumentId, position);
    }
    return position;
  };

  for (const entry of ordered) {
    switch (entry.type) {
      case "BUY": {
        const feeInInstrumentCurrency = entry.fee.div(entry.fxRate);
        positionFor(entry.instrumentId).lots.push({
          transactionId: entry.id,
          date: entry.date,
          quantity: entry.quantity,
          unitCost: entry.price.plus(feeInInstrumentCurrency.div(entry.quantity)),
          settlementCurrency: entry.currency,
          fxRate: entry.fxRate,
        });
        break;
      }

      case "SELL": {
        const position = positionFor(entry.instrumentId);
        const available = Decimal.sum(ZERO, ...position.lots.map((lot) => lot.quantity));

        if (entry.quantity.gt(available)) {
          throw new LedgerError("insufficientQuantity", {
            transactionId: entry.id,
            instrumentId: entry.instrumentId,
            available,
            requested: entry.quantity,
          });
        }

        let remaining = entry.quantity;
        let costOfSold = ZERO;
        const unitProceeds = entry.price.minus(entry.fee.div(entry.fxRate).div(entry.quantity));

        while (remaining.gt(0)) {
          const lot = position.lots[0];
          const taken = Decimal.min(lot.quantity, remaining);

          costOfSold = costOfSold.plus(taken.times(lot.unitCost));
          position.realizations.push({
            transactionId: entry.id,
            date: entry.date,
            quantity: taken,
            unitProceeds,
            settlementCurrency: entry.currency,
            fxRate: entry.fxRate,
            lot: {
              transactionId: lot.transactionId,
              date: lot.date,
              unitCost: lot.unitCost,
              settlementCurrency: lot.settlementCurrency,
              fxRate: lot.fxRate,
            },
          });
          lot.quantity = lot.quantity.minus(taken);
          remaining = remaining.minus(taken);

          if (lot.quantity.isZero()) {
            position.lots.shift();
          }
        }

        const proceeds = entry.quantity.times(entry.price).minus(entry.fee.div(entry.fxRate));
        position.realizedGain = position.realizedGain.plus(proceeds.minus(costOfSold));
        break;
      }

      case "SPLIT": {
        for (const lot of positionFor(entry.instrumentId).lots) {
          lot.quantity = lot.quantity.times(entry.splitRatio);
          lot.unitCost = lot.unitCost.div(entry.splitRatio);
        }
        break;
      }

      case "DIVIDEND":
      case "INTEREST": {
        if (entry.instrumentId) {
          const position = positionFor(entry.instrumentId);
          addTo(position.income, entry.currency, entry.amount.minus(entry.tax));
          position.incomeEvents.push({
            transactionId: entry.id,
            date: entry.date,
            kind: entry.type,
            currency: entry.currency,
            gross: entry.amount,
            tax: entry.tax,
          });
        }
        break;
      }

      case "DEPOSIT":
      case "FEE":
      case "WITHDRAWAL":
        break;
    }

    const flow = cashFlow(entry);
    if (flow) {
      addTo(cash, flow.currency, flow.amount);
    }
  }

  const positions = [...open.values()].map((position): Position => {
    const quantity = Decimal.sum(ZERO, ...position.lots.map((lot) => lot.quantity));
    const costBasis = Decimal.sum(
      ZERO,
      ...position.lots.map((lot) => lot.quantity.times(lot.unitCost)),
    );

    return {
      instrumentId: position.instrumentId,
      quantity,
      costBasis,
      averageCost: quantity.isZero() ? null : costBasis.div(quantity),
      lots: position.lots,
      realizedGain: position.realizedGain,
      income: position.income,
      realizations: position.realizations,
      incomeEvents: position.incomeEvents,
    };
  });

  return { positions, cash };
}

/** Paper result of a position at a given price, in the instrument's currency. */
export function unrealizedGain(position: Position, price: Decimal): Decimal {
  return position.quantity.times(price).minus(position.costBasis);
}
