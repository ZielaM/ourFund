/** What the user picked: follow the system, or force one of the two looks. */
export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type Theme = "light" | "dark";

/** Where the browser remembers the choice; "system" is stored as no entry at all. */
export const THEME_STORAGE_KEY = "theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): Theme {
  if (choice === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return choice;
}

/**
 * Runs in <head> before the first paint, so a saved dark choice never flashes light.
 * It has to repeat `parseThemeChoice` and `resolveTheme` by hand: it runs before any bundle.
 */
export const THEME_SCRIPT = `(function(){var c=null;try{c=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})}catch(e){}var d=c==="dark"||(c!=="light"&&window.matchMedia(${JSON.stringify(
  DARK_SCHEME_QUERY,
)}).matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")})()`;
