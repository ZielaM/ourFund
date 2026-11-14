import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { LedgerEntry } from "@/domain/portfolio/ledger";
import type { FxOn } from "@/domain/valuation/valuation";
import { incomeByInstrument, incomeByMonth, incomeByYear, incomePayments } from "./history";

const d = (value: string) => new Decimal(value);
const fixed = (value: Decimal | null) => (value ? value.toFixed(2) : null);

let nextId = 1;
function income(
  type: "DIVIDEND" | "INTEREST",
  date: string,
  amount: string,
  tax: string,
  currency = "PLN",
  instrumentId: string | null = "CDR",
): LedgerEntry {
  return {
    id: `tx-${nextId++}`,
    type,
    date,
    instrumentId,
    amount: d(amount),
    tax: d(tax),
    currency,
  };
}

const buy: LedgerEntry = {
  id: "buy",
  type: "BUY",
  date: "2025-01-10",
  instrumentId: "CDR",
  quantity: d("10"),
  price: d("100"),
  fee: d("0"),
  currency: "PLN",
  fxRate: d("1"),
};

const usdAt4: FxOn = (currency) => (currency === "USD" ? d("4") : null);
const noFx: FxOn = () => null;

function payments(entries: LedgerEntry[], fxOn: FxOn = usdAt4) {
  return incomePayments([{ accountId: "acc", entries }], fxOn);
}

describe("incomePayments", () => {
  it("keeps dividends and interest only, newest first, after withheld tax", () => {
    const result = payments([
      buy,
      income("DIVIDEND", "2025-06-01", "100", "19"),
      income("INTEREST", "2026-02-01", "10", "1.90", "PLN", null),
    ]);

    expect(result.map((payment) => payment.date)).toEqual(["2026-02-01", "2025-06-01"]);
    expect(result[0].kind).toBe("INTEREST");
    expect(result[0].instrumentId).toBeNull();
    expect(fixed(result[0].net)).toBe("8.10");
    expect(fixed(result[1].netPln)).toBe("81.00");
  });

  it("converts foreign payments to złoty at the rate of the payment day", () => {
    const [payment] = payments([income("DIVIDEND", "2026-05-15", "100", "15", "USD", "AAPL")]);

    expect(fixed(payment.net)).toBe("85.00");
    expect(fixed(payment.netPln)).toBe("340.00");
  });

  it("leaves the amount in złoty unknown without a rate", () => {
    const [payment] = payments(
      [income("DIVIDEND", "2026-05-15", "100", "15", "USD", "AAPL")],
      noFx,
    );

    expect(fixed(payment.net)).toBe("85.00");
    expect(payment.netPln).toBeNull();
  });

  it("names the account of every payment", () => {
    const result = incomePayments(
      [
        { accountId: "a", entries: [income("DIVIDEND", "2026-01-01", "10", "0")] },
        { accountId: "b", entries: [income("DIVIDEND", "2026-02-01", "20", "0")] },
      ],
      noFx,
    );

    expect(result.map((payment) => payment.accountId)).toEqual(["b", "a"]);
  });
});

describe("incomeByMonth", () => {
  it("adds up the payments of each month of the year", () => {
    const months = incomeByMonth(
      payments([
        income("DIVIDEND", "2026-03-10", "100", "19"),
        income("DIVIDEND", "2026-03-25", "50", "0"),
        income("DIVIDEND", "2026-12-31", "10", "0"),
        income("DIVIDEND", "2025-03-10", "999", "0"),
      ]),
      2026,
    );

    expect(months).toHaveLength(12);
    expect(months.map((month) => month.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(fixed(months[2].net)).toBe("131.00");
    expect(fixed(months[11].net)).toBe("10.00");
    expect(fixed(months[0].net)).toBe("0.00");
  });

  it("leaves a month unknown when one of its payments has no rate", () => {
    const months = incomeByMonth(
      payments(
        [
          income("DIVIDEND", "2026-03-10", "100", "19"),
          income("DIVIDEND", "2026-03-25", "50", "0", "USD", "AAPL"),
          income("DIVIDEND", "2026-04-25", "50", "0"),
        ],
        noFx,
      ),
      2026,
    );

    expect(months[2].net).toBeNull();
    expect(fixed(months[3].net)).toBe("50.00");
  });
});

describe("incomeByYear", () => {
  it("has nothing without payments", () => {
    expect(incomeByYear([], 2026)).toEqual([]);
  });

  it("covers every year from the first payment to the requested one", () => {
    const years = incomeByYear(
      payments([
        income("DIVIDEND", "2023-06-01", "100", "0"),
        income("DIVIDEND", "2025-06-01", "200", "0"),
        income("DIVIDEND", "2025-09-01", "50", "0"),
      ]),
      2026,
    );

    expect(years.map((year) => [year.year, fixed(year.net)])).toEqual([
      [2023, "100.00"],
      [2024, "0.00"],
      [2025, "250.00"],
      [2026, "0.00"],
    ]);
  });

  it("includes a year later than the requested one", () => {
    const years = incomeByYear(payments([income("DIVIDEND", "2027-01-05", "10", "0")]), 2026);
    expect(years.map((year) => year.year)).toEqual([2027]);
  });
});

describe("incomeByInstrument", () => {
  it("groups payments by instrument, largest first", () => {
    const groups = incomeByInstrument(
      payments([
        income("DIVIDEND", "2026-03-10", "100", "0"),
        income("DIVIDEND", "2026-06-10", "100", "0"),
        income("DIVIDEND", "2026-05-15", "100", "0", "USD", "AAPL"),
        income("INTEREST", "2026-05-15", "5", "0", "PLN", null),
      ]),
    );

    expect(groups.map((group) => [group.instrumentId, fixed(group.net), group.count])).toEqual([
      ["AAPL", "400.00", 1],
      ["CDR", "200.00", 2],
      [null, "5.00", 1],
    ]);
  });

  it("puts instruments whose amount is unknown last", () => {
    const groups = incomeByInstrument(
      payments(
        [
          income("DIVIDEND", "2026-05-15", "100", "0", "USD", "AAPL"),
          income("DIVIDEND", "2026-05-16", "100", "0", "EUR", "SAP"),
          income("DIVIDEND", "2026-03-10", "100", "0"),
        ],
        noFx,
      ),
    );

    expect(groups[0].instrumentId).toBe("CDR");
    expect(groups.slice(1).map((group) => group.net)).toEqual([null, null]);
  });
});
