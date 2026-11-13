import { describe, expect, it } from "vitest";
import { normalizeUsername, USERNAME_PATTERN } from "./username";

describe("normalizeUsername", () => {
  it("trims and lower-cases", () => {
    expect(normalizeUsername("  Ania.Kowalska ")).toBe("ania.kowalska");
  });
});

describe("USERNAME_PATTERN", () => {
  it.each(["ania", "jan_kowalski", "a-b", "user.name-01", "abc", "a".repeat(32)])(
    "accepts %s",
    (name) => {
      expect(USERNAME_PATTERN.test(name)).toBe(true);
    },
  );

  it.each([
    ["too short", "ab"],
    ["too long", "a".repeat(33)],
    ["upper case", "Ania"],
    ["a space", "ania kowalska"],
    ["Polish letters", "żaneta"],
    ["a leading dot", ".ania"],
    ["an e-mail address", "ania@example.com"],
    ["empty", ""],
  ])("rejects %s", (_reason, name) => {
    expect(USERNAME_PATTERN.test(name)).toBe(false);
  });
});
