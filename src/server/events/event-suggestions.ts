import { Decimal } from "@/domain/decimal";
import { suggestEvents, type EventSuggestion } from "@/domain/events/suggestions";
import { utcToIsoDate } from "@/domain/portfolio/dates";
import { isDomesticMarket } from "@/domain/portfolio/markets";
import type { AccountType, PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/sessions";
import { getPortfolio, isUuid } from "@/server/portfolio/portfolios";
import { ledgerOrder, toLedgerEntry } from "@/server/portfolio/transactions";

export type EventSuggestionView = {
  /** Unique within a portfolio: the same event can be missing on several accounts. */
  key: string;
  account: { id: string; name: string; type: AccountType };
  instrument: { id: string; symbol: string; name: string; currency: string };
  suggestion: EventSuggestion;
  /**
   * DIVIDEND only: the tax a Polish payer withholds on a taxable account, as a starting
   * point for the form. Zero where nothing is withheld or the rate is not ours to know.
   */
  suggestedTax: Decimal | null;
};

const DOMESTIC_DIVIDEND_TAX = new Decimal("0.19");

/**
 * Dividends and splits reported by the quote provider that the accounts of a portfolio
 * have not recorded. Null when the portfolio is not the actor's.
 */
export async function getEventSuggestions(
  db: PrismaClient,
  actor: SessionUser,
  portfolioId: string,
): Promise<EventSuggestionView[] | null> {
  const portfolio = await getPortfolio(db, actor, portfolioId);
  if (!portfolio) {
    return null;
  }

  const accountIds = portfolio.accounts.map((account) => account.id);
  const [rows, dismissed] = await Promise.all([
    db.transaction.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: [...ledgerOrder],
    }),
    db.dismissedEvent.findMany({ where: { accountId: { in: accountIds } } }),
  ]);

  const instrumentIds = [...new Set(rows.flatMap((row) => row.instrumentId ?? []))];
  const [instruments, events] = await Promise.all([
    db.instrument.findMany({ where: { id: { in: instrumentIds } } }),
    db.instrumentEvent.findMany({
      // An instrument switched to manual prices keeps its old events, but is no longer followed.
      where: { instrumentId: { in: instrumentIds }, instrument: { priceSource: "YAHOO" } },
    }),
  ]);
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const known = events.map((event) => ({
    id: event.id,
    instrumentId: event.instrumentId,
    type: event.type,
    date: utcToIsoDate(event.date),
    value: new Decimal(event.value.toString()),
  }));

  return portfolio.accounts.flatMap((account) => {
    const entries = rows.filter((row) => row.accountId === account.id).map(toLedgerEntry);
    const skipped = new Set(
      dismissed.filter((row) => row.accountId === account.id).map((row) => row.eventId),
    );

    const splitFirst = (type: "SPLIT" | "DIVIDEND") => (type === "SPLIT" ? 0 : 1);
    const symbolOf = (instrumentId: string) => instrumentById.get(instrumentId)?.symbol ?? "";
    const suggestions = suggestEvents(entries, known, skipped).sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        splitFirst(a.type) - splitFirst(b.type) ||
        symbolOf(a.instrumentId).localeCompare(symbolOf(b.instrumentId)),
    );

    return suggestions.flatMap((suggestion) => {
      const instrument = instrumentById.get(suggestion.instrumentId);
      if (!instrument) {
        return [];
      }

      const withheld =
        suggestion.type === "DIVIDEND" &&
        account.type === "STANDARD" &&
        isDomesticMarket(instrument.market);
      return {
        key: `${account.id}:${suggestion.eventId}`,
        account: { id: account.id, name: account.name, type: account.type },
        instrument: {
          id: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
          currency: instrument.currency,
        },
        suggestion,
        suggestedTax:
          suggestion.type === "DIVIDEND"
            ? withheld
              ? suggestion.amount.times(DOMESTIC_DIVIDEND_TAX).toDecimalPlaces(2)
              : new Decimal(0)
            : null,
      };
    });
  });
}

/** Stops suggesting an event for one account. The event itself stays known. */
export async function dismissEvent(
  db: PrismaClient,
  actor: SessionUser,
  accountId: string,
  eventId: string,
): Promise<{ ok: true } | { ok: false; reason: "notFound" }> {
  if (!isUuid(accountId) || !isUuid(eventId)) {
    return { ok: false, reason: "notFound" };
  }

  const [account, event] = await Promise.all([
    db.account.findFirst({ where: { id: accountId, portfolio: { userId: actor.id } } }),
    db.instrumentEvent.findUnique({ where: { id: eventId } }),
  ]);
  if (!account || !event) {
    return { ok: false, reason: "notFound" };
  }

  await db.dismissedEvent.upsert({
    where: { accountId_eventId: { accountId, eventId } },
    create: { accountId, eventId },
    update: {},
  });
  return { ok: true };
}
