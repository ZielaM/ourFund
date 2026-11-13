import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { formatDate, formatMoney, formatPrice, formatQuantity, toInputValue } from "./format";

const d = (value: string) => new Decimal(value);
// Intl uses non-breaking spaces; plain spaces keep the expectations readable.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("formatMoney", () => {
  it("formats złoty the Polish way", () => {
    expect(plain(formatMoney(d("1234.5"), "PLN"))).toBe("1 234,50 zł");
    expect(plain(formatMoney(d("1234567.891"), "PLN"))).toBe("1 234 567,89 zł");
  });

  it("shows other currencies by code", () => {
    expect(plain(formatMoney(d("100"), "USD"))).toBe("100,00 USD");
    expect(plain(formatMoney(d("99.9"), "EUR"))).toBe("99,90 EUR");
  });

  it("rounds half up to grosze", () => {
    expect(plain(formatMoney(d("0.005"), "PLN"))).toBe("0,01 zł");
    expect(plain(formatMoney(d("2.675"), "PLN"))).toBe("2,68 zł");
  });

  it("keeps the sign of a negative amount", () => {
    expect(plain(formatMoney(d("-1005"), "PLN"))).toBe("-1 005,00 zł");
  });

  it("does not lose precision on large amounts", () => {
    expect(plain(formatMoney(d("90071992547409.93"), "PLN"))).toBe("90 071 992 547 409,93 zł");
  });
});

describe("formatPrice", () => {
  it("groups thousands", () => {
    expect(plain(formatPrice(d("1234.5")))).toBe("1 234,50");
  });

  it("shows at least two and at most four decimal places", () => {
    expect(formatPrice(d("123"))).toBe("123,00");
    expect(formatPrice(d("0.1234"))).toBe("0,1234");
    expect(formatPrice(d("0.12345"))).toBe("0,1235");
  });
});

describe("formatQuantity", () => {
  it("drops trailing zeros", () => {
    expect(formatQuantity(d("10.0000000000"))).toBe("10");
    expect(formatQuantity(d("0.1234567800"))).toBe("0,12345678");
  });

  it("groups thousands", () => {
    expect(plain(formatQuantity(d("12500")))).toBe("12 500");
    expect(plain(formatQuantity(d("1250")))).toBe("1 250");
  });
});

describe("formatDate", () => {
  it("writes the day first", () => {
    expect(formatDate("2026-11-13")).toBe("13.11.2026");
    expect(formatDate("2026-01-05")).toBe("05.01.2026");
  });
});

describe("toInputValue", () => {
  it("uses a comma and no grouping, so the value can be parsed back", () => {
    expect(toInputValue(d("1234.5"))).toBe("1234,5");
    expect(toInputValue(d("10.0000000000"))).toBe("10");
  });
});
