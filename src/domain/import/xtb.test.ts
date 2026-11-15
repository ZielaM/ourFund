import { describe, expect, it } from "vitest";
import type { Decimal } from "@/domain/decimal";
import { buildWorkbook, type TestSheet } from "@/test/xlsx";
import { xtbSheets, type XtbOperation, type XtbReportOptions } from "@/test/xtb-report";
import { ImportFormatError, type ImportedOperation } from "./types";
import { readWorkbook } from "./xlsx";
import { parseXtbReport, type XtbHints } from "./xtb";

const fixed = (value: Decimal) => value.toFixed();

/** Parses made-up sheets the way a real file is parsed: written as .xlsx and read back. */
function parseSheets(sheets: TestSheet[], hints?: XtbHints) {
  return parseXtbReport(readWorkbook(buildWorkbook(sheets)), hints);
}

function parse(operations: XtbOperation[], options: Partial<XtbReportOptions> = {}) {
  return parseSheets(xtbSheets({ operations, ...options }));
}

/** The fields of an operation that tests care about, as plain text. */
function brief(operation: ImportedOperation): string {
  switch (operation.type) {
    case "BUY":
    case "SELL":
      return `${operation.date} ${operation.type} ${operation.instrument.symbol} ${fixed(operation.quantity)} @ ${fixed(operation.price)} fx ${fixed(operation.fxRate)} ${operation.currency}`;
    case "DIVIDEND":
      return `${operation.date} DIVIDEND ${operation.instrument.symbol} ${fixed(operation.amount)} tax ${fixed(operation.tax)} ${operation.currency}`;
    case "INTEREST":
      return `${operation.date} INTEREST ${fixed(operation.amount)} tax ${fixed(operation.tax)} ${operation.currency}`;
    default:
      return `${operation.date} ${operation.type} ${fixed(operation.amount)} ${operation.currency}`;
  }
}

const buy = (time: string, comment: string, amount: number, extra: Partial<XtbOperation> = {}) => ({
  type: "Stock purchase",
  time,
  amount,
  comment,
  ticker: "ABC.PL",
  instrument: "Spółka ABC",
  ...extra,
});

const sell = (
  time: string,
  comment: string,
  amount: number,
  extra: Partial<XtbOperation> = {},
) => ({
  ...buy(time, comment, amount, extra),
  type: "Stock sell",
});

function reasonOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof ImportFormatError ? error.reason : "other";
  }
}

describe("parseXtbReport: the file", () => {
  it("names the account and its currency", () => {
    const report = parse([], { accountNumber: "20000002", currency: "EUR" });

    expect(report.source).toBe("XTB");
    expect(report.accountNumber).toBe("20000002");
    expect(report.currency).toBe("EUR");
    expect(report.operations).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.holdingMismatches).toEqual([]);
  });

  it("refuses a workbook that is not an account report", () => {
    expect(reasonOf(() => parseXtbReport([{ name: "Arkusz1", rows: [["a", "b"]] }]))).toBe(
      "notReport",
    );
    expect(
      reasonOf(() => parseXtbReport([{ name: "Cash Operations", rows: [["Type", "Amount"]] }])),
    ).toBe("notReport");
  });

  it("takes a retirement account to be in złoty when the file does not say", () => {
    expect(
      parse([{ type: "Deposit", time: "2026-01-02 10:00", amount: 100 }], {
        currency: null,
        product: "IKE",
      }).currency,
    ).toBe("PLN");
  });

  it("falls back to the currency in the file name, then asks", () => {
    const sheets = xtbSheets({
      currency: null,
      operations: [{ type: "Deposit", time: "2026-01-02 10:00", amount: 100 }],
    });

    expect(parseSheets(sheets, { fileName: "USD_30000003_2020-01-01.xlsx" }).currency).toBe("USD");
    expect(reasonOf(() => parseSheets(sheets, { fileName: "raport.xlsx" }))).toBe("noCurrency");
    expect(reasonOf(() => parseSheets(sheets))).toBe("noCurrency");
  });

  it("lets the user's answer win over everything else", () => {
    const sheets = xtbSheets({ currency: "PLN", operations: [] });
    expect(parseSheets(sheets, { currency: "EUR", fileName: "USD_1.xlsx" }).currency).toBe("EUR");
  });
});

