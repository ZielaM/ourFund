"use client";

import { useLayoutEffect } from "react";
import { applyTheme, subscribeToTheme } from "./theme-store";

/**
 * Keeps <html data-theme> right after the inline script has run: when the system switches
 * between day and night, when another tab changes the choice, and in development, where
 * Strict Mode resets the attributes of <html>.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();
    return subscribeToTheme(applyTheme);
  }, []);

  return null;
}
