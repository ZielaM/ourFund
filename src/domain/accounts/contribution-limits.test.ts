import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { contributionLimit, contributionUsage, type CashDeposit } from "./contribution-limits";

const deposit = (date: string, amount: string, currency = "PLN"): CashDeposit => ({
  date,
  amount: new Decimal(amount),
  currency,
});

describe("contributionLimit", () => {
  it("returns the announced limits of a year", () => {
    expect(contributionLimit("IKE", 2026)?.limit.toFixed(2)).toBe("28260.00");
    expect(contributionLimit("IKE", 2027)?.limit.toFixed(2)).toBe("30099.00");
    expect(contributionLimit("IKZE", 2026)?.limit.toFixed(2)).toBe("11304.00");
    expect(contributionLimit("IKZE", 2026)?.selfEmployedLimit?.toFixed(2)).toBe("16956.00");
    expect(contributionLimit("IKZE", 2027)?.selfEmployedLimit?.toFixed(2)).toBe("18059.40");
  });

  it("has no separate limit for the self-employed on IKE, nor on IKZE before 2021", () => {
    expect(contributionLimit("IKE", 2026)?.selfEmployedLimit).toBeNull();
    expect(contributionLimit("IKZE", 2020)?.selfEmployedLimit).toBeNull();
  });

  it("keeps to the formula: 3, 1.2 and 1.8 times the forecast average wage", () => {
    // 2019 to 2027, as in the budget acts.
    const wages = [4765, 5227, 5259, 5922, 6935, 7824, 8673, 9420, 10033];

    wages.forEach((wage, index) => {
      const year = 2019 + index;
      expect(contributionLimit("IKE", year)?.limit.toFixed(2), `IKE ${year}`).toBe(
        new Decimal(wage).times(3).toFixed(2),
      );
      expect(contributionLimit("IKZE", year)?.limit.toFixed(2), `IKZE ${year}`).toBe(
        new Decimal(wage).times("1.2").toFixed(2),
      );
      const selfEmployed = contributionLimit("IKZE", year)?.selfEmployedLimit;
      if (selfEmployed) {
        expect(selfEmployed.toFixed(2), `IKZE self-employed ${year}`).toBe(
          new Decimal(wage).times("1.8").toFixed(2),
        );
      }
    });
  });

  it("is null for a year that has not been announced", () => {
    expect(contributionLimit("IKE", 2018)).toBeNull();
    expect(contributionLimit("IKE", 2040)).toBeNull();
  });
});

describe("contributionUsage", () => {
  const limit = new Decimal(28260);

  it("adds up the deposits of the year only", () => {
    const usage = contributionUsage(
      [
        deposit("2025-12-30", "9000"),
        deposit("2026-01-02", "5000"),
        deposit("2026-06-10", "1500.50"),
      ],
      2026,
      limit,
    );

    expect(usage.contributed.toFixed(2)).toBe("6500.50");
    expect(usage.remaining.toFixed(2)).toBe("21759.50");
    expect(usage).toMatchObject({ exceeded: false, incomplete: false });
  });

  it("reports a limit that was exceeded, with nothing remaining", () => {
    const usage = contributionUsage([deposit("2026-01-02", "30000")], 2026, limit);

    expect(usage.remaining.toFixed()).toBe("0");
    expect(usage.exceeded).toBe(true);
  });

  it("is exact at the limit and empty without deposits", () => {
    expect(contributionUsage([deposit("2026-01-02", "28260")], 2026, limit)).toMatchObject({
      exceeded: false,
    });
    expect(contributionUsage([], 2026, limit).contributed.toFixed()).toBe("0");
  });

  it("leaves out deposits in another currency and says so", () => {
    const usage = contributionUsage(
      [deposit("2026-01-02", "5000"), deposit("2026-02-02", "100", "EUR")],
      2026,
      limit,
    );

    expect(usage.contributed.toFixed()).toBe("5000");
    expect(usage.incomplete).toBe(true);
  });
});
