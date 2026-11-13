import { z } from "zod";
import { isoDate, positive } from "@/domain/portfolio/transaction-input";

export const PRICE_SOURCES = ["YAHOO", "MANUAL"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** Yahoo symbols such as "CDR.WA", "BRK-B", "BTC-USD" or "EURPLN=X". */
export const QUOTE_SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.=^-]{0,29}$/;

// Validation messages are error codes; the UI translates them (see `errors` in the messages file).
export const quoteSettingsSchema = z.object({
  priceSource: z.enum(PRICE_SOURCES, "required"),
  /** Empty means "use the symbol derived from the instrument's symbol and market". */
  quoteSymbol: z
    .string()
    .optional()
    .transform((raw) => raw?.trim().toUpperCase() || null)
    .refine((value) => value === null || QUOTE_SYMBOL_PATTERN.test(value), "quoteSymbol.invalid"),
});

export const manualPriceSchema = z.object({
  date: isoDate,
  close: positive(),
});

export type QuoteSettingsInput = z.infer<typeof quoteSettingsSchema>;
export type ManualPriceInput = z.infer<typeof manualPriceSchema>;
