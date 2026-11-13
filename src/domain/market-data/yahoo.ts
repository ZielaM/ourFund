import { z } from "zod";
import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";

export type DailyClose = {
  date: IsoDate;
  close: Decimal;
};

export type YahooChart =
  | { ok: true; currency: string; closes: DailyClose[] }
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

/** Reads the daily closes out of a Yahoo Finance chart response. */
export function parseYahooChart(json: unknown): YahooChart {
  const parsed = chartSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: "malformed" };
  }

  const { result, error } = parsed.data.chart;
  if (error || !result || result.length === 0) {
    return { ok: false, reason: error?.code === "Not Found" ? "notFound" : "malformed" };
  }

  const { meta, timestamp = [], indicators } = result[0];
  const values = indicators.quote[0]?.close ?? [];
  const byDate = new Map<IsoDate, Decimal>();

  timestamp.forEach((time, index) => {
    const value = values[index];
    // Days without trading come back as null.
    if (typeof value === "number" && value > 0) {
      byDate.set(barDate(time, meta.gmtoffset), cleanClose(value));
    }
  });

  return {
    ok: true,
    currency: meta.currency,
    closes: [...byDate].map(([date, close]) => ({ date, close })),
  };
}

/**
 * Converts closes into the instrument's currency. London quotes most shares in pence
 * ("GBp"/"GBX"), while the instrument is kept in pounds. Returns null when the provider's
 * currency is simply a different one: such prices must not be stored.
 */
export function closesInCurrency(
  closes: DailyClose[],
  quotedIn: string,
  instrumentCurrency: string,
): DailyClose[] | null {
  if (quotedIn === instrumentCurrency) {
    return closes;
  }

  if ((quotedIn === "GBp" || quotedIn === "GBX") && instrumentCurrency === "GBP") {
    return closes.map(({ date, close }) => ({ date, close: close.div(100) }));
  }

  return null;
}
