export const locales = ["pl"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "pl";
