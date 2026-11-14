import { describe, expect, it } from "vitest";
import { bondInputSchema, bondRateSchema } from "./inputs";

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => `${String(issue.path[0])}:${issue.message}`);
}

describe("bondInputSchema", () => {
  it("reads a series with its first rate and margin, typed the Polish way", () => {
    const result = bondInputSchema.parse({ series: " edo1135 ", firstRate: "5,35", margin: "2" });

    expect(result.series).toBe("EDO1135");
    expect(result.firstRate?.toFixed()).toBe("5.35");
    expect(result.margin?.toFixed()).toBe("2");
  });

  it("makes the margin optional", () => {
    expect(bondInputSchema.parse({ series: "TOS1129", firstRate: "4,40" }).margin).toBeNull();
    expect(
      bondInputSchema.parse({ series: "TOS1129", firstRate: "4,40", margin: " " }).margin,
    ).toBeNull();
  });

  it("accepts a margin of zero, as ROR bonds have", () => {
    expect(
      bondInputSchema
        .parse({ series: "ROR1127", firstRate: "4", margin: "0,00" })
        .margin?.toFixed(),
    ).toBe("0");
  });

  it("requires a series and a first rate", () => {
    expect(issues(bondInputSchema.safeParse({ series: "", firstRate: "" }))).toEqual([
      "series:required",
      "firstRate:required",
    ]);
  });

  it.each(["CDR", "EDO1335", "EDO 1135", "XYZ1135"])("rejects %s as a series", (series) => {
    expect(issues(bondInputSchema.safeParse({ series, firstRate: "5" }))).toEqual([
      "series:bondSeries.invalid",
    ]);
  });

  it.each([
    ["text", "pięć"],
    ["zero", "0"],
    ["a negative number", "-1"],
    ["a fraction entered instead of a percentage... times a hundred", "535"],
    ["too many decimal places", "5,35123"],
  ])("rejects a first rate that is %s", (_reason, firstRate) => {
    expect(issues(bondInputSchema.safeParse({ series: "EDO1135", firstRate }))).toEqual([
      "firstRate:rate.invalid",
    ]);
  });
});

describe("bondRateSchema", () => {
  it("reads a period and a rate", () => {
    const result = bondRateSchema("EDO1135").parse({ period: "3", rate: "6,10" });

    expect(result.period).toBe(3);
    expect(result.rate?.toFixed()).toBe("6.1");
  });

  it("accepts a rate of zero", () => {
    expect(bondRateSchema("EDO1135").parse({ period: "2", rate: "0" }).rate?.toFixed()).toBe("0");
  });

  it("allows only the later periods the kind has", () => {
    const edo = bondRateSchema("EDO1135");
    const ror = bondRateSchema("ROR1127");

    expect(edo.safeParse({ period: "10", rate: "5" }).success).toBe(true);
    expect(issues(edo.safeParse({ period: "11", rate: "5" }))).toEqual(["period:period.invalid"]);
    expect(issues(edo.safeParse({ period: "1", rate: "5" }))).toEqual(["period:period.invalid"]);
    expect(ror.safeParse({ period: "12", rate: "5" }).success).toBe(true);
    expect(issues(ror.safeParse({ period: "2,5", rate: "5" }))).toEqual(["period:period.invalid"]);
  });

  it("requires both fields", () => {
    expect(issues(bondRateSchema("EDO1135").safeParse({ period: "", rate: "" }))).toEqual([
      "period:required",
      "rate:required",
    ]);
  });

  it("has no valid period for something that is not a series", () => {
    expect(issues(bondRateSchema("CDR").safeParse({ period: "2", rate: "5" }))).toEqual([
      "period:period.invalid",
    ]);
  });
});
