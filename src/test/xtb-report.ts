import { buildWorkbook, type TestCell, type TestSheet } from "./xlsx";

/** One row of the "Cash Operations" sheet. All figures in tests are made up. */
export type XtbOperation = {
  type: string;
  /** "2026-01-12 09:30", in UTC as XTB writes it. */
  time: string;
  amount: number;
  id?: string;
  comment?: string;
  ticker?: string;
  instrument?: string;
  category?: string;
  positionId?: string;
};

export type XtbOpenPosition = {
  ticker: string;
  name: string;
  category?: string;
  /** Volume, open price and open time of every position in the instrument. */
  positions: { id: string; volume: number; openPrice: number; time: string }[];
};

export type XtbReportOptions = {
  accountNumber?: string;
  /** Written into the summary of open positions; null leaves it empty, as on IKE accounts. */
  currency?: string | null;
  product?: string;
  operations: XtbOperation[];
  open?: XtbOpenPosition[];
};

/** A UTC date-time as the day number spreadsheets use. */
export function excelTime(text: string): number {
  return Date.parse(`${text.replace(" ", "T")}:00.000Z`) / 86_400_000 + 25569;
}

/** The sheets of a report laid out the way XTB's account history export lays them out. */
export function xtbSheets(options: XtbReportOptions): TestSheet[] {
  const account = options.accountNumber ?? "10000001";
  const product = options.product ?? "My Trades";
  const preamble = (title: string): TestCell[][] => [
    ["Account number", account],
    [title, ""],
    ["Date from (UTC)", 38718],
    ["Date to (UTC)", 46340.5],
  ];

  // Like the real file: newest first, then a line with the total.
  const operations = options.operations
    .map((operation, index) => ({ operation, id: operation.id ?? String(1000 + index) }))
    .sort((a, b) => excelTime(b.operation.time) - excelTime(a.operation.time));

  const cash: TestCell[][] = [
    ...preamble("Cash Operations"),
    [
      "Type",
      "Instrument",
      "Ticker",
      "Category",
      "Time",
      "Amount",
      "ID",
      "Comment",
      "Product",
      "Position ID",
    ],
    ...operations.map(({ operation, id }): TestCell[] => [
      operation.type,
      operation.instrument ?? "",
      operation.ticker ?? "",
      operation.ticker ? (operation.category ?? "STOCK") : "",
      excelTime(operation.time),
      operation.amount,
      id,
      operation.comment ?? "",
      product,
      operation.positionId ?? "",
    ]),
    ["Total", null, null, null, null, options.operations.reduce((sum, o) => sum + o.amount, 0)],
  ];

  const open: TestCell[][] = [
    ["Account number", account],
    ["Open Positions", ""],
    ["Data as of report generated", 46340.5],
    ["Product", "Metric", "Amount", "Currency"],
    [
      product,
      "Open position value",
      0,
      options.currency === null ? "" : (options.currency ?? "PLN"),
    ],
    [
      product,
      "Open position profit",
      0,
      options.currency === null ? "" : (options.currency ?? "PLN"),
    ],
    [],
    ["Note", "Summary values are shown in the account currency.", "", ""],
    [
      "Product",
      "Instrument/Position",
      "Ticker",
      "Category",
      "Type",
      "Volume",
      "Value",
      "Current price",
      "Open price",
      "Open time (UTC)",
    ],
    ...(options.open ?? []).flatMap((instrument): TestCell[][] => [
      [
        product,
        instrument.name,
        instrument.ticker,
        instrument.category ?? "STOCK",
        "",
        instrument.positions.reduce((sum, position) => sum + position.volume, 0),
        0,
        "",
        0,
        "",
      ],
      ...instrument.positions.map((position): TestCell[] => [
        product,
        position.id,
        instrument.ticker,
        "",
        "BUY",
        position.volume,
        0,
        0,
        position.openPrice,
        excelTime(position.time),
      ]),
    ]),
  ];

  return [
    {
      name: "Closed Positions",
      rows: [...preamble("Closed Positions"), ["Instrument", "Ticker", "Category", "Type"]],
    },
    { name: "Cash Operations", rows: cash },
    { name: "Open Positions", rows: open },
  ];
}

/** The same report as the bytes of an .xlsx file. */
export function xtbWorkbook(options: XtbReportOptions): Uint8Array {
  return buildWorkbook(xtbSheets(options));
}
