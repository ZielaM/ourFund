import { Decimal } from "@/domain/decimal";
import type { Ledger } from "./ledger";

const ZERO = new Decimal(0);

export type AccountLedger = {
  accountId: string;
  ledger: Ledger;
};

/** One instrument across all accounts of a portfolio. */
export type Holding = {
  instrumentId: string;
  quantity: Decimal;
  /** Cost of the units still held, in the instrument's currency. */
  costBasis: Decimal;
  averageCost: Decimal | null;
  realizedGain: Decimal;
  /** Dividends and coupons after withheld tax, per currency. */
  income: Record<string, Decimal>;
  /** Where the units are held; accounts with a closed position are left out. */
  accounts: { accountId: string; quantity: Decimal }[];
};

export type CashBalance = {
  accountId: string;
  currency: string;
  balance: Decimal;
};

/**
 * Combines per-account ledgers into portfolio-wide holdings. Lots stay per account
 * (that is how FIFO and taxes work); only the totals are added up here.
 */
export function aggregateHoldings(accountLedgers: readonly AccountLedger[]): Holding[] {
  const byInstrument = new Map<string, Holding>();

  for (const { accountId, ledger } of accountLedgers) {
    for (const position of ledger.positions) {
      let holding = byInstrument.get(position.instrumentId);
      if (!holding) {
        holding = {
          instrumentId: position.instrumentId,
          quantity: ZERO,
          costBasis: ZERO,
          averageCost: null,
          realizedGain: ZERO,
          income: {},
          accounts: [],
        };
        byInstrument.set(position.instrumentId, holding);
      }

      holding.quantity = holding.quantity.plus(position.quantity);
      holding.costBasis = holding.costBasis.plus(position.costBasis);
      holding.realizedGain = holding.realizedGain.plus(position.realizedGain);

      for (const [currency, amount] of Object.entries(position.income)) {
        holding.income[currency] = (holding.income[currency] ?? ZERO).plus(amount);
      }

      if (!position.quantity.isZero()) {
        holding.accounts.push({ accountId, quantity: position.quantity });
      }
    }
  }

  for (const holding of byInstrument.values()) {
    holding.averageCost = holding.quantity.isZero()
      ? null
      : holding.costBasis.div(holding.quantity);
  }

  return [...byInstrument.values()];
}

/** Cash per account and currency, leaving out balances that are exactly zero. */
export function listCashBalances(accountLedgers: readonly AccountLedger[]): CashBalance[] {
  return accountLedgers.flatMap(({ accountId, ledger }) =>
    Object.entries(ledger.cash)
      .filter(([, balance]) => !balance.isZero())
      .map(([currency, balance]) => ({ accountId, currency, balance })),
  );
}
