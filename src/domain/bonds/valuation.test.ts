import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { BondKind } from "./kinds";
import {
  addMonths,
  bondPeriods,
  bondValue,
  maturityDate,
  periodPayout,
  periodRate,
  type BondSeries,
} from "./valuation";

const d = (value: string) => new Decimal(value);

function series(kind: BondKind, firstRate: string, later: Record<number, string> = {}): BondSeries {
  return {
    kind,
    firstRate: d(firstRate),
    laterRates: new Map(Object.entries(later).map(([period, rate]) => [Number(period), d(rate)])),
  };
}

const worth = (bond: BondSeries, purchase: string, date: string) =>
  bondValue(bond, purchase, date).value.toFixed(2);

describe("addMonths", () => {
  it("keeps the day of the month", () => {
    expect(addMonths("2026-11-10", 1)).toBe("2026-12-10");
    expect(addMonths("2026-11-10", 3)).toBe("2027-02-10");
    expect(addMonths("2026-11-10", 120)).toBe("2036-11-10");
  });

  it("uses the last day of a shorter month, without drifting afterwards", () => {
    expect(addMonths("2025-11-29", 3)).toBe("2026-02-28");
    expect(addMonths("2025-11-29", 4)).toBe("2026-03-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-01-31", 3)).toBe("2026-04-30");
  });

  it("handles 29 February", () => {
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2024-02-29", 48)).toBe("2028-02-29");
  });
});

describe("bondPeriods", () => {
  it("counts periods from the day of purchase", () => {
    expect(bondPeriods("TOS", "2026-11-10")).toEqual([
      { number: 1, start: "2026-11-10", end: "2027-11-10" },
      { number: 2, start: "2027-11-10", end: "2028-11-10" },
      { number: 3, start: "2028-11-10", end: "2029-11-10" },
    ]);
  });

  it("gives monthly bonds a period per month, as in the official interest tables", () => {
    // A ROR bought on 29.11.2025: the tables list 29.01 -> 28.02 and 28.02 -> 29.03.
    const periods = bondPeriods("ROR", "2025-11-29");

    expect(periods).toHaveLength(12);
    expect(periods[2]).toEqual({ number: 3, start: "2026-01-29", end: "2026-02-28" });
    expect(periods[3]).toEqual({ number: 4, start: "2026-02-28", end: "2026-03-29" });
  });

  it("ends with the maturity date", () => {
    expect(bondPeriods("EDO", "2025-11-14").at(-1)?.end).toBe("2035-11-14");
    expect(maturityDate("EDO", "2025-11-14")).toBe("2035-11-14");
    expect(maturityDate("OTS", "2026-11-01")).toBe("2027-02-01");
    expect(maturityDate("ROD", "2026-11-01")).toBe("2038-11-01");
  });
});

describe("periodRate", () => {
  it("is the first rate in the first period", () => {
    expect(periodRate(series("EDO", "0.0535", { 2: "0.045" }), 1)).toEqual({
      rate: d("0.0535"),
      known: true,
    });
  });

  it("is the announced rate of a later period", () => {
    expect(periodRate(series("EDO", "0.0535", { 2: "0.045" }), 2)).toEqual({
      rate: d("0.045"),
      known: true,
    });
  });

  it("carries the last announced rate into periods without one and says so", () => {
    const bond = series("EDO", "0.0535", { 2: "0.045" });

    expect(periodRate(bond, 4)).toEqual({ rate: d("0.045"), known: false });
    expect(periodRate(series("EDO", "0.0535"), 3)).toEqual({ rate: d("0.0535"), known: false });
  });

  it("never changes for a fixed-rate bond", () => {
    expect(periodRate(series("TOS", "0.044", { 2: "0.09" }), 3)).toEqual({
      rate: d("0.044"),
      known: true,
    });
  });
});

describe("bondValue: OTS, three months, interest at maturity", () => {
  const bond = series("OTS", "0.02");
  const purchase = "2026-11-01";

  it("is worth 100.50 at maturity, as the offer states for 2.00%", () => {
    expect(bondValue(bond, purchase, "2027-02-01")).toMatchObject({ matured: true, period: 1 });
    expect(worth(bond, purchase, "2027-02-01")).toBe("100.50");
  });

  it("accrues in proportion to the days elapsed", () => {
    // 46 of the 92 days.
    expect(worth(bond, purchase, "2026-12-17")).toBe("100.25");
  });

  it("stays at the redemption amount after maturity", () => {
    expect(worth(bond, purchase, "2027-06-30")).toBe("100.50");
  });
});

