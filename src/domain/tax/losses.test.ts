import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { deductLosses, isUsable, type LossPool } from "./losses";

const d = (value: number | string) => new Decimal(value);
const pool = (
  year: number,
  original: number,
  remaining = original,
  oneOffUsed = false,
): LossPool => ({
  year,
  original: d(original),
  remaining: d(remaining),
  oneOffUsed,
});
const run = (pools: LossPool[], year: number, income: number) => {
  const result = deductLosses(pools, year, d(income));
  return {
    total: result.deduction.total.toFixed(),
    parts: result.deduction.parts.map((part) => [part.year, part.amount.toFixed()]),
    left: result.pools.map((p) => [p.year, p.remaining.toFixed(), p.oneOffUsed]),
  };
};

describe("isUsable", () => {
  it("covers the five years after the loss, while something is left of it", () => {
    expect(isUsable(pool(2021, 100), 2021)).toBe(false);
    expect(isUsable(pool(2021, 100), 2022)).toBe(true);
    expect(isUsable(pool(2021, 100), 2026)).toBe(true);
    expect(isUsable(pool(2021, 100), 2027)).toBe(false);
    expect(isUsable(pool(2021, 100, 0), 2023)).toBe(false);
  });
});

describe("deductLosses", () => {
  it("deducts a whole loss at once when the income allows it", () => {
    expect(run([pool(2024, 1000)], 2025, 5000)).toEqual({
      total: "1000",
      parts: [[2024, "1000"]],
      left: [[2024, "0", true]],
    });
  });

  it("keeps the single larger deduction when half of the loss is enough", () => {
    expect(run([pool(2024, 1000)], 2025, 300)).toEqual({
      total: "300",
      parts: [[2024, "300"]],
      left: [[2024, "700", false]],
    });
    // The following year the rest goes at once.
    expect(run([pool(2024, 1000, 700)], 2026, 5000).total).toBe("700");
  });

  it("is limited to half of the loss once the larger deduction is spent", () => {
    expect(run([pool(2022, 1000, 400, true)], 2025, 5000)).toEqual({
      total: "400",
      parts: [[2022, "400"]],
      left: [[2022, "0", true]],
    });
    expect(run([pool(2022, 2000, 1400, true)], 2025, 5000).total).toBe("1000");
  });

  it("uses the oldest loss first and several losses in one year", () => {
    expect(run([pool(2024, 600), pool(2022, 400)], 2025, 700)).toEqual({
      total: "700",
      parts: [
        [2022, "400"],
        [2024, "300"],
      ],
      left: [
        [2022, "0", true],
        [2024, "300", false],
      ],
    });
  });

  it("ignores losses that have expired, are not yet usable, or when there is no income", () => {
    expect(run([pool(2019, 1000)], 2025, 5000).total).toBe("0");
    expect(run([pool(2025, 1000)], 2025, 5000).total).toBe("0");
    expect(run([pool(2024, 1000)], 2025, 0)).toMatchObject({ total: "0", parts: [] });
    expect(run([pool(2024, 1000)], 2025, -50)).toMatchObject({ total: "0", parts: [] });
  });

  it("never deducts more than five million of one loss at a time", () => {
    expect(run([pool(2024, 12_000_000)], 2025, 20_000_000)).toEqual({
      total: "5000000",
      parts: [[2024, "5000000"]],
      left: [[2024, "7000000", true]],
    });
  });
});
