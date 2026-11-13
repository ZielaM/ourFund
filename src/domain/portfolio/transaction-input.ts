import { z } from "zod";
import { Decimal } from "@/domain/decimal";
import { isCurrency } from "./currencies";
import { EARLIEST_DATE, isIsoDate } from "./dates";
import { parseDecimalInput } from "./decimal-input";

export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "FEE",
  "DEPOSIT",
  "WITHDRAWAL",
  "SPLIT",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const NOTE_MAX_LENGTH = 500;

// Limits of the NUMERIC columns that store these values.
const MAX_DECIMAL_PLACES = 10;
const MAX_FX_DECIMAL_PLACES = 8;
const MAX_VALUE = new Decimal("1e15");

// Validation messages are error codes; the UI translates them (see `errors` in the messages file).
function decimal(maxDecimalPlaces = MAX_DECIMAL_PLACES) {
  return z.string("required").transform((raw, context) => {
    if (raw.trim() === "") {
      context.addIssue({ code: "custom", message: "required" });
      return z.NEVER;
    }

    const value = parseDecimalInput(raw);
    if (!value) {
      context.addIssue({ code: "custom", message: "number.invalid" });
      return z.NEVER;
    }
    if (value.decimalPlaces() > maxDecimalPlaces) {
      context.addIssue({ code: "custom", message: "number.tooPrecise" });
      return z.NEVER;
    }
    if (value.gte(MAX_VALUE)) {
      context.addIssue({ code: "custom", message: "number.tooLarge" });
      return z.NEVER;
    }

    return value;
  });
}

const positive = (maxDecimalPlaces?: number) =>
  decimal(maxDecimalPlaces).refine((value) => value.gt(0), "number.positive");

/** An optional amount: an empty field means zero. */
const optionalAmount = z
  .string()
  .optional()
  .transform((raw) => (raw === undefined || raw.trim() === "" ? "0" : raw))
  .pipe(decimal());

const uuid = z.uuid("required");

const currency = z
  .string("required")
  .transform((raw) => raw.trim().toUpperCase())
  .refine(isCurrency, "currency.invalid");

const base = {
  accountId: uuid,
  date: z.string("required").check((context) => {
    if (context.value === "") {
      context.issues.push({ code: "custom", message: "required", input: context.value });
    } else if (!isIsoDate(context.value) || context.value < EARLIEST_DATE) {
      context.issues.push({ code: "custom", message: "date.invalid", input: context.value });
    }
  }),
  note: z
    .string()
    .optional()
    .transform((raw) => raw?.trim() || null)
    .refine((value) => value === null || value.length <= NOTE_MAX_LENGTH, "note.tooLong"),
};

const trade = {
  ...base,
  instrumentId: uuid,
  quantity: positive(),
  price: decimal(),
  fee: optionalAmount,
  /** Empty means "the instrument's currency"; the service fills it in. */
  currency: z
    .string()
    .optional()
    .transform((raw) => raw?.trim().toUpperCase() || null)
    .refine((value) => value === null || isCurrency(value), "currency.invalid"),
  /** Empty means 1: paid in the instrument's own currency. */
  fxRate: z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw.trim() === "" ? "1" : raw))
    .pipe(positive(MAX_FX_DECIMAL_PLACES)),
};

const income = {
  ...base,
  amount: positive(),
  tax: optionalAmount,
  currency,
};

const cash = {
  ...base,
  amount: positive(),
  currency,
};

function taxWithinAmount(data: { amount: Decimal; tax: Decimal }): boolean {
  return data.tax.lte(data.amount);
}

const taxTooHigh = { path: ["tax"], message: "tax.exceedsAmount" };

export const transactionInputSchema = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("BUY"), ...trade }),
    z.object({ type: z.literal("SELL"), ...trade }),
    z
      .object({ type: z.literal("DIVIDEND"), ...income, instrumentId: uuid })
      .refine(taxWithinAmount, taxTooHigh),
    z
      .object({
        type: z.literal("INTEREST"),
        ...income,
        /** Coupons belong to a bond; interest on idle cash has no instrument. */
        instrumentId: z
          .string()
          .optional()
          .transform((raw) => raw?.trim() || null)
          .refine((value) => value === null || uuid.safeParse(value).success, "required"),
      })
      .refine(taxWithinAmount, taxTooHigh),
    z.object({ type: z.literal("FEE"), ...cash }),
    z.object({ type: z.literal("DEPOSIT"), ...cash }),
    z.object({ type: z.literal("WITHDRAWAL"), ...cash }),
    z.object({
      type: z.literal("SPLIT"),
      ...base,
      instrumentId: uuid,
      splitRatio: positive(MAX_FX_DECIMAL_PLACES).refine(
        (value) => !value.eq(1),
        "splitRatio.noChange",
      ),
    }),
  ],
  { error: "required" },
);

export type TransactionInput = z.infer<typeof transactionInputSchema>;
