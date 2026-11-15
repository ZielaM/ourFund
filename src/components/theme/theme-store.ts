"use client";

import { useSyncExternalStore } from "react";
import {
  DARK_SCHEME_QUERY,
  parseThemeChoice,
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemeChoice,
} from "@/lib/theme";

const CHANGE_EVENT = "themechange";

/** Used when the browser refuses storage, so the switch still works until the tab closes. */
let unsavedChoice: ThemeChoice | null = null;

export function readThemeChoice(): ThemeChoice {
  if (unsavedChoice) {
    return unsavedChoice;
  }
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function readTheme(): Theme {
  return resolveTheme(readThemeChoice(), window.matchMedia(DARK_SCHEME_QUERY).matches);
}

/** Puts the current look on <html>, where the colour tokens are switched. */
export function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", readTheme());
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
    unsavedChoice = null;
  } catch {
    unsavedChoice = choice;
  }
  applyTheme();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Calls back when the choice changes here, in another tab, or in the system settings. */
export function subscribeToTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The look in use. The server cannot know it, so the first render assumes light. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeToTheme, readTheme, () => "light");
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeToTheme, readThemeChoice, () => "system");
}
