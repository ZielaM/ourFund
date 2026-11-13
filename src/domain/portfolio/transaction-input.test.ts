import { describe, expect, it } from "vitest";
import { NOTE_MAX_LENGTH, transactionInputSchema } from "./transaction-input";

const accountId = "11111111-1111-4111-8111-111111111111";
const instrumentId = "22222222-2222-4222-8222-222222222222";

const buy = {
  type: "BUY",
  accountId,
  date: "2026-01-10",
  instrumentId,
  quantity: "10",
  price: "123,45",
};

function parse(input: Record<string, unknown>) {
  const result = transactionInputSchema.safeParse(input);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

function issues(input: Record<string, unknown>): string[] {
  const result = transactionInputSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${String(issue.path[0] ?? "")}:${issue.message}`);
}

describe("transactionInputSchema: trades", () => {
  it("reads a purchase typed the Polish way", () => {
    const result = parse({ ...buy, quantity: "1 000,5", fee: "5,00", note: "  pierwszy zakup " });

    expect(result).toMatchObject({ type: "BUY", accountId, instrumentId, date: "2026-01-10" });
    if (result.type !== "BUY") throw new Error("expected a purchase");
    expect(result.quantity.toFixed()).toBe("1000.5");
    expect(result.price.toFixed()).toBe("123.45");
    expect(result.fee.toFixed()).toBe("5");
    expect(result.note).toBe("pierwszy zakup");
  });

  it("defaults the commission to 0, the rate to 1 and the currency to the instrument's", () => {
    const result = parse(buy);

    if (result.type !== "BUY") throw new Error("expected a purchase");
    expect(result.fee.toFixed()).toBe("0");
    expect(result.fxRate.toFixed()).toBe("1");
    expect(result.currency).toBeNull();
    expect(result.note).toBeNull();
  });

  it("treats empty optional fields like missing ones", () => {
    const result = parse({ ...buy, fee: " ", fxRate: "", currency: "", note: "  " });

    if (result.type !== "BUY") throw new Error("expected a purchase");
    expect(result.fee.toFixed()).toBe("0");
    expect(result.fxRate.toFixed()).toBe("1");
    expect(result.currency).toBeNull();
    expect(result.note).toBeNull();
  });

  it("accepts a settlement currency and rate", () => {
    const result = parse({ ...buy, currency: "pln", fxRate: "4,0512" });

    if (result.type !== "BUY") throw new Error("expected a purchase");
    expect(result.currency).toBe("PLN");
    expect(result.fxRate.toFixed()).toBe("4.0512");
  });

  it("accepts a sale with the same fields", () => {
    expect(parse({ ...buy, type: "SELL" }).type).toBe("SELL");
  });

  it("accepts a price of zero but not a quantity of zero", () => {
    expect(issues({ ...buy, price: "0" })).toEqual([]);
    expect(issues({ ...buy, quantity: "0" })).toEqual(["quantity:number.positive"]);
  });

  it("requires the instrument, quantity and price", () => {
    expect(issues({ type: "BUY", accountId, date: "2026-01-10" })).toEqual([
      "instrumentId:required",
      "quantity:required",
      "price:required",
    ]);
    expect(issues({ ...buy, quantity: "", price: " " })).toEqual([
      "quantity:required",
      "price:required",
    ]);
  });

  it.each([
    ["text", "dużo", "number.invalid"],
    ["a negative number", "-1", "number.invalid"],
    ["too many decimal places", "0,12345678901", "number.tooPrecise"],
    ["an absurdly large number", "1000000000000000", "number.tooLarge"],
  ])("rejects a quantity that is %s", (_reason, quantity, code) => {
    expect(issues({ ...buy, quantity })).toEqual([`quantity:${code}`]);
  });

  it("rejects a rate of zero and an unknown currency", () => {
    expect(issues({ ...buy, fxRate: "0" })).toEqual(["fxRate:number.positive"]);
    expect(issues({ ...buy, currency: "XYZ" })).toEqual(["currency:currency.invalid"]);
  });
});

describe("transactionInputSchema: common fields", () => {
  it.each([
    ["missing", undefined, "required"],
    ["empty", "", "required"],
    ["not a real day", "2026-02-30", "date.invalid"],
    ["in the Polish format", "10.01.2026", "date.invalid"],
    ["implausibly old", "1989-12-31", "date.invalid"],
  ])("rejects a date that is %s", (_reason, date, code) => {
    expect(issues({ ...buy, date })).toEqual([`date:${code}`]);
  });

  it("requires a valid account id", () => {
    expect(issues({ ...buy, accountId: "abc" })).toEqual(["accountId:required"]);
  });

  it("limits the note length", () => {
    expect(issues({ ...buy, note: "a".repeat(NOTE_MAX_LENGTH) })).toEqual([]);
    expect(issues({ ...buy, note: "a".repeat(NOTE_MAX_LENGTH + 1) })).toEqual([
      "note:note.tooLong",
    ]);
  });

  it("rejects an unknown transaction type", () => {
    expect(issues({ ...buy, type: "GIFT" })).toEqual(["type:required"]);
    expect(issues({ ...buy, type: undefined })).toEqual(["type:required"]);
  });
});

describe("transactionInputSchema: income", () => {
  const dividend = {
    type: "DIVIDEND",
    accountId,
    date: "2026-06-01",
    instrumentId,
    amount: "50",
    tax: "9,50",
    currency: "PLN",
  };

  it("reads a dividend with withheld tax", () => {
    const result = parse(dividend);

    if (result.type !== "DIVIDEND") throw new Error("expected a dividend");
    expect(result.amount.toFixed()).toBe("50");
    expect(result.tax.toFixed()).toBe("9.5");
    expect(result.currency).toBe("PLN");
  });

  it("defaults the tax to 0", () => {
    const result = parse({ ...dividend, tax: undefined });

    if (result.type !== "DIVIDEND") throw new Error("expected a dividend");
    expect(result.tax.toFixed()).toBe("0");
  });

  it("requires an instrument, an amount and a currency for a dividend", () => {
    expect(issues({ type: "DIVIDEND", accountId, date: "2026-06-01" })).toEqual([
      "amount:required",
      "currency:required",
      "instrumentId:required",
    ]);
  });

  it("rejects tax higher than the amount", () => {
    expect(issues({ ...dividend, tax: "50,01" })).toEqual(["tax:tax.exceedsAmount"]);
    expect(issues({ ...dividend, tax: "50" })).toEqual([]);
  });

  it("allows interest without an instrument", () => {
    const result = parse({ ...dividend, type: "INTEREST", instrumentId: "" });

    if (result.type !== "INTEREST") throw new Error("expected interest");
    expect(result.instrumentId).toBeNull();
  });

  it("allows interest attributed to an instrument, such as a bond coupon", () => {
    const result = parse({ ...dividend, type: "INTEREST" });

    if (result.type !== "INTEREST") throw new Error("expected interest");
    expect(result.instrumentId).toBe(instrumentId);
  });

  it("rejects a malformed instrument on interest", () => {
    expect(issues({ ...dividend, type: "INTEREST", instrumentId: "abc" })).toEqual([
      "instrumentId:required",
    ]);
  });
});

describe("transactionInputSchema: cash movements", () => {
  it.each(["DEPOSIT", "WITHDRAWAL", "FEE"])("reads a %s", (type) => {
    const result = parse({ type, accountId, date: "2026-01-05", amount: "1 000", currency: "EUR" });

    expect(result).toMatchObject({ type, currency: "EUR" });
    if (!("amount" in result)) throw new Error("expected an amount");
    expect(result.amount.toFixed()).toBe("1000");
  });

  it("requires a positive amount and a currency", () => {
    expect(issues({ type: "DEPOSIT", accountId, date: "2026-01-05", amount: "0" })).toEqual([
      "amount:number.positive",
      "currency:required",
    ]);
  });
});

describe("transactionInputSchema: splits", () => {
  const split = { type: "SPLIT", accountId, date: "2026-02-01", instrumentId, splitRatio: "4" };

  it("reads a split and a reverse split", () => {
    const forward = parse(split);
    const reverse = parse({ ...split, splitRatio: "0,1" });

    if (forward.type !== "SPLIT" || reverse.type !== "SPLIT") throw new Error("expected splits");
    expect(forward.splitRatio.toFixed()).toBe("4");
    expect(reverse.splitRatio.toFixed()).toBe("0.1");
  });

  it("rejects a ratio that changes nothing or is not positive", () => {
    expect(issues({ ...split, splitRatio: "1" })).toEqual(["splitRatio:splitRatio.noChange"]);
    expect(issues({ ...split, splitRatio: "0" })).toEqual(["splitRatio:number.positive"]);
  });

  it("requires the instrument and the ratio", () => {
    expect(issues({ type: "SPLIT", accountId, date: "2026-02-01" })).toEqual([
      "instrumentId:required",
      "splitRatio:required",
    ]);
  });
});
