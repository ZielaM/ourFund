"use client";

import { useTranslations } from "next-intl";

/** Turns a success code from a Server Action into the text shown to the user. */
export function useNoticeMessage() {
  const t = useTranslations("notices");

  return (code: string, params?: Record<string, string>): string =>
    t(code as Parameters<typeof t>[0], params);
}