describe("parseXtbReport: trades", () => {
  it("reads quantity and price from the comment, oldest operation first", () => {
    const report = parse([
      sell("2026-03-02 10:00", "CLOSE BUY 4 @ 82.50", 330),
      buy("2026-01-12 09:30", "OPEN BUY 4 @ 60.00", -240),
    ]);

    expect(report.operations.map(brief)).toEqual([
      "2026-01-12 BUY ABC 4 @ 60 fx 1 PLN",
      "2026-03-02 SELL ABC 4 @ 82.5 fx 1 PLN",
    ]);
    expect(report.operations[0]).toMatchObject({
      externalId: "1001",
      note: null,
      instrument: {
        symbol: "ABC",
        name: "Spółka ABC",
        type: "STOCK",
        currency: "PLN",
        markets: ["GPW", "NEWCONNECT"],
      },
    });
  });

  it("takes the filled part of an order split into several fills", () => {
    const report = parse([
      buy("2026-01-12 09:30", "OPEN BUY 1/4 @ 60.00", -60),
      buy("2026-01-12 09:31", "OPEN BUY 3/4 @ 60.10", -180.3),
      sell("2026-02-12 09:30", "CLOSE BUY 1/4 @ 80.00", 80),
    ]);

    expect(report.operations.map(brief)).toEqual([
      "2026-01-12 BUY ABC 1 @ 60 fx 1 PLN",
      "2026-01-12 BUY ABC 3 @ 60.1 fx 1 PLN",
      "2026-02-12 SELL ABC 1 @ 80 fx 1 PLN",
    ]);
  });

  it("reads fractional shares, with or without the ticker in the comment", () => {
    const report = parse(
      [
        buy("2026-01-12 09:30", "OPEN BUY XYZ.US 0.0125 @ 200.40", -2.51, {
          ticker: "XYZ.US",
          instrument: "Xyz Inc",
        }),
        buy("2026-01-13 09:30", "OPEN BUY 0.3750/1.3750 @ 210.20", -78.83, {
          ticker: "XYZ.US",
          instrument: "Xyz Inc",
        }),
      ],
      { currency: "USD" },
    );

    expect(report.operations.map(brief)).toEqual([
      "2026-01-12 BUY XYZ 0.0125 @ 200.4 fx 1 USD",
      "2026-01-13 BUY XYZ 0.375 @ 210.2 fx 1 USD",
    ]);
    expect(report.operations[0]).toMatchObject({
      instrument: { currency: "USD", markets: ["NASDAQ", "NYSE"] },
    });
  });

  it("works out the exchange rate when the account paid in another currency", () => {
    const report = parse([
      buy("2026-01-12 09:30", "OPEN BUY 2 @ 100.00", -820, {
        ticker: "XYZ.US",
        instrument: "Xyz Inc",
      }),
    ]);

    // 820 zł for 200 USD worth of shares.
    expect(report.operations.map(brief)).toEqual(["2026-01-12 BUY XYZ 2 @ 100 fx 4.1 PLN"]);
  });

  it("recognizes an ETF and a share class with a dot in its symbol", () => {
    const report = parse(
      [
        buy("2026-01-12 09:30", "OPEN BUY 1 @ 50.25", -50.25, {
          ticker: "WXYZ.DE",
          instrument: "Global ETF",
          category: "ETF",
        }),
        buy("2026-01-13 09:30", "OPEN BUY 1 @ 400.00", -400, {
          ticker: "BRK.B.US",
          instrument: "Berkshire Hathaway",
        }),
      ],
      { currency: "EUR" },
    );

    expect(report.operations[0]).toMatchObject({
      instrument: { symbol: "WXYZ", type: "ETF", currency: "EUR", markets: ["XETRA"] },
    });
    expect(report.operations[1]).toMatchObject({ instrument: { symbol: "BRK.B" } });
  });

  it("puts an operation on the day it happened in Poland", () => {
    const report = parse([buy("2026-01-12 23:30", "OPEN BUY 1 @ 10.00", -10)]);
    expect(report.operations[0].date).toBe("2026-01-13");
  });

  it("keeps the order of operations made in the same minute", () => {
    const report = parse([
      buy("2026-01-12 09:30", "OPEN BUY 5 @ 10.00", -50, { id: "1" }),
      sell("2026-01-12 09:30", "CLOSE BUY 5 @ 11.00", 55, { id: "2" }),
    ]);

    // The file lists the later operation first; both carry the same time.
    expect(report.operations.map((operation) => operation.type)).toEqual(["SELL", "BUY"]);
  });

  it("leaves out trades it cannot read and says why", () => {
    const report = parse([
      buy("2026-01-12 09:30", "OPEN BUY 4 @ 60.00", -240, { ticker: "ABC.XX" }),
      buy("2026-01-13 09:30", "something else", -10),
      buy("2026-01-14 09:30", "CLOSE BUY 1 @ 10.00", -10),
      buy("2026-01-15 09:30", "OPEN BUY 1 @ 10.00", 10),
      buy("2026-01-16 09:30", "OPEN BUY 0 @ 10.00", -10),
      buy("2026-01-17 09:30", "OPEN BUY 1 @ 10.00", -10, { category: "CFD" }),
    ]);

    expect(report.operations).toEqual([]);
    expect(report.skipped.map((row) => row.reason)).toEqual([
      "unknownMarket",
      "unreadable",
      "unreadable",
      "unreadable",
      "unreadable",
      "unknownMarket",
    ]);
    expect(report.skipped.every((row) => row.label === "Stock purchase")).toBe(true);
  });
});

