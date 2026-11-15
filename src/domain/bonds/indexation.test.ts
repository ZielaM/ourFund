import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import {
  businessDaysBefore,
  indexedRates,
  isBusinessDay,
  isPolishHoliday,
  periodStartMonth,
  saleMonth,
  type IndexData,
} from "./indexation";

const d = (value: string) => new Decimal(value);
const noData: IndexData = { inflation: new Map(), referenceRates: [] };
const percent = (rates: Map<number, Decimal>) =>
  [...rates].map(([period, rate]) => [period, rate.toFixed()]);

describe("saleMonth and periodStartMonth", () => {
  it("reads the month of sale from the maturity in the symbol", () => {
    expect(saleMonth("EDO1135")).toEqual({ year: 2025, month: 11 });
    expect(saleMonth("ROR0627")).toEqual({ year: 2026, month: 6 });
    expect(saleMonth("COI0327")).toEqual({ year: 2023, month: 3 });
    expect(saleMonth("OTS0326")).toEqual({ year: 2025, month: 12 });
    expect(saleMonth("XYZ0130")).toBeNull();
  });

  it("starts yearly periods a year apart and monthly ones a month apart", () => {
    expect(periodStartMonth("EDO1135", 2)).toEqual({ year: 2026, month: 11 });
    expect(periodStartMonth("EDO1135", 10)).toEqual({ year: 2034, month: 11 });
    expect(periodStartMonth("ROR1226", 2)).toEqual({ year: 2026, month: 1 });
    expect(periodStartMonth("ROR1226", 12)).toEqual({ year: 2026, month: 11 });
    expect(periodStartMonth("nonsense", 2)).toBeNull();
  });
});

describe("business days", () => {
  it("knows the fixed and the movable Polish holidays", () => {
    // Easter fell on 5 April 2026: Easter Monday the 6th, Corpus Christi on 4 June.
    for (const day of ["2026-01-01", "2026-01-06", "2026-04-06", "2026-05-01", "2026-06-04"]) {
      expect(isPolishHoliday(day), day).toBe(true);
    }
    for (const day of ["2026-11-11", "2026-12-24", "2026-12-25", "2026-12-26", "2025-12-24"]) {
      expect(isPolishHoliday(day), day).toBe(true);
    }
    // Christmas Eve became a day off in 2025.
    expect(isPolishHoliday("2024-12-24")).toBe(false);
    expect(isPolishHoliday("2026-04-07")).toBe(false);
  });

  it("treats weekends and holidays as days off", () => {
    expect(isBusinessDay("2026-11-13")).toBe(true);
    expect(isBusinessDay("2026-11-14")).toBe(false);
    expect(isBusinessDay("2026-11-15")).toBe(false);
    expect(isBusinessDay("2026-11-11")).toBe(false);
  });

  it("counts business days backwards, skipping weekends and holidays", () => {
    // Before Monday 16 November 2026: Fri 13, Thu 12, (Wed 11 is a holiday), Tue 10.
    expect(businessDaysBefore("2026-11-16", 1)).toBe("2026-11-13");
    expect(businessDaysBefore("2026-11-16", 3)).toBe("2026-11-10");
    // The tenth business day before 1 June 2026 is Monday 18 May.
    expect(businessDaysBefore("2026-06-01", 10)).toBe("2026-05-18");
    // Before 1 January 2027 the Christmas days do not count.
    expect(businessDaysBefore("2027-01-01", 10)).toBe("2026-12-16");
  });
});

describe("indexedRates: inflation-linked bonds", () => {
  // EDO1135 was sold in November 2025; its second period starts in November 2026.
  const data: IndexData = {
    inflation: new Map([
      ["2026-08", d("3.4")],
      ["2026-09", d("4.1")],
      ["2026-10", d("3.5")],
    ]),
    referenceRates: [],
  };

  it("adds the margin to the reading announced the month before the period starts", () => {
    // In October 2026 GUS announced the figure for September.
    expect(percent(indexedRates("EDO1135", d("2"), data, "2026-11-15"))).toEqual([[2, "6.1"]]);
  });

  it("works out every period whose reading is published, and no other", () => {
    const longer: IndexData = {
      ...data,
      inflation: new Map([...data.inflation, ["2027-09", d("2.5")]]),
    };

    expect(percent(indexedRates("EDO1135", d("2"), longer, "2027-11-15"))).toEqual([
      [2, "6.1"],
      [3, "4.5"],
    ]);
    expect(percent(indexedRates("EDO1135", d("2"), noData, "2027-11-15"))).toEqual([]);
  });

  it("counts deflation as zero, so the rate is the margin", () => {
    const deflation: IndexData = {
      inflation: new Map([["2026-09", d("-0.6")]]),
      referenceRates: [],
    };

    expect(percent(indexedRates("EDO1135", d("2"), deflation, "2026-11-15"))).toEqual([[2, "2"]]);
  });

  it("needs the margin and a floating rate", () => {
    expect(indexedRates("EDO1135", null, data, "2026-11-15").size).toBe(0);
    expect(indexedRates("TOS1128", d("1"), data, "2026-11-15").size).toBe(0);
    expect(indexedRates("nonsense", d("1"), data, "2026-11-15").size).toBe(0);
  });
});

describe("indexedRates: bonds linked to the NBP reference rate", () => {
  // ROR0627 was sold in June 2026: period 2 starts in July, period 3 in August, and so on.
  const data: IndexData = {
    inflation: new Map(),
    referenceRates: [
      { validFrom: "2026-03-05", rate: d("4") },
      { validFrom: "2026-07-20", rate: d("3.75") },
    ],
  };

  it("uses the rate in force on the tenth business day before the month of the period", () => {
    // 20 July 2026 is the tenth business day before 1 August: a cut in force a day later
    // comes too late for August and counts from September on.
    expect(businessDaysBefore("2026-08-01", 10)).toBe("2026-07-20");
    const early: IndexData = {
      ...data,
      referenceRates: [data.referenceRates[0], { validFrom: "2026-07-21", rate: d("3.75") }],
    };

    expect(percent(indexedRates("ROR0627", d("0.1"), early, "2026-09-01")).slice(0, 3)).toEqual([
      [2, "4.1"],
      [3, "4.1"],
      [4, "3.85"],
    ]);
    expect(percent(indexedRates("ROR0627", d("0.1"), data, "2026-09-01")).slice(0, 3)).toEqual([
      [2, "4.1"],
      [3, "3.85"],
      [4, "3.85"],
    ]);
  });

  it("does not look ahead of today", () => {
    // On 1 July only the rates for July (set in mid June) are known.
    expect(percent(indexedRates("ROR0627", d("0"), data, "2026-07-01"))).toEqual([[2, "4"]]);
  });

  it("returns nothing before the first known rate and counts a negative rate as zero", () => {
    const late: IndexData = {
      ...noData,
      referenceRates: [{ validFrom: "2026-12-01", rate: d("4") }],
    };
    const negative: IndexData = {
      ...noData,
      referenceRates: [{ validFrom: "2020-01-01", rate: d("-0.5") }],
    };

    expect(indexedRates("ROR0627", d("0"), late, "2026-08-01").size).toBe(0);
    expect(percent(indexedRates("ROR0627", d("0.25"), negative, "2026-07-01"))).toEqual([
      [2, "0.25"],
    ]);
  });
});
