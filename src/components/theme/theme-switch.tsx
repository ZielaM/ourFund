"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { setThemeChoice, useTheme } from "./theme-store";

/** One button in the header: flips between the light and the dark look. */
export function ThemeSwitch() {
  const t = useTranslations("theme");
  const theme = useTheme();
  const label = theme === "dark" ? t("useLight") : t("useDark");
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setThemeChoice(theme === "dark" ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon aria-hidden="true" className="size-4.5" />
    </button>
  );
}
