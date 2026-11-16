import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";

export type InflationReading = {
  /** 1 for January. */
  month: number;
  /** Yearly change of consumer prices, in percent: 3.5 for prices 3.5% higher than a year ago. */
  value: Decimal;
};

export type ReferenceRateChange = {
  validFrom: IsoDate;
  /** In percent. */
  rate: Decimal;
};

/** In GUS's publication store, monthly periods are numbered 247 (January) to 258 (December). */
const FIRST_MONTH_PERIOD = 247;

const gusSchema = z.array(z.object({ "id-okres": z.number(), wartosc: z.number() }));

/**
 * Reads one year of GUS's indicator "consumer prices, same month of the previous year = 100":
 * 103.5 means prices rose by 3.5%. Null when the response is not what was expected.
 */
export function parseGusInflation(json: unknown): InflationReading[] | null {
  const parsed = gusSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }

  return parsed.data
    .map((row) => ({
      month: row["id-okres"] - FIRST_MONTH_PERIOD + 1,
      value: new Decimal(row.wartosc).minus(100).toDecimalPlaces(2),
    }))
    .filter(({ month }) => month >= 1 && month <= 12)
    .sort((a, b) => a.month - b.month);
}

const nbpSchema = z.object({
  stopy_procentowe_archiwum: z.object({
    pozycje: z.array(
      z.object({
        obowiazuje_od: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        pozycja: z.array(z.object({ id: z.string(), oprocentowanie: z.string() })),
      }),
    ),
  }),
});

/**
 * Reads NBP's archive of base interest rates and returns the changes of the reference rate,
 * oldest first. Null when the file is not what was expected.
 */
export function parseNbpReferenceRates(xml: string): ReferenceRateChange[] | null {
  let document: unknown;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseAttributeValue: false,
      isArray: (name) => name === "pozycje" || name === "pozycja",
    }).parse(xml);
  } catch {
    return null;
  }

  const parsed = nbpSchema.safeParse(document);
  if (!parsed.success) {
    return null;
  }

  const changes: ReferenceRateChange[] = [];
  for (const entry of parsed.data.stopy_procentowe_archiwum.pozycje) {
    const reference = entry.pozycja.find(({ id }) => id === "ref");
    if (!reference || !/^-?\d+(,\d+)?$/.test(reference.oprocentowanie)) {
      continue;
    }
    changes.push({
      validFrom: entry.obowiazuje_od,
      rate: new Decimal(reference.oprocentowanie.replace(",", ".")),
    });
  }

  return changes.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}
