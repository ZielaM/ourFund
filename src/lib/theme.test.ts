import { describe, expect, it } from "vitest";
import { parseThemeChoice, resolveTheme, THEME_SCRIPT } from "./theme";

describe("parseThemeChoice", () => {
  it("keeps the two forced looks and treats anything else as the system setting", () => {
    expect(parseThemeChoice("light")).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("sepia")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows the system only when nothing was forced", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("THEME_SCRIPT", () => {
  function run(stored: string | null, systemPrefersDark: boolean): string | undefined {
    const attributes: Record<string, string> = {};
    const scope = {
      localStorage: { getItem: () => stored },
      window: { matchMedia: () => ({ matches: systemPrefersDark }) },
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            attributes[name] = value;
          },
        },
      },
    };
    new Function("localStorage", "window", "document", THEME_SCRIPT)(
      scope.localStorage,
      scope.window,
      scope.document,
    );
    return attributes["data-theme"];
  }

  it("agrees with resolveTheme for every choice", () => {
    for (const stored of [null, "light", "dark", "sepia"]) {
      for (const systemPrefersDark of [true, false]) {
        expect(run(stored, systemPrefersDark)).toBe(
          resolveTheme(parseThemeChoice(stored), systemPrefersDark),
        );
      }
    }
  });

  it("falls back to the system setting when storage is blocked", () => {
    const attributes: Record<string, string> = {};
    new Function("localStorage", "window", "document", THEME_SCRIPT)(
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      { matchMedia: () => ({ matches: true }) },
      {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            attributes[name] = value;
          },
        },
      },
    );
    expect(attributes["data-theme"]).toBe("dark");
  });
});