describe("bondValue: ROR, monthly interest paid out", () => {
  const bond = series("ROR", "0.04", { 2: "0.0375" });
  const purchase = "2026-11-10";

  it("accrues a month's interest and returns to 100 when it is paid", () => {
    expect(worth(bond, purchase, "2026-11-10")).toBe("100.00");
    // 15 of 30 days of 100 × 4% / 12.
    expect(worth(bond, purchase, "2026-11-25")).toBe("100.17");
    expect(worth(bond, purchase, "2026-12-09")).toBe("100.32");
    expect(worth(bond, purchase, "2026-12-10")).toBe("100.00");
  });

  it("pays 0.33 for the first month and 0.31 for the second", () => {
    expect(periodPayout(bond, 1).toFixed(2)).toBe("0.33");
    expect(periodPayout(bond, 2).toFixed(2)).toBe("0.31");
  });

  it("uses the announced rate of the current month", () => {
    const value = bondValue(bond, purchase, "2026-12-25");

    // 15 of 31 days of 100 × 3.75% / 12.
    expect(value.value.toFixed(2)).toBe("100.15");
    expect(value).toMatchObject({ period: 2, ratesKnown: true });
  });

  it("flags a month whose rate has not been entered yet", () => {
    expect(bondValue(bond, purchase, "2027-01-20")).toMatchObject({ period: 3, ratesKnown: false });
  });

  it("is worth 100 plus the last month's interest at maturity", () => {
    expect(worth(bond, purchase, "2027-11-10")).toBe("100.31");
  });
});

describe("bondValue: TOS, fixed rate with yearly capitalization", () => {
  const bond = series("TOS", "0.044");
  const purchase = "2026-11-01";

  it("grows by 4.40% a year, each year on the value with interest added", () => {
    expect(worth(bond, purchase, "2027-11-01")).toBe("104.40");
    // 104.40 × 4.4% = 4.5936, rounded to 4.59.
    expect(worth(bond, purchase, "2028-11-01")).toBe("108.99");
    // 108.99 × 4.4% = 4.79556, rounded to 4.80.
    expect(worth(bond, purchase, "2029-11-01")).toBe("113.79");
  });

  it("accrues within a year on the capitalized value", () => {
    // 182 of 365 days of the first year.
    expect(worth(bond, purchase, "2027-05-02")).toBe("102.19");
    // 182 of 366 days of the second year, on 104.40.
    expect(worth(bond, purchase, "2028-05-01")).toBe("106.68");
  });

  it("needs no rates for later years", () => {
    expect(bondValue(bond, purchase, "2029-06-01").ratesKnown).toBe(true);
  });

  it("stops growing at maturity", () => {
    expect(bondValue(bond, purchase, "2031-01-01")).toMatchObject({ matured: true });
    expect(worth(bond, purchase, "2031-01-01")).toBe("113.79");
  });
});

describe("bondValue: EDO, inflation-indexed with yearly capitalization", () => {
  const bond = series("EDO", "0.0535", { 2: "0.045", 3: "0.06" });
  const purchase = "2026-11-14";

  it("uses the first-year rate, then each announced rate on the capitalized value", () => {
    expect(worth(bond, purchase, "2027-11-14")).toBe("105.35");
    // 105.35 × 4.5% = 4.74075, rounded to 4.74.
    expect(worth(bond, purchase, "2028-11-14")).toBe("110.09");
    // 110.09 × 6% = 6.6054, rounded to 6.61.
    expect(worth(bond, purchase, "2029-11-14")).toBe("116.70");
  });

  it("is not worth more on the purchase day or before it", () => {
    expect(worth(bond, purchase, "2026-11-14")).toBe("100.00");
    expect(worth(bond, purchase, "2026-11-01")).toBe("100.00");
  });

  it("counts the days of a leap year", () => {
    const leap = series("EDO", "0.0535");

    // 2027-03-01 to 2028-03-01 has 366 days; half of them have passed.
    expect(worth(leap, "2027-03-01", "2027-08-31")).toBe("102.68");
  });

  it("values a year without an announced rate at the last known one and flags it", () => {
    const value = bondValue(bond, purchase, "2030-05-14");

    expect(value).toMatchObject({ period: 4, ratesKnown: false });
    expect(value.value.gt(d("116.70"))).toBe(true);
  });

  it("depends on the day of purchase within the same series", () => {
    expect(worth(bond, "2026-11-01", "2027-05-01")).not.toBe(
      worth(bond, "2026-11-30", "2027-05-01"),
    );
  });
});

describe("bondValue: COI, inflation-indexed with yearly payout", () => {
  const bond = series("COI", "0.0475", { 2: "0.04" });
  const purchase = "2026-11-01";

  it("pays each year's interest out, so the value returns to 100", () => {
    expect(worth(bond, purchase, "2027-10-31")).toBe("104.74");
    expect(worth(bond, purchase, "2027-11-01")).toBe("100.00");
    expect(periodPayout(bond, 1).toFixed(2)).toBe("4.75");
    expect(periodPayout(bond, 2).toFixed(2)).toBe("4.00");
  });

  it("is worth 100 plus the last year's interest at maturity", () => {
    expect(worth(bond, purchase, "2030-11-01")).toBe("104.00");
  });
});

describe("periodPayout", () => {
  it("is zero for bonds that capitalize interest", () => {
    expect(periodPayout(series("EDO", "0.0535"), 1).toFixed(2)).toBe("0.00");
    expect(periodPayout(series("TOS", "0.044"), 2).toFixed(2)).toBe("0.00");
  });

  it("is a quarter of the yearly rate for OTS", () => {
    expect(periodPayout(series("OTS", "0.02"), 1).toFixed(2)).toBe("0.50");
  });
});
