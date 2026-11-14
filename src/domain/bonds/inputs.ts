import { z } from "zod";
import { Decimal } from "@/domain/decimal";
import { parseDecimalInput } from "@/domain/portfolio/decimal-input";
import { BOND_SERIES_PATTERN, bondKindOf, periodCount } from "./kinds";

/** Rates above this are certainly typos (5.35 entered as 535). */
const MAX_RATE_PERCENT = 50;
const MAX_RATE_DECIMAL_PLACES = 4;

// Validation messages are error codes; the UI translates them (see `errors` in the messages file).

/** A yearly rate typed as a percentage, e.g. "5,35". */
function percent(options: { required: boolean }) {
  return z
    .string()
    .optional()
    .transform((raw, context) => {
      const text = raw?.trim() ?? "";
      if (text === "") {
        if (options.required) {
          context.addIssue({ code: "custom", message: "required" });
          return z.NEVER;
        }
        return null;
      }

      const value = parseDecimalInput(text);
      if (!value || value.gt(MAX_RATE_PERCENT) || value.decimalPlaces() > MAX_RATE_DECIMAL_PLACES) {
        context.addIssue({ code: "custom", message: "rate.invalid" });
        return z.NEVER;
      }

      return value;
    });
}

export const bondInputSchema = z.object({
  series: z
    .string("required")
    .transform((raw) => raw.trim().toUpperCase())
    .pipe(
      z.string().check((context) => {
        if (context.value === "") {
          context.issues.push({ code: "custom", message: "required", input: context.value });
        } else if (!BOND_SERIES_PATTERN.test(context.value)) {
          context.issues.push({
            code: "custom",
            message: "bondSeries.invalid",
            input: context.value,
          });
        }
      }),
    ),
  firstRate: percent({ required: true }).refine(
    (value) => value === null || value.gt(0),
    "rate.invalid",
  ),
  margin: percent({ required: false }),
});

export type BondInput = {
  series: string;
  firstRate: Decimal;
  margin: Decimal | null;
};

/** The rate of a later period; which periods exist depends on the kind of the series. */
export function bondRateSchema(series: string) {
  const kind = bondKindOf(series);
  const periods = kind ? periodCount(kind) : 0;

  return z.object({
    period: z
      .string("required")
      .min(1, "required")
      .transform(Number)
      .refine(
        (value) => Number.isInteger(value) && value >= 2 && value <= periods,
        "period.invalid",
      ),
    rate: percent({ required: true }),
  });
}
