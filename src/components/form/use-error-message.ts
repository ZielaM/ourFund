"use client";

import { useTranslations } from "next-intl";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/domain/auth/schemas";

/** Turns an error code from a Server Action into the text shown to the user. */
export function useErrorMessage() {
  const t = useTranslations("errors");

  return (code: string, params?: Record<string, number>): string => {
    const key = (t.has(code as never) ? code : "unknown") as Parameters<typeof t>[0];
    return t(key, { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH, ...params });
  };
}