describe("parseXtbReport: income", () => {
  const dividend = (time: string, amount: number, extra: Partial<XtbOperation> = {}) => ({
    type: "Dividend",
    time,
    amount,
    comment: "ABC.PL PLN 2.50/ SHR",
    ticker: "ABC.PL",
    instrument: "Spółka ABC",
    ...extra,
  });
  const tax = (time: string, amount: number, extra: Partial<XtbOperation> = {}) => ({
    ...dividend(time, amount, extra),
    type: "Withholding tax",
    comment: extra.comment ?? "ABC.PL PLN WHT 19%",
  });

  it("joins a dividend with the tax withheld on it", () => {
    const report = parse([
      tax("2026-05-15 08:00", -7.6, { id: "50" }),
      dividend("2026-05-15 08:00", 40, { id: "51" }),
    ]);

    expect(report.operations.map(brief)).toEqual(["2026-05-15 DIVIDEND ABC 40 tax 7.6 PLN"]);
    // The dividend's id identifies the pair.
    expect(report.operations[0].externalId).toBe("51");
  });

  it("gives each of two payments made moments apart its own tax", () => {
    const report = parse([
      dividend("2026-05-15 08:00", 100, { id: "1" }),
      tax("2026-05-15 08:00", -19, { id: "2" }),
      dividend("2026-05-15 08:01", 10, { id: "3", ticker: "DEF.PL" }),
      tax("2026-05-15 08:01", -1.9, { id: "4", ticker: "DEF.PL" }),
    ]);

    expect(report.operations.map(brief)).toEqual([
      "2026-05-15 DIVIDEND ABC 100 tax 19 PLN",
      "2026-05-15 DIVIDEND DEF 10 tax 1.9 PLN",
    ]);
  });

  it("keeps a dividend without tax, as on a retirement account", () => {
    const report = parse([dividend("2026-05-15 08:00", 55)]);
    expect(report.operations.map(brief)).toEqual(["2026-05-15 DIVIDEND ABC 55 tax 0 PLN"]);
  });

  it("books a later correction of tax on its own", () => {
    const report = parse([
      dividend("2026-05-15 08:00", 100),
      tax("2026-09-01 08:00", 0.01, { comment: "Dividends Reclassification 2025" }),
      tax("2026-09-02 08:00", -0.5, { comment: "Dividends Reclassification 2025" }),
    ]);

    expect(report.operations.map(brief)).toEqual([
      "2026-05-15 DIVIDEND ABC 100 tax 0 PLN",
      "2026-09-01 DIVIDEND ABC 0.01 tax 0 PLN",
      "2026-09-02 FEE 0.5 PLN",
    ]);
    expect(report.operations[1].note).toBe("Dividends Reclassification 2025");
    expect(report.operations[2].note).toBe("Dividends Reclassification 2025");
  });

  it("never lets tax exceed the payment it is joined with", () => {
    const report = parse([dividend("2026-05-15 08:00", 1), tax("2026-05-15 08:00", -5)]);

    expect(report.operations.map(brief)).toEqual([
      "2026-05-15 FEE 5 PLN",
      "2026-05-15 DIVIDEND ABC 1 tax 0 PLN",
    ]);
  });

  it("joins interest on idle cash with its tax by the month they are for", () => {
    const report = parse([
      {
        type: "Free funds interest",
        time: "2026-09-03 13:00",
        amount: 3.2,
        comment: "Free-funds Interest 2026-08",
      },
      {
        type: "Free funds interest tax",
        time: "2026-09-03 13:05",
        amount: -0.61,
        comment: "Free-funds Interest Tax 2026-08",
      },
      {
        type: "Free funds interest",
        time: "2026-10-03 13:00",
        amount: 0.01,
        comment: "Free-funds Interest 2026-09",
      },
    ]);

    expect(report.operations.map(brief)).toEqual([
      "2026-09-03 INTEREST 3.2 tax 0.61 PLN",
      "2026-10-03 INTEREST 0.01 tax 0 PLN",
    ]);
  });

  it("books interest tax without its interest as a fee, and skips what it cannot read", () => {
    const report = parse([
      {
        type: "Free funds interest tax",
        time: "2026-09-03 13:05",
        amount: -0.2,
        comment: "Free-funds Interest Tax 2026-08",
      },
      { type: "Free funds interest", time: "2026-09-04 13:00", amount: 1, comment: "odsetki" },
      { type: "Dividend", time: "2026-09-05 13:00", amount: 1, ticker: "ABC.XX", comment: "x" },
      { type: "Dividend", time: "2026-09-06 13:00", amount: -1, ticker: "ABC.PL", comment: "x" },
    ]);

    expect(report.operations.map(brief)).toEqual(["2026-09-03 FEE 0.2 PLN"]);
    expect(report.skipped.map((row) => `${row.label}: ${row.reason}`)).toEqual([
      "Dividend: unreadable",
      "Dividend: unknownMarket",
      "Free funds interest: unreadable",
    ]);
  });
});

