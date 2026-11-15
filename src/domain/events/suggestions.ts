import { Decimal } from "@/domain/decimal";
import { addDays } from "@/domain/market-data/nbp";
import type { IsoDate } from "@/domain/portfolio/dates";
import type { LedgerEntry } from "@/domain/portfolio/ledger";

/** A dividend or a split reported by the quote provider. */
export type KnownEvent = {
  id: string;
  instrumentId: string;
  type: "DIVIDEND" | "SPLIT";
  date: IsoDate;
  /** DIVIDEND: gross amount per unit. SPLIT: new units per one old unit. */
  value: Decimal;
};

export type EventSuggestion =
  | {
      type: "SPLIT";
      eventId: string;
      instrumentId: string;
      date: IsoDate;
      ratio: Decimal;
      /** Units held when the split took effect. */
      quantity: Decimal;
    }
  | {
      type: "DIVIDEND";
      eventId: string;
      instrumentId: string;
      /** First day of trading without the right to the dividend. */
      date: IsoDate;
      perUnit: Decimal;
      /** Units held at the end of the day before. */
      quantity: Decimal;
      /** Gross amount: quantity times the amount per unit. */
      amount: Decimal;
    };

/** A recorded split counts for a reported one when the two are at most this far apart. */
const SPLIT_WINDOW_DAYS = 7;
/** A dividend is usually paid within weeks of the ex-dividend day; some take months. */
const PAYMENT_WINDOW_DAYS = 120;
/** A payment recorded slightly before the reported day is still that dividend. */
const EARLY_DAYS = 3;

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Units of one instrument held at the end of the day before `date`. */
function quantityBefore(entries: readonly LedgerEntry[], date: IsoDate): Decimal {
  let quantity = new Decimal(0);
  for (const entry of entries) {
    if (entry.date >= date) {
      continue;
    }
    if (entry.type === "BUY") {
      quantity = quantity.plus(entry.quantity);
    } else if (entry.type === "SELL") {
      quantity = quantity.minus(entry.quantity);
    } else if (entry.type === "SPLIT") {
      quantity = quantity.times(entry.splitRatio);
    }
  }
  return quantity;
}

/**
 * Compares what the quote provider reports with what ONE account has recorded, and returns
 * the dividends and splits that seem to be missing. These are hints for the owner, who
 * decides: the provider can be wrong, and a broker may have booked an event differently.
 *
 * A recorded dividend settles the latest reported one whose ex-dividend day precedes it;
 * a recorded split settles a reported one within a week of it. The quantities assume that
 * earlier splits are recorded, so a missing split should be dealt with first.
 */
export function suggestEvents(
  entries: readonly LedgerEntry[],
  events: readonly KnownEvent[],
  dismissed: ReadonlySet<string> = new Set(),
): EventSuggestion[] {
  const suggestions: EventSuggestion[] = [];
  const instrumentIds = new Set(events.map((event) => event.instrumentId));

  for (const instrumentId of instrumentIds) {
    const own = entries
      .filter((entry) => "instrumentId" in entry && entry.instrumentId === instrumentId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (own.length === 0) {
      continue;
    }

    const reported = events
      .filter((event) => event.instrumentId === instrumentId)
      .sort((a, b) => a.date.localeCompare(b.date));

    const recordedSplits = own.filter((entry) => entry.type === "SPLIT");
    for (const event of reported.filter(({ type }) => type === "SPLIT")) {
      const recorded = recordedSplits.some(
        (entry) => Math.abs(daysBetween(event.date, entry.date)) <= SPLIT_WINDOW_DAYS,
      );
      const quantity = quantityBefore(own, event.date);
      if (!recorded && quantity.gt(0) && !dismissed.has(event.id)) {
        suggestions.push({
          type: "SPLIT",
          eventId: event.id,
          instrumentId,
          date: event.date,
          ratio: event.value,
          quantity,
        });
      }
    }

    const dividends = reported.filter(({ type }) => type === "DIVIDEND");
    const settled = new Set<string>();
    for (const payment of own.filter((entry) => entry.type === "DIVIDEND")) {
      const match = dividends.findLast(
        (event) =>
          !settled.has(event.id) &&
          event.date <= addDays(payment.date, EARLY_DAYS) &&
          daysBetween(event.date, payment.date) <= PAYMENT_WINDOW_DAYS,
      );
      if (match) {
        settled.add(match.id);
      }
    }

    for (const event of dividends) {
      const quantity = quantityBefore(own, event.date);
      if (settled.has(event.id) || dismissed.has(event.id) || !quantity.gt(0)) {
        continue;
      }
      suggestions.push({
        type: "DIVIDEND",
        eventId: event.id,
        instrumentId,
        date: event.date,
        perUnit: event.value,
        quantity,
        amount: quantity.times(event.value),
      });
    }
  }

  const splitFirst = (suggestion: EventSuggestion) => (suggestion.type === "SPLIT" ? 0 : 1);
  return suggestions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      splitFirst(a) - splitFirst(b) ||
      a.instrumentId.localeCompare(b.instrumentId),
  );
}

/**
 * A split ratio the way announcements write it: "4:1" for four new units per old one,
 * "1:10" for a reverse split. Falls back to "x:1" when no small whole numbers fit.
 */
export function describeSplitRatio(ratio: Decimal): string {
  for (let old = 1; old <= 20; old += 1) {
    const fresh = ratio.times(old);
    if (fresh.isInteger()) {
      return `${fresh.toFixed()}:${old}`;
    }
  }
  return `${ratio.toFixed()}:1`;
}
