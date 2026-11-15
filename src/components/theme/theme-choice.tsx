"use client";

import { useTranslations } from "next-intl";
import { THEME_CHOICES } from "@/lib/theme";
import { setThemeChoice, useThemeChoice } from "./theme-store";

/** The full choice on the settings page, including "follow the system". */
export function ThemeChoice() {
  const t = useTranslations("theme");
  const current = useThemeChoice();

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="sr-only">{t("legend")}</legend>
      {THEME_CHOICES.map((choice) => (
        <label key={choice} className="flex w-fit cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="theme"
            value={choice}
            checked={current === choice}
            onChange={() => setThemeChoice(choice)}
            className="size-4 accent-primary"
          />
          {t(`choices.${choice}`)}
        </label>
      ))}
    </fieldset>
  );
}
