/** 3–32 characters: lower-case letters, digits, dot, underscore, hyphen; starts with a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** User names are case-insensitive: "Ania" and "ania" are the same account. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}
