import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { LedgerEntry } from "@/domain/portfolio/ledger";
import { describeSplitRatio, suggestEvents, type KnownEvent } from "./suggestions";

const d = (value: string | number) => new Decimal(value);
let nextId = 0;
const id = () => `t${(nextId += 1)}`;

const buy = (date: string, quantity: number, instrumentId = "ACME"): LedgerEntry => ({
  id: id(),
  type: "BUY",
  date,
  instrumentId,
  quantity: d(quantity),
  price: d(100),
  fee: d(0),
  currency: "PLN",
  fxRate: d(1),
});
const sell = (date: string, quantity: number, instrumentId = "ACME"): LedgerEntry => ({
  id: id(),
  type: "SELL",
  date,
  instrumentId,
  quantity: d(quantity),
  price: d(100),
  fee: d(0),
  currency: "PLN",
  fxRate: d(1),
});
const paid = (date: string, amount: number, instrumentId = "ACME"): LedgerEntry => ({
  id: id(),
  type: "DIVIDEND",
  date,
  instrumentId,
  amount: d(amount),
  tax: d(0),
  currency: "PLN",
});
const splitRecorded = (date: string, ratio: number, instrumentId = "ACME"): LedgerEntry => ({
  id: id(),
  type: "SPLIT",
  date,
  instrumentId,
  splitRatio: d(ratio),
});

const dividend = (
  eventId: string,
  date: string,
  perUnit: string,
  instrumentId = "ACME",
): KnownEvent => ({
  id: eventId,
  instrumentId,
  type: "DIVIDEND",
  date,
  value: d(perUnit),
});
const split = (
  eventId: string,
  date: string,
  ratio: string,
  instrumentId = "ACME",
): KnownEvent => ({
  id: eventId,
  instrumentId,
  type: "SPLIT",
  date,
  value: d(ratio),
});

const summary = (entries: LedgerEntry[], events: KnownEvent[], dismissed?: Set<string>) =>
  suggestEvents(entries, events, dismissed).map((suggestion) =>
    suggestion.type === "DIVIDEND"
      ? [suggestion.eventId, suggestion.quantity.toFixed(), suggestion.amount.toFixed()]
      : [suggestion.eventId, suggestion.quantity.toFixed(), suggestion.ratio.toFixed()],
  );

describe("suggestEvents: dividends", () => {
  it("suggests a dividend for the units held the day before the ex-dividend day", () => {
    const entries = [buy("2026-03-02", 10), buy("2026-06-15", 5)];

    expect(summary(entries, [dividend("e1", "2026-06-15", "1.5")])).toEqual([["e1", "10", "15"]]);
  });

  it("suggests nothing for an instrument bought on or after the ex-dividend day", () => {
    expect(summary([buy("2026-06-15", 10)], [dividend("e1", "2026-06-15", "1.5")])).toEqual([]);
  });

  it("suggests nothing once everything was sold before the ex-dividend day", () => {
    const entries = [buy("2026-03-02", 10), sell("2026-06-12", 10)];

    expect(summary(entries, [dividend("e1", "2026-06-15", "1.5")])).toEqual([]);
  });

  it("counts a recorded payment for the latest ex-dividend day before it", () => {
    const entries = [buy("2026-01-05", 10), paid("2026-07-02", 15)];
    const events = [dividend("spring", "2026-03-16", "1"), dividend("summer", "2026-06-15", "1.5")];

    expect(summary(entries, events)).toEqual([["spring", "10", "10"]]);
  });

  it("accepts a payment recorded a few days before the reported day, but not months after", () => {
    const events = [dividend("e1", "2026-06-15", "1.5")];

    expect(summary([buy("2026-01-05", 10), paid("2026-06-12", 15)], events)).toEqual([]);
    expect(summary([buy("2026-01-05", 10), paid("2026-06-10", 15)], events)).toHaveLength(1);
    expect(summary([buy("2026-01-05", 10), paid("2026-12-01", 15)], events)).toHaveLength(1);
  });

  it("settles each reported dividend with its own payment", () => {
    const entries = [buy("2026-01-05", 10), paid("2026-04-01", 10), paid("2026-07-01", 15)];
    const events = [dividend("spring", "2026-03-16", "1"), dividend("summer", "2026-06-15", "1.5")];

    expect(summary(entries, events)).toEqual([]);
  });

  it("applies recorded splits to the quantity", () => {
    const entries = [buy("2026-01-05", 10), splitRecorded("2026-03-02", 2)];

    expect(summary(entries, [dividend("e1", "2026-06-15", "1.5")])).toEqual([["e1", "20", "30"]]);
  });

  it("leaves out a dividend the owner dismissed", () => {
    const entries = [buy("2026-01-05", 10)];
    const events = [dividend("e1", "2026-06-15", "1.5")];

    expect(summary(entries, events, new Set(["e1"]))).toEqual([]);
  });

  it("does not mix instruments", () => {
    const entries = [buy("2026-01-05", 10, "ACME"), paid("2026-07-01", 15, "OTHER")];

    expect(summary(entries, [dividend("e1", "2026-06-15", "1.5", "ACME")])).toHaveLength(1);
    expect(summary(entries, [dividend("e1", "2026-06-15", "1.5", "THIRD")])).toEqual([]);
  });
});

describe("suggestEvents: splits", () => {
  it("suggests a split for the units held when it took effect", () => {
    expect(summary([buy("2026-01-05", 10)], [split("s1", "2026-03-02", "2")])).toEqual([
      ["s1", "10", "2"],
    ]);
  });

  it("suggests nothing when a split is recorded within a week of the reported day", () => {
    const events = [split("s1", "2026-03-02", "2")];

    expect(summary([buy("2026-01-05", 10), splitRecorded("2026-03-06", 2)], events)).toEqual([]);
    expect(summary([buy("2026-01-05", 10), splitRecorded("2026-02-25", 2)], events)).toEqual([]);
    expect(summary([buy("2026-01-05", 10), splitRecorded("2026-04-02", 2)], events)).toHaveLength(
      1,
    );
  });

  it("suggests nothing for a split before the first purchase or after the last sale", () => {
    const events = [split("s1", "2026-03-02", "2")];

    expect(summary([buy("2026-03-02", 10)], events)).toEqual([]);
    expect(summary([buy("2026-01-05", 10), sell("2026-02-02", 10)], events)).toEqual([]);
  });

  it("leaves out a dismissed split and lists splits before dividends of the same day", () => {
    const entries = [buy("2026-01-05", 10)];
    const events = [dividend("e1", "2026-03-02", "1"), split("s1", "2026-03-02", "2")];

    expect(summary(entries, events).map(([eventId]) => eventId)).toEqual(["s1", "e1"]);
    expect(summary(entries, events, new Set(["s1"])).map(([eventId]) => eventId)).toEqual(["e1"]);
  });
});

describe("describeSplitRatio", () => {
  it("writes ratios the way announcements do", () => {
    expect(describeSplitRatio(d(4))).toBe("4:1");
    expect(describeSplitRatio(d("0.1"))).toBe("1:10");
    expect(describeSplitRatio(d("1.5"))).toBe("3:2");
    expect(describeSplitRatio(d("0.0371"))).toBe("0.0371:1");
  });
});
