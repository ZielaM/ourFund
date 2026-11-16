import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import type { LedgerEntry } from "@/domain/portfolio/ledger";
import { createLookup } from "@/domain/valuation/series";
import {
  computeTaxYears,
  toFullZloty,
  type RateLookup,
  type TaxInstrument,
  type TaxYear,
} from "./pit38";

const d = (value: string | number) => new Decimal(value);
const fixed = (value: Decimal | null) => (value ? value.toFixed(2) : null);

let nextId = 1;
type TradeOptions = { fee?: string; currency?: string; fxRate?: string; instrumentId?: string };

function trade(
  type: "BUY" | "SELL",
  date: string,
  quantity: string,
  price: string,
  options: TradeOptions = {},
): LedgerEntry {
  return {
    id: `tx-${nextId++}`,
    type,
    date,
    instrumentId: options.instrumentId ?? "CDR",
    quantity: d(quantity),
    price: d(price),
    fee: d(options.fee ?? "0"),
    currency: options.currency ?? "PLN",
    fxRate: d(options.fxRate ?? "1"),
  };
}

function income(
  type: "DIVIDEND" | "INTEREST",
  date: string,
  amount: string,
  tax: string,
  currency: string,
  instrumentId: string | null,
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

const INSTRUMENTS: Record<string, TaxInstrument> = {
  CDR: { currency: "PLN", category: "security", foreign: false },
  AAPL: { currency: "USD", category: "security", foreign: true },
  BTC: { currency: "USD", category: "crypto", foreign: true },
  EDO: { currency: "PLN", category: "savingsBond", foreign: false },
  GOLD: { currency: "PLN", category: "commodity", foreign: false },
};
const instrumentOf = (id: string) => INSTRUMENTS[id];

/** Rates by "currency date"; like NBP, a day without a rate takes the last one before it. */
function ratesFrom(rates: Record<string, string>): RateLookup {
  const lookups = new Map<string, ReturnType<typeof createLookup<Decimal>>>();

  for (const key of Object.keys(rates)) {
    const [currency] = key.split(" ");
    if (!lookups.has(currency)) {
      lookups.set(
        currency,
        createLookup(
          Object.entries(rates)
            .filter(([other]) => other.startsWith(`${currency} `))
            .map(([other, value]) => ({ date: other.split(" ")[1], value: d(value) })),
        ),
      );
    }
  }
  return (currency, date) => lookups.get(currency)?.(date) ?? null;
}

const noRates: RateLookup = () => null;

function report(
  entries: LedgerEntry[],
  rates: RateLookup = noRates,
  throughYear = 2026,
): Map<number, TaxYear> {
  const years = computeTaxYears([{ accountId: "acc", entries }], instrumentOf, rates, throughYear);
  return new Map(years.map((year) => [year.year, year]));
}

describe("toFullZloty", () => {
  it("drops less than 50 gr and rounds 50 gr up", () => {
    expect(toFullZloty(d("100.49")).toFixed()).toBe("100");
    expect(toFullZloty(d("100.50")).toFixed()).toBe("101");
  });
});

describe("computeTaxYears: sales of securities", () => {
  it("reports nothing without transactions", () => {
    expect(computeTaxYears([], instrumentOf, noRates, 2026)).toEqual([]);
  });

  it("reports revenue before the commission and counts both commissions as costs", () => {
    const year = report([
      trade("BUY", "2026-01-10", "10", "100", { fee: "5" }),
      trade("SELL", "2026-06-10", "10", "150", { fee: "7" }),
    ]).get(2026)!;

    expect(fixed(year.securities.revenue)).toBe("1500.00");
    expect(fixed(year.securities.costs)).toBe("1012.00");
    expect(fixed(year.securities.income)).toBe("488.00");
    expect(fixed(year.securities.base)).toBe("488.00");
    // 19% of 488 = 92.72
    expect(fixed(year.securities.tax)).toBe("93.00");
    expect(year.empty).toBe(false);
  });

  it("matches the oldest purchases first and puts a sale in the year it happened", () => {
    const years = report([
      trade("BUY", "2024-03-01", "10", "100"),
      trade("BUY", "2025-03-01", "10", "200"),
      trade("SELL", "2025-09-01", "15", "300"),
      trade("SELL", "2026-02-01", "5", "250"),
    ]);

    const first = years.get(2025)!.securities;
    expect(fixed(first.revenue)).toBe("4500.00");
    // 10 at 100 and 5 at 200
    expect(fixed(first.costs)).toBe("2000.00");
    expect(first.sales).toHaveLength(1);
    expect(first.sales[0].acquiredFrom).toBe("2024-03-01");
    expect(first.sales[0].quantity.toFixed()).toBe("15");

    const second = years.get(2026)!.securities;
    expect(fixed(second.revenue)).toBe("1250.00");
    expect(fixed(second.costs)).toBe("1000.00");

    // A year with purchases only has nothing to settle.
    expect(years.get(2024)!.empty).toBe(true);
    expect(fixed(years.get(2024)!.securities.income)).toBe("0.00");
  });

  it("shows a loss as negative income with no tax", () => {
    const year = report([
      trade("BUY", "2026-01-10", "10", "100"),
      trade("SELL", "2026-06-10", "10", "60"),
    ]).get(2026)!;

    expect(fixed(year.securities.income)).toBe("-400.00");
    expect(fixed(year.securities.base)).toBe("0.00");
    expect(fixed(year.securities.tax)).toBe("0.00");
  });

  it("converts at the NBP rate of the last working day before each transaction", () => {
    const rates = ratesFrom({
      // Friday before a purchase on Monday the 12th.
      "USD 2026-01-09": "4.00",
      "USD 2026-01-12": "9.99",
      "USD 2026-06-09": "4.50",
      "USD 2026-06-10": "9.99",
    });
    const year = report(
      [
        trade("BUY", "2026-01-12", "10", "100", {
          instrumentId: "AAPL",
          currency: "USD",
          fee: "1",
        }),
        trade("SELL", "2026-06-10", "10", "120", {
          instrumentId: "AAPL",
          currency: "USD",
          fee: "2",
        }),
      ],
      rates,
    ).get(2026)!;

    // 1200 USD at 4.50
    expect(fixed(year.securities.revenue)).toBe("5400.00");
    // 1001 USD at 4.00 and 2 USD at 4.50
    expect(fixed(year.securities.costs)).toBe("4013.00");
    expect(year.missingRates).toEqual([]);
  });

  it("takes the amount in złoty as it was when the account paid in złoty", () => {
    const year = report([
      trade("BUY", "2026-01-12", "10", "100", {
        instrumentId: "AAPL",
        currency: "PLN",
        fxRate: "4.10",
        fee: "20",
      }),
      trade("SELL", "2026-06-10", "10", "120", {
        instrumentId: "AAPL",
        currency: "PLN",
        fxRate: "4.40",
        fee: "22",
      }),
    ]).get(2026)!;

    expect(fixed(year.securities.revenue)).toBe("5280.00");
    // 4100 + 20 for the purchase, 22 for the sale
    expect(fixed(year.securities.costs)).toBe("4142.00");
    expect(year.missingRates).toEqual([]);
  });

  it("leaves amounts unknown and names the currency when a rate is missing", () => {
    const year = report([
      trade("BUY", "2026-01-12", "10", "100", { instrumentId: "AAPL", currency: "USD" }),
      trade("SELL", "2026-06-10", "10", "120", { instrumentId: "AAPL", currency: "USD" }),
      trade("BUY", "2026-01-12", "1", "100"),
      trade("SELL", "2026-06-10", "1", "120"),
    ]).get(2026)!;

    expect(year.securities.revenue).toBeNull();
    expect(year.securities.costs).toBeNull();
    expect(year.securities.income).toBeNull();
    expect(year.securities.tax).toBeNull();
    expect(year.missingRates).toEqual(["USD"]);
    // The sale in złoty is still known.
    expect(fixed(year.securities.sales.find((sale) => sale.instrumentId === "CDR")!.income)).toBe(
      "20.00",
    );
  });

  it("does not use a rate that is too old to be the last working day's", () => {
    const rates = ratesFrom({ "USD 2025-01-02": "4.00" });
    const year = report(
      [
        trade("BUY", "2026-01-12", "10", "100", { instrumentId: "AAPL", currency: "USD" }),
        trade("SELL", "2026-06-10", "10", "120", { instrumentId: "AAPL", currency: "USD" }),
      ],
      rates,
    ).get(2026)!;

    expect(year.securities.revenue).toBeNull();
    expect(year.missingRates).toEqual(["USD"]);
  });

  it("keeps accounts apart: a sale on one account never uses purchases of another", () => {
    const years = computeTaxYears(
      [
        { accountId: "a", entries: [trade("BUY", "2026-01-10", "10", "100")] },
        {
          accountId: "b",
          entries: [
            trade("BUY", "2026-02-10", "10", "200"),
            trade("SELL", "2026-03-10", "10", "210"),
          ],
        },
      ],
      instrumentOf,
      noRates,
      2026,
    );

    expect(fixed(years[0].securities.costs)).toBe("2000.00");
    expect(years[0].securities.sales[0].accountId).toBe("b");
  });

  it("follows a split between the purchase and the sale", () => {
    const year = report([
      trade("BUY", "2026-01-10", "10", "100"),
      { id: "split", type: "SPLIT", date: "2026-02-01", instrumentId: "CDR", splitRatio: d(2) },
      trade("SELL", "2026-06-10", "20", "60"),
    ]).get(2026)!;

    expect(fixed(year.securities.revenue)).toBe("1200.00");
    expect(fixed(year.securities.costs)).toBe("1000.00");
  });

  it("covers every year up to the requested one, also without transactions", () => {
    const years = report([trade("BUY", "2023-05-01", "1", "100")], noRates, 2026);
    expect([...years.keys()]).toEqual([2023, 2024, 2025, 2026]);
    expect(years.get(2025)!.empty).toBe(true);
  });
});

describe("computeTaxYears: retail treasury bonds", () => {
  it("keeps redemptions out of the return", () => {
    const year = report([
      trade("BUY", "2025-01-10", "10", "100", { instrumentId: "EDO" }),
      trade("SELL", "2026-01-10", "10", "105.35", { instrumentId: "EDO" }),
    ]).get(2026)!;

    expect(year.securities.sales).toEqual([]);
    expect(fixed(year.securities.income)).toBe("0.00");
    expect(fixed(year.savingsBonds.income)).toBe("53.50");
    expect(year.savingsBonds.sales).toHaveLength(1);
    expect(year.empty).toBe(false);
  });
});

describe("computeTaxYears: physical commodities", () => {
  it("lists a sale of gold outside the return, with its result", () => {
    const year = report([
      trade("BUY", "2025-01-10", "10", "400", { instrumentId: "GOLD" }),
      trade("SELL", "2026-03-10", "4", "500", { instrumentId: "GOLD" }),
    ]).get(2026)!;

    expect(year.securities.sales).toEqual([]);
    expect(fixed(year.securities.income)).toBe("0.00");
    expect(year.commodities.sales).toHaveLength(1);
    expect(fixed(year.commodities.income)).toBe("400.00");
    expect(year.empty).toBe(false);
  });

  it("is empty in a year without such sales", () => {
    const year = report([trade("BUY", "2026-01-10", "10", "400", { instrumentId: "GOLD" })]).get(
      2026,
    )!;

    expect(year.commodities).toMatchObject({ sales: [] });
    expect(year.empty).toBe(true);
  });
});

describe("computeTaxYears: virtual currencies", () => {
  const rates = ratesFrom({ "USD 2024-01-01": "4.00" });
  const usd = { instrumentId: "BTC", currency: "USD" };
  const flat: RateLookup = (currency, date) => (currency === "USD" ? { date, value: d(4) } : null);

  it("counts purchases as costs of the year they were made in, sold or not", () => {
    const years = report(
      [
        trade("BUY", "2024-02-01", "1", "1000", { ...usd, fee: "10" }),
        trade("BUY", "2025-02-01", "1", "2000", usd),
        trade("SELL", "2026-03-01", "1", "5000", { ...usd, fee: "20" }),
      ],
      flat,
    );

    const first = years.get(2024)!.crypto;
    expect(fixed(first.revenue)).toBe("0.00");
    expect(fixed(first.costs)).toBe("4040.00");
    expect(fixed(first.carriedCosts)).toBe("0.00");
    expect(fixed(first.income)).toBe("0.00");
    expect(fixed(first.carryForward)).toBe("4040.00");

    const second = years.get(2025)!.crypto;
    expect(fixed(second.costs)).toBe("8000.00");
    expect(fixed(second.carriedCosts)).toBe("4040.00");
    expect(fixed(second.carryForward)).toBe("12040.00");

    const third = years.get(2026)!.crypto;
    expect(fixed(third.revenue)).toBe("20000.00");
    // Only the commission of the sale.
    expect(fixed(third.costs)).toBe("80.00");
    expect(fixed(third.carriedCosts)).toBe("12040.00");
    expect(fixed(third.income)).toBe("7880.00");
    expect(fixed(third.carryForward)).toBe("0.00");
    // 19% of 7880 = 1497.20
    expect(fixed(third.tax)).toBe("1497.00");
    expect(third.lines.map((line) => line.type)).toEqual(["SELL"]);

    // Virtual currencies never mix with securities.
    expect(fixed(years.get(2026)!.securities.income)).toBe("0.00");
  });

  it("loses track of carried costs once a rate is missing", () => {
    const years = report(
      [trade("BUY", "2024-02-01", "1", "1000", usd), trade("SELL", "2026-03-01", "1", "5000", usd)],
      rates,
    );

    expect(years.get(2024)!.crypto.costs).toBeNull();
    expect(years.get(2025)!.crypto.carriedCosts).toBeNull();
    expect(years.get(2026)!.crypto.income).toBeNull();
    expect(years.get(2026)!.crypto.tax).toBeNull();
  });
});

describe("computeTaxYears: dividends and interest", () => {
  const rates = ratesFrom({ "USD 2026-05-14": "4.00", "USD 2026-08-13": "3.80" });

  it("settles foreign dividends up to 19% after the tax paid abroad", () => {
    const year = report(
      [
        income("DIVIDEND", "2026-05-15", "100", "15", "USD", "AAPL"),
        income("DIVIDEND", "2026-08-14", "50", "7.5", "USD", "AAPL"),
      ],
      rates,
    ).get(2026)!;

    const foreign = year.foreignIncome;
    // 400.00 + 190.00
    expect(fixed(foreign.gross)).toBe("590.00");
    expect(fixed(foreign.taxDue)).toBe("112.10");
    // 60.00 + 28.50
    expect(fixed(foreign.paidAbroad)).toBe("88.50");
    expect(fixed(foreign.deductible)).toBe("88.50");
    // 23.60 rounds to 24
    expect(fixed(foreign.toPay)).toBe("24.00");
    expect(foreign.lines[0].rate).toEqual({ date: "2026-05-14", value: d("4.00") });
    expect(year.domesticIncome.lines).toEqual([]);
  });

  it("deducts no more than 19% of a payment", () => {
    const year = report([income("DIVIDEND", "2026-05-15", "100", "30", "USD", "AAPL")], rates).get(
      2026,
    )!;

    expect(fixed(year.foreignIncome.paidAbroad)).toBe("120.00");
    expect(fixed(year.foreignIncome.deductible)).toBe("76.00");
    expect(fixed(year.foreignIncome.toPay)).toBe("0.00");
  });

  it("treats payments taxed by a Polish payer as information only", () => {
    const year = report([
      income("DIVIDEND", "2026-05-15", "100", "19", "PLN", "CDR"),
      income("INTEREST", "2026-06-15", "10", "1.9", "PLN", null),
    ]).get(2026)!;

    expect(fixed(year.domesticIncome.gross)).toBe("110.00");
    expect(fixed(year.domesticIncome.withheld)).toBe("20.90");
    expect(year.domesticIncome.lines[0].rate).toBeNull();
    expect(year.foreignIncome.lines).toEqual([]);
    expect(fixed(year.foreignIncome.toPay)).toBe("0.00");
  });

  it("takes interest without an instrument as foreign when it came in a foreign currency", () => {
    const year = report([income("INTEREST", "2026-05-15", "10", "0", "USD", null)], rates).get(
      2026,
    )!;

    expect(fixed(year.foreignIncome.gross)).toBe("40.00");
    // 19% of 40 = 7.60
    expect(fixed(year.foreignIncome.toPay)).toBe("8.00");
  });

  it("leaves the settlement unknown when the rate of a dividend is missing", () => {
    const year = report([income("DIVIDEND", "2026-05-15", "100", "15", "USD", "AAPL")]).get(2026)!;

    expect(year.foreignIncome.gross).toBeNull();
    expect(year.foreignIncome.toPay).toBeNull();
    expect(year.foreignIncome.lines[0].gross).toBeNull();
    expect(year.missingRates).toEqual(["USD"]);
  });
});
