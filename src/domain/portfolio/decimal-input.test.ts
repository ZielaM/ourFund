import { describe, expect, it } from "vitest";
import { parseDecimalInput } from "./decimal-input";

describe("parseDecimalInput", () => {
  it.each([
    ["12", "12"],
    ["12,5", "12.5"],
    ["12.5", "12.5"],
    ["1 234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["  7,00 ", "7"],
    ["0,00000001", "0.00000001"],
    ["0", "0"],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseDecimalInput(raw)?.toFixed()).toBe(expected);
  });

  it.each([
    ["empty input", ""],
    ["spaces only", "   "],
    ["letters", "abc"],
    ["a negative number", "-5"],
    ["a plus sign", "+5"],
    ["two separators", "1.234,56"],
    ["a comma used for thousands", "1,234.56"],
    ["a trailing separator", "12,"],
    ["a leading separator", ",5"],
    ["scientific notation", "1e5"],
    ["a currency symbol", "12 zł"],
  ])("rejects %s", (_reason, raw) => {
    expect(parseDecimalInput(raw)).toBeNull();
  });

  it("keeps full precision, unlike binary floating point", () => {
    const sum = parseDecimalInput("0,1")!.plus(parseDecimalInput("0,2")!);

    expect(sum.toFixed()).toBe("0.3");
  });
});
