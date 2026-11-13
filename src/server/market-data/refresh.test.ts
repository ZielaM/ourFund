import { describe, expect, it } from "vitest";
import { fetchRange } from "./refresh";

describe("fetchRange", () => {
  const today = "2026-11-13";

  it("asks for the whole period when nothing is stored", () => {
    expect(fetchRange("2026-01-03", null, today)).toEqual({ from: "2026-01-03", to: today });
  });

  it("asks only for the last few days when the history is complete", () => {
    expect(fetchRange("2026-01-03", { min: "2026-01-03", max: "2026-11-12" }, today)).toEqual({
      from: "2026-11-07",
      to: today,
    });
  });

  it("asks for the whole period again when an older transaction was added", () => {
    expect(fetchRange("2025-06-01", { min: "2026-01-03", max: "2026-11-12" }, today)).toEqual({
      from: "2025-06-01",
      to: today,
    });
  });

  it("never asks for days before the wanted start", () => {
    expect(fetchRange("2026-11-10", { min: "2026-11-10", max: "2026-11-12" }, today)).toEqual({
      from: "2026-11-10",
      to: today,
    });
  });
});
