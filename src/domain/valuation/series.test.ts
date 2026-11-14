import { describe, expect, it } from "vitest";
import { createLookup } from "./series";

describe("createLookup", () => {
  const lookup = createLookup([
    { date: "2026-11-10", value: "b" },
    { date: "2026-11-06", value: "a" },
    { date: "2026-11-12", value: "c" },
  ]);

  it("returns the value of the exact day", () => {
    expect(lookup("2026-11-10")).toEqual({ date: "2026-11-10", value: "b" });
  });

  it("carries the last known value forward over days without one", () => {
    expect(lookup("2026-11-08")).toEqual({ date: "2026-11-06", value: "a" });
    expect(lookup("2026-11-11")).toEqual({ date: "2026-11-10", value: "b" });
    expect(lookup("2027-01-01")).toEqual({ date: "2026-11-12", value: "c" });
  });

  it("returns null before the first value", () => {
    expect(lookup("2026-11-05")).toBeNull();
  });

  it("returns null when there are no values at all", () => {
    expect(createLookup([])("2026-11-10")).toBeNull();
  });

  it("does not depend on the order of the points or modify them", () => {
    const points = [
      { date: "2026-11-12", value: 3 },
      { date: "2026-11-06", value: 1 },
    ];

    expect(createLookup(points)("2026-11-07")?.value).toBe(1);
    expect(points[0].date).toBe("2026-11-12");
  });
});