describe("parseXtbReport: cash", () => {
  it("tells deposits from withdrawals by the sign of the amount", () => {
    const report = parse([
      { type: "Deposit", time: "2026-01-02 10:00", amount: 2000, comment: "BLIK deposit" },
      { type: "Withdrawal", time: "2026-01-03 10:00", amount: -120 },
      { type: "IKE deposit", time: "2026-01-04 10:00", amount: -700 },
      { type: "IKE deposit", time: "2026-01-05 10:00", amount: 700 },
      { type: "IKE return partial", time: "2026-01-06 10:00", amount: 80 },
      { type: "IKZE deposit", time: "2026-01-07 10:00", amount: -40 },
    ]);

    expect(report.operations.map(brief)).toEqual([
      "2026-01-02 DEPOSIT 2000 PLN",
      "2026-01-03 WITHDRAWAL 120 PLN",
      "2026-01-04 WITHDRAWAL 700 PLN",
      "2026-01-05 DEPOSIT 700 PLN",
      "2026-01-06 DEPOSIT 80 PLN",
      "2026-01-07 WITHDRAWAL 40 PLN",
    ]);
    // Comments of transfers carry payment references; they are not copied.
    expect(report.operations[0].note).toBeNull();
  });

  it("rounds amounts stored as binary fractions to grosze", () => {
    const report = parse([
      { type: "Deposit", time: "2026-01-02 10:00", amount: 0.30000000000000004 },
    ]);
    expect(report.operations.map(brief)).toEqual(["2026-01-02 DEPOSIT 0.3 PLN"]);
  });

  it("leaves out operations it does not know and rows it cannot read", () => {
    const report = parse([
      { type: "Currency conversion", time: "2026-01-02 10:00", amount: -100 },
      { type: "Deposit", time: "2026-01-03 10:00", amount: 0 },
    ]);

    expect(report.operations).toEqual([]);
    expect(
      report.skipped.map((row) => `${row.label}: ${row.reason} ${row.amount?.toFixed()}`),
    ).toEqual(["Deposit: unreadable 0", "Currency conversion: unknownType -100"]);
  });

  it("ignores the line with the total and reports rows without an id or a time", () => {
    const sheets = xtbSheets({
      operations: [{ type: "Deposit", time: "2026-01-02 10:00", amount: 100 }],
    });
    const cash = sheets.find((sheet) => sheet.name === "Cash Operations")!;
    cash.rows.push(["Deposit", "", "", "", "", 50, "77", "", "My Trades", ""]);
    cash.rows.push(["Deposit", "", "", "", 46034.5, 50, "", "", "My Trades", ""]);

    const report = parseSheets(sheets);

    expect(report.operations).toHaveLength(1);
    expect(report.skipped.map((row) => row.reason)).toEqual(["unreadable", "unreadable"]);
    expect(report.skipped[0].row).toBe(8);
  });
});

