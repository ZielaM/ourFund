import { describe, expect, it } from "vitest";
import { thinOut } from "./portfolio-valuation";

describe("thinOut", () => {
  const points = Array.from({ length: 10 }, (_, index) => index);

  it("keeps a short series as it is", () => {
    expect(thinOut(points, 10)).toEqual(points);
    expect(thinOut(points, 50)).toEqual(points);
  });

  it("keeps evenly spaced points and always the last one", () => {
    expect(thinOut(points, 5)).toEqual([0, 2, 4, 6, 8, 9]);
    expect(thinOut(points, 3)).toEqual([0, 4, 8, 9]);
  });

  it("does not repeat the last point when it is already kept", () => {
    expect(thinOut([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
  });

  it("handles an empty series", () => {
    expect(thinOut([], 5)).toEqual([]);
  });
});
