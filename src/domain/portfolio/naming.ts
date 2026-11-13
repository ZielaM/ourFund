import { z } from "zod";
import { isCurrency } from "./currencies";
import { MARKETS } from "./markets";

export const ACCOUNT_TYPES = ["STANDARD", "IKE", "IKZE", "OKI"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const INSTRUMENT_TYPES = ["STOCK", "ETF", "BOND", "CRYPTO"] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const NAME_MAX_LENGTH = 60;
export const INSTRUMENT_NAME_MAX_LENGTH = 120;

/** 1–20 characters: letters, digits, dot, hyphen; starts with a letter or digit. */
export const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;

// Validation messages are error codes; the UI translates them (see `errors` in the messages file).
function name(maxLength: number) {
  return z
    .string("required")
    .transform((raw) => raw.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, "required").max(maxLength, "name.tooLong"));
}

export const portfolioInputSchema = z.object({
  name: name(NAME_MAX_LENGTH),
});

export const accountInputSchema = z.object({
  name: name(NAME_MAX_LENGTH),
  type: z.enum(ACCOUNT_TYPES, "required"),
  institution: z
    .string()
    .optional()
    .transform((raw) => raw?.trim().replace(/\s+/g, " ") || null)
    .refine((value) => value === null || value.length <= NAME_MAX_LENGTH, "name.tooLong"),
});

export const instrumentInputSchema = z.object({
  symbol: z
    .string("required")
    .transform((raw) => raw.trim().toUpperCase())
    .pipe(z.string().min(1, "required").regex(SYMBOL_PATTERN, "symbol.invalid")),
  market: z.enum(MARKETS, "required"),
  name: name(INSTRUMENT_NAME_MAX_LENGTH),
  type: z.enum(INSTRUMENT_TYPES, "required"),
  currency: z
    .string("required")
    .transform((raw) => raw.trim().toUpperCase())
    .refine(isCurrency, "currency.invalid"),
});

export type PortfolioInput = z.infer<typeof portfolioInputSchema>;
export type AccountInput = z.infer<typeof accountInputSchema>;
export type InstrumentInput = z.infer<typeof instrumentInputSchema>;
