import {
  aggregateHoldings,
  listCashBalances,
  type CashBalance,
  type Holding,
} from "@/domain/portfolio/holdings";
import { computeLedger } from "@/domain/portfolio/ledger";
import type { SessionUser } from "@/server/auth/sessions";
import type { Db } from "@/server/db/types";
import type { InstrumentSummary } from "./instruments";
import { getPortfolio } from "./portfolios";
import { ledgerOrder, toLedgerEntry } from "./transactions";

export type HoldingView = Holding & { instrument: InstrumentSummary };

export type CashView = CashBalance & { accountName: string };

export type PortfolioHoldings = {
  /** Every instrument ever held in the portfolio, sorted by symbol; closed positions included. */
  holdings: HoldingView[];
  cash: CashView[];
};

/** What a portfolio holds now, computed from its transactions. Null when it is not the user's. */
export async function getPortfolioHoldings(
  db: Db,
  actor: SessionUser,
  portfolioId: string,
): Promise<PortfolioHoldings | null> {
  const portfolio = await getPortfolio(db, actor, portfolioId);
  if (!portfolio) {
    return null;
  }

  const rows = await db.transaction.findMany({
    where: { account: { portfolioId } },
    orderBy: [...ledgerOrder],
  });

  // FIFO lots are kept per account, so each account is replayed on its own.
  const accountLedgers = portfolio.accounts.map((account) => ({
    accountId: account.id,
    ledger: computeLedger(rows.filter((row) => row.accountId === account.id).map(toLedgerEntry)),
  }));

  const holdings = aggregateHoldings(accountLedgers);
  const instruments = await db.instrument.findMany({
    where: { id: { in: holdings.map((holding) => holding.instrumentId) } },
    select: { id: true, symbol: true, market: true, name: true, type: true, currency: true },
  });
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const accountName = new Map(portfolio.accounts.map((account) => [account.id, account.name]));

  return {
    holdings: holdings
      .map((holding) => ({ ...holding, instrument: instrumentById.get(holding.instrumentId)! }))
      .sort((a, b) => a.instrument.symbol.localeCompare(b.instrument.symbol)),
    cash: listCashBalances(accountLedgers).map((balance) => ({
      ...balance,
      accountName: accountName.get(balance.accountId)!,
    })),
  };
}