describe("parseXtbReport: open positions", () => {
  const purchases = [
    buy("2026-01-12 09:30", "OPEN BUY 20 @ 30.00", -600),
    buy("2026-02-12 09:30", "OPEN BUY 5 @ 32.00", -160),
  ];

  it("finds nothing to report when operations explain every open position", () => {
    const report = parse(purchases, {
      open: [
        {
          ticker: "ABC.PL",
          name: "Spółka ABC",
          positions: [
            { id: "p1", volume: 20, openPrice: 30, time: "2026-01-12 09:30" },
            { id: "p2", volume: 5, openPrice: 32, time: "2026-02-12 09:30" },
          ],
        },
      ],
    });

    expect(report.holdingMismatches).toEqual([]);
    expect(report.operations).toHaveLength(2);
  });

  it("adds shares received without payment as a purchase at price zero", () => {
    const report = parse(purchases, {
      open: [
        {
          ticker: "ABC.PL",
          name: "Spółka ABC",
          positions: [
            { id: "p1", volume: 20, openPrice: 30, time: "2026-01-12 09:30" },
            { id: "p9", volume: 7, openPrice: 0.001, time: "2026-01-20 21:00" },
            { id: "p2", volume: 5, openPrice: 32, time: "2026-02-12 09:30" },
          ],
        },
      ],
    });

    expect(report.operations.map(brief)).toEqual([
      "2026-01-12 BUY ABC 20 @ 30 fx 1 PLN",
      "2026-01-20 BUY ABC 7 @ 0 fx 1 PLN",
      "2026-02-12 BUY ABC 5 @ 32 fx 1 PLN",
    ]);
    expect(report.operations[1].externalId).toBe("position-p9");
    expect(report.holdingMismatches).toEqual([]);
  });

  it("reports a quantity the operations do not explain", () => {
    const report = parse(purchases, {
      open: [
        {
          ticker: "ABC.PL",
          name: "Spółka ABC",
          positions: [{ id: "p1", volume: 40, openPrice: 30, time: "2026-01-12 09:30" }],
        },
        {
          ticker: "DEF.PL",
          name: "Spółka DEF",
          positions: [{ id: "p5", volume: 3, openPrice: 10, time: "2025-01-12 09:30" }],
        },
      ],
    });

    expect(
      report.holdingMismatches.map(
        (entry) => `${entry.symbol} ${entry.inFile.toFixed()}/${entry.fromOperations.toFixed()}`,
      ),
    ).toEqual(["ABC 40/25", "DEF 3/0"]);
    expect(report.operations).toHaveLength(2);
  });

  it("does not add free shares the operations already account for", () => {
    const report = parse(purchases, {
      open: [
        {
          ticker: "ABC.PL",
          name: "Spółka ABC",
          positions: [
            { id: "p1", volume: 18, openPrice: 30, time: "2026-01-12 09:30" },
            { id: "p9", volume: 7, openPrice: 0.001, time: "2026-01-20 21:00" },
          ],
        },
        // Listed on a market the importer does not know: left alone.
        {
          ticker: "QQQ.XX",
          name: "Nieznany",
          positions: [{ id: "p7", volume: 1, openPrice: 0.001, time: "2026-01-20 21:00" }],
        },
      ],
    });

    expect(report.operations).toHaveLength(2);
    expect(report.holdingMismatches).toEqual([]);
  });

  it("reports sold-out instruments the file still lists nothing for", () => {
    const report = parse([...purchases, sell("2026-03-01 10:00", "CLOSE BUY 40 @ 50.00", 2000)]);

    expect(report.holdingMismatches.map((entry) => entry.fromOperations.toFixed())).toEqual([
      "-15",
    ]);
  });
});
