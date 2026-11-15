import { z } from "zod";
import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";

export type DailyClose = {
  date: IsoDate;
  close: Decimal;
};

/** A cash dividend: the day the shares first trade without it, and the amount per unit. */
export type DividendEvent = {
  date: IsoDate;
  amount: Decimal;
};

/** A split: the first day of trading after it, and new units per one old unit. */
export type SplitEvent = {
  date: IsoDate;
  ratio: Decimal;
};

export type YahooChart =
  | {
      ok: true;
      currency: string;
      closes: DailyClose[];
      dividends: DividendEvent[];
      splits: SplitEvent[];
    }
  | { ok: false; reason: "notFound" | "malformed" };

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ currency: z.string(), gmtoffset: z.number() }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(z.object({ close: z.array(z.number().nullable()).optional() })),
          }),
          events: z
            .object({
              dividends: z
                .record(z.string(), z.object({ date: z.number(), amount: z.number() }))
                .optional(),
              splits: z
                .record(
                  z.string(),
                  z.object({ date: z.number(), numerator: z.number(), denominator: z.number() }),
                )
                .optional(),
            })
            .optional(),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string() }).nullable().optional(),
  }),
});

/**
 * Yahoo sends prices as 32-bit floats (266.9 arrives as 266.8999938964844).
 * Seven significant digits recover the quoted price without inventing precision.
 */
export function cleanClose(value: number): Decimal {
  return new Decimal(value).toSignificantDigits(7);
}

/** The exchange-local calendar day of a bar: bars are stamped at the local market open. */
export function barDate(timestampSeconds: number, gmtOffsetSeconds: number): IsoDate {
  return new Date((timestampSeconds + gmtOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

const byDay = <T extends { date: IsoDate }>(a: T, b: T) => a.date.localeCompare(b.date);

/**
 * Yahoo rewrites history after a split: every earlier close and dividend is divided by the
 * split ratio, so that charts have no cliff. A ledger needs what was actually traded and
 * paid: ten shares bought at 1200 are not ten shares at 120. This multiplies each value back
 * by the ratios of the splits that came after it.
 *
 * The splits must cover every day up to today, which they do when the request ends today.
 */
export function undoSplitAdjustment<T extends { date: IsoDate }>(
  items: T[],
  splits: SplitEvent[],
  read: (item: T) => Decimal,
  write: (item: T, value: Decimal) => T,
): T[] {
  if (splits.length === 0) {
    return items;
  }

  return items.map((item) => {
    const factor = splits
      .filter((split) => split.date > item.date)
      .reduce((product, split) => product.times(split.ratio), new Decimal(1));
    return factor.eq(1) ? item : write(item, read(item).times(factor));
  });
}

/**
 * Reads daily closes, dividends and splits out of a Yahoo Finance chart response. Closes and
 * dividends are returned as traded and as paid, with Yahoo's split adjustment undone.
 */
export function parseYahooChart(json: unknown): YahooChart {
  const parsed = chartSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "malformed" };
  }

  const { result, error } = parsed.data.chart;
  if (error || !result || result.length === 0) {
    return { ok: false, reason: error?.code === "Not Found" ? "notFound" : "malformed" };
  }

  const { meta, timestamp = [], indicators, events } = result[0];
  const values = indicators.quote[0]?.close ?? [];
  const byDate = new Map<IsoDate, Decimal>();

  timestamp.forEach((time, index) => {
    const value = values[index];
    // Days without trading come back as null.
    if (typeof value === "number" && value > 0) {
      byDate.set(barDate(time, meta.gmtoffset), cleanClose(value));
    }
  });

  const splits: SplitEvent[] = Object.values(events?.splits ?? {})
    .filter((split) => split.numerator > 0 && split.denominator > 0)
    .map((split) => ({
      date: barDate(split.date, meta.gmtoffset),
      ratio: new Decimal(split.numerator).div(split.denominator),
    }))
    .filter((split) => !split.ratio.eq(1))
    .sort(byDay);

  const dividends: DividendEvent[] = Object.values(events?.dividends ?? {})
    .filter((dividend) => dividend.amount > 0)
    .map((dividend) => ({
      date: barDate(dividend.date, meta.gmtoffset),
      amount: cleanClose(dividend.amount),
    }))
    .sort(byDay);

  return {
    ok: true,
    currency: meta.currency,
    closes: undoSplitAdjustment(
      [...byDate].map(([date, close]) => ({ date, close })),
      splits,
      (bar) => bar.close,
      (bar, close) => ({ ...bar, close }),
    ),
    dividends: undoSplitAdjustment(
      dividends,
      splits,
      (dividend) => dividend.amount,
      (dividend, amount) => ({ ...dividend, amount }),
    ),
    splits,
  };
}

/**
 * What a quoted amount is multiplied by to express it in the instrument's currency. London
 * quotes most shares in pence ("GBp"/"GBX"), while the instrument is kept in pounds. Null
 * when the provider's currency is simply a different one: such prices must not be stored.
 */
export function currencyScale(quotedIn: string, instrumentCurrency: string): Decimal | null {
  if (quotedIn === instrumentCurrency) {
    return new Decimal(1);
  }

  if ((quotedIn === "GBp" || quotedIn === "GBX") && instrumentCurrency === "GBP") {
    return new Decimal("0.01");
  }

  return null;
}

/** Converts closes into the instrument's currency; null when that is not possible. */
export function closesInCurrency(
  closes: DailyClose[],
  quotedIn: string,
  instrumentCurrency: string,
): DailyClose[] | null {
  const scale = currencyScale(quotedIn, instrumentCurrency);
  if (!scale) {
    return null;
  }

  return scale.eq(1)
    ? closes
    : closes.map(({ date, close }) => ({ date, close: close.times(scale) }));
}
