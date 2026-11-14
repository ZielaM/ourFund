import { describe, expect, it } from "vitest";
import {
  BOND_KINDS,
  BOND_RULES,
  bondKindOf,
  bondName,
  earlyRedemptionFee,
  periodCount,
} from "./kinds";

describe("bondKindOf", () => {
  it.each(BOND_KINDS)("recognizes a %s series", (kind) => {
    expect(bondKindOf(`${kind}1135`)).toBe(kind);
  });

  it.each([
    ["an unknown kind", "XYZ1135"],
    ["month 13", "EDO1335"],
    ["month 00", "EDO0035"],
    ["a short code", "EDO113"],
    ["lower case", "edo1135"],
    ["extra characters", "EDO1135A"],
    ["empty", ""],
  ])("rejects %s", (_reason, series) => {
    expect(bondKindOf(series)).toBeNull();
  });
});

describe("bond rules", () => {
  it("give each kind a whole number of interest periods", () => {
    const counts = Object.fromEntries(BOND_KINDS.map((kind) => [kind, periodCount(kind)]));

    expect(counts).toEqual({ OTS: 1, ROR: 12, DOR: 24, TOS: 3, COI: 4, EDO: 10, ROS: 6, ROD: 12 });
  });

  it("pay interest out on the short and the four-year bonds and capitalize it on the rest", () => {
    const payout = BOND_KINDS.filter((kind) => BOND_RULES[kind].interest === "payout");

    expect(payout).toEqual(["OTS", "ROR", "DOR", "COI"]);
  });

  it("keep the rate fixed only for OTS and TOS", () => {
    const fixed = BOND_KINDS.filter((kind) => BOND_RULES[kind].rate === "fixed");

    expect(fixed).toEqual(["OTS", "TOS"]);
  });
});

describe("earlyRedemptionFee", () => {
  it.each([
    ["OTS", "0", "0"],
    ["ROR", "0.50", "0.50"],
    ["DOR", "0.70", "0.70"],
    ["TOS", "0.70", "1.00"],
    ["COI", "0.70", "2.00"],
    ["ROS", "0.70", "2.00"],
    ["EDO", "2.00", "3.00"],
    ["ROD", "2.00", "3.00"],
  ] as const)("%s: %s zł for purchases until 31.08.2024, %s zł after", (kind, before, since) => {
    expect(earlyRedemptionFee(kind, "2024-08-31")).toBe(before);
    expect(earlyRedemptionFee(kind, "2024-09-01")).toBe(since);
  });
});

describe("bondName", () => {
  it("names a series after its kind", () => {
    expect(bondName("EDO1135")).toBe("Obligacje 10-letnie EDO1135");
    expect(bondName("ROR1126")).toBe("Obligacje roczne ROR1126");
    expect(bondName("ROS1131")).toBe("Obligacje rodzinne 6-letnie ROS1131");
  });

  it("is null for something that is not a series", () => {
    expect(bondName("CDR")).toBeNull();
  });
});
