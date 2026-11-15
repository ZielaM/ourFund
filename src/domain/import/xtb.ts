import { Decimal } from "@/domain/decimal";
import { isCurrency } from "@/domain/portfolio/currencies";
import { todayInWarsaw } from "@/domain/portfolio/dates";
import type { Market } from "@/domain/portfolio/markets";
import { INSTRUMENT_NAME_MAX_LENGTH, SYMBOL_PATTERN } from "@/domain/portfolio/naming";
import { NOTE_MAX_LENGTH } from "@/domain/portfolio/transaction-input";
import {
  ImportFormatError,
  type ImportedInstrument,
  type ImportedOperation,
  type ImportedReport,
  type SkippedRow,
} from "./types";
import { cellNumber, serialToDate, type Sheet } from "./xlsx";

const ZERO = new Decimal(0);
const ONE = new Decimal(1);

/**
 * What the suffix of an XTB ticker says about the instrument. Only markets whose currency
 * and price unit are certain are listed; anything else is left for the user to add by hand.
 */
const MARKETS_BY_SUFFIX: Record<string, { markets: Market[]; currency: string }> = {
  PL: { markets: ["GPW", "NEWCONNECT"], currency: "PLN" },
  US: { markets: ["NASDAQ", "NYSE"], currency: "USD" },
  DE: { markets: ["XETRA"], currency: "EUR" },
  FR: { markets: ["EURONEXT"], currency: "EUR" },
  NL: { markets: ["EURONEXT"], currency: "EUR" },
  BE: { markets: ["EURONEXT"], currency: "EUR" },
  PT: { markets: ["EURONEXT"], currency: "EUR" },
};

/** Money moved between the account and the outside world; the sign tells the direction. */
const TRANSFER_TYPE = /^(deposit|withdrawal|ik[z]?e (deposit|return).*)$/;

/** "OPEN BUY 4 @ 60.00", "CLOSE BUY 1/4 @ 82.50", "OPEN BUY XYZ.US 0.0125 @ 200.40". */
const TRADE_COMMENT =
  /^(OPEN|CLOSE) BUY (?:\S+ )?(\d+(?:\.\d+)?)(?:\/\d+(?:\.\d+)?)? @ (\d+(?:\.\d+)?)$/;

/** "Free-funds Interest 2026-10" and "Free-funds Interest Tax 2026-10" belong together. */
const INTEREST_PERIOD = /(\d{4}-\d{2})\s*$/;

/** A dividend and its withholding tax are booked at the same moment. */
const PAIRING_WINDOW_DAYS = new Decimal(2).div(86_400);

const COLUMNS = ["Type", "Instrument", "Ticker", "Category", "Time", "Amount", "ID", "Comment"];

type Row = {
  row: number;
  type: string;
  instrumentName: string;
  ticker: string;
  category: string;
  time: Decimal;
  amount: Decimal;
  id: string;
  comment: string;
};

function findSheet(sheets: readonly Sheet[], name: string): Sheet | null {
  return sheets.find((sheet) => sheet.name.trim().toLowerCase() === name) ?? null;
}

function instrumentOf(
  row: Pick<Row, "ticker" | "category" | "instrumentName">,
): ImportedInstrument | null {
  const dot = row.ticker.lastIndexOf(".");
  const symbol = row.ticker.slice(0, dot).toUpperCase();
  const market = MARKETS_BY_SUFFIX[row.ticker.slice(dot + 1).toUpperCase()];
  const category = row.category.toUpperCase();

  if (dot < 1 || !market || !SYMBOL_PATTERN.test(symbol)) {
    return null;
  }
  if (category !== "STOCK" && category !== "ETF") {
    return null;
  }

  return {
    symbol,
    name: (row.instrumentName.trim() || symbol).slice(0, INSTRUMENT_NAME_MAX_LENGTH),
    type: category,
    currency: market.currency,
    markets: market.markets,
  };
}

function note(text: string): string | null {
  return text.trim().slice(0, NOTE_MAX_LENGTH) || null;
}

export type XtbHints = {
  /** The user's answer when the file does not say which currency the account is in. */
  currency?: string;
  /** XTB names its files after the account, e.g. "EUR_12345678_2020-01-01_2026-11-14.xlsx". */
  fileName?: string;
};

/**
 * The account's currency. The file states it only for accounts with a summary of open
 * positions, so there are fallbacks: retirement accounts are kept in złoty, and XTB puts
 * the currency at the start of the file name.
 */
function accountCurrency(sheets: readonly Sheet[], products: Set<string>, hints: XtbHints): string {
  const rows = findSheet(sheets, "open positions")?.rows ?? [];
  const headerIndex = rows.findIndex((row) => row.includes("Metric") && row.includes("Currency"));
  const column = headerIndex < 0 ? -1 : rows[headerIndex].indexOf("Currency");
  const stated = headerIndex < 0 ? "" : (rows[headerIndex + 1]?.[column] ?? "").trim();
  const retirement = [...products].some((product) => /^ik[z]?e$/i.test(product));
  const fromName = /^([A-Z]{3})_/.exec(hints.fileName ?? "")?.[1] ?? "";

  const currency = [hints.currency ?? "", stated, retirement ? "PLN" : "", fromName].find(
    (candidate) => isCurrency(candidate),
  );
  if (!currency) {
    throw new ImportFormatError("noCurrency");
  }
  return currency;
}

type TimedOperation = ImportedOperation & { time: Decimal };

/** Shares booked at this price were not bought: XTB uses it for allotments and spin-offs. */
const NOMINAL_PRICE = new Decimal("0.001");

/**
 * Compares what the operations add up to with the open positions the file lists.
 *
 * Shares received without any cash moving (an allotment, a spin-off) never appear among
 * cash operations. Such a position is still listed as open, at a nominal price; it is added
 * as a purchase at price zero. Whatever difference remains is returned for the user to see.
 */
function reconcileWithOpenPositions(
  sheets: readonly Sheet[],
  operations: TimedOperation[],
  base: (row: Row) => Omit<TimedOperation, "type"> & { note: null },
): ImportedReport["holdingMismatches"] {
  const rows = findSheet(sheets, "open positions")?.rows ?? [];
  const headerIndex = rows.findIndex((row) => row.includes("Instrument/Position"));
  if (headerIndex < 0) {
    return [];
  }

  const header = rows[headerIndex];
  const cell = (cells: readonly string[], column: string) =>
    (cells[header.indexOf(column)] ?? "").trim();

  const held = new Map<string, Decimal>();
  for (const operation of operations) {
    if (operation.type === "BUY" || operation.type === "SELL") {
      const change = operation.type === "BUY" ? operation.quantity : operation.quantity.negated();
      held.set(
        operation.instrument.symbol,
        (held.get(operation.instrument.symbol) ?? ZERO).plus(change),
      );
    }
  }

  // A line per instrument (name, category, total) is followed by a line per position.
  const instruments = new Map<string, ImportedInstrument>();
  const listed = new Map<string, Decimal>();
  const nominal: { row: Row; instrument: ImportedInstrument; volume: Decimal }[] = [];

  for (const [index, cells] of rows.entries()) {
    const ticker = cell(cells, "Ticker");
    const volume = cellNumber(cell(cells, "Volume"));
    if (index <= headerIndex || !ticker || !volume) {
      continue;
    }

    if (cell(cells, "Type") !== "BUY") {
      const instrument = instrumentOf({
        ticker,
        category: cell(cells, "Category"),
        instrumentName: cell(cells, "Instrument/Position"),
      });
      if (instrument) {
        instruments.set(ticker, instrument);
      }
      continue;
    }

    const instrument = instruments.get(ticker);
    if (!instrument) {
      continue;
    }
    listed.set(instrument.symbol, (listed.get(instrument.symbol) ?? ZERO).plus(volume));

    const price = cellNumber(cell(cells, "Open price"));
    const time = cellNumber(cell(cells, "Open time (UTC)"));
    const id = cell(cells, "Instrument/Position");
    if (price?.lte(NOMINAL_PRICE) && time && id) {
      nominal.push({
        instrument,
        volume,
        row: {
          row: index + 1,
          type: "Open position",
          instrumentName: instrument.name,
          ticker,
          category: instrument.type,
          time,
          amount: ZERO,
          id: `position-${id}`,
          comment: "",
        },
      });
    }
  }

  for (const { row, instrument, volume } of nominal) {
    const missing = (listed.get(instrument.symbol) ?? ZERO).minus(
      held.get(instrument.symbol) ?? ZERO,
    );
    if (missing.gte(volume)) {
      operations.push({
        ...base(row),
        type: "BUY",
        instrument,
        quantity: volume,
        price: ZERO,
        fxRate: ONE,
      });
      held.set(instrument.symbol, (held.get(instrument.symbol) ?? ZERO).plus(volume));
    }
  }

  return [...new Set([...listed.keys(), ...held.keys()])]
    .map((symbol) => ({
      symbol,
      inFile: listed.get(symbol) ?? ZERO,
      fromOperations: held.get(symbol) ?? ZERO,
    }))
    .filter((entry) => !entry.inFile.eq(entry.fromOperations))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Reads the report XTB generates for one account (xStation: account history as .xlsx).
 * The "Cash Operations" sheet lists everything that moved money, which is all that is needed;
 * the sheets of positions repeat the same trades.
 *
 * Amounts are in the account's currency. Prices and quantities of trades are read from the
 * comment ("OPEN BUY 4 @ 60.00"), so the cost of a purchase is quantity times price and may
 * differ from the booked amount by a fraction of a grosz.
 */
export function parseXtbReport(sheets: readonly Sheet[], hints: XtbHints = {}): ImportedReport {
  const cash = findSheet(sheets, "cash operations");
  const headerIndex =
    cash?.rows.findIndex((row) => COLUMNS.every((column) => row.includes(column))) ?? -1;

  if (!cash || headerIndex < 0) {
    throw new ImportFormatError("notReport");
  }

  const header = cash.rows[headerIndex];
  const cell = (cells: readonly string[], column: string) =>
    (cells[header.indexOf(column)] ?? "").trim();
  const products = new Set(cash.rows.slice(headerIndex + 1).map((cells) => cell(cells, "Product")));
  const currency = accountCurrency(sheets, products, hints);
  const accountNumber =
    cash.rows.find((row) => row[0]?.trim().toLowerCase() === "account number")?.[1]?.trim() ?? "";

  const skipped: SkippedRow[] = [];
  const rows: Row[] = [];

  for (const [index, cells] of cash.rows.entries()) {
    const type = cell(cells, "Type");
    if (index <= headerIndex || !type || type.toLowerCase() === "total") {
      continue;
    }

    const time = cellNumber(cell(cells, "Time"));
    const amount = cellNumber(cell(cells, "Amount"));
    const id = cell(cells, "ID");

    if (!time || !amount || !id) {
      skipped.push({ row: index + 1, label: type, reason: "unreadable", amount });
      continue;
    }

    rows.push({
      row: index + 1,
      type,
      instrumentName: cell(cells, "Instrument"),
      ticker: cell(cells, "Ticker"),
      category: cell(cells, "Category"),
      time,
      // Amounts are money; the file stores them as binary floats (0.30000000000000004).
      amount: amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
      id,
      comment: cell(cells, "Comment"),
    });
  }

  // The file lists the newest operation first; an account is replayed from the oldest.
  rows.reverse();
  rows.sort((a, b) => a.time.comparedTo(b.time));

  const operations: TimedOperation[] = [];
  const base = (row: Row) => ({
    externalId: row.id,
    date: todayInWarsaw(serialToDate(row.time)),
    currency,
    note: null,
    row: row.row,
    time: row.time,
  });
  const skip = (row: Row, reason: SkippedRow["reason"]) =>
    skipped.push({ row: row.row, label: row.type, reason, amount: row.amount });

  const dividends: { row: Row; instrument: ImportedInstrument; tax: Decimal }[] = [];
  const taxes: Row[] = [];
  const interest = new Map<string, { row: Row; tax: Decimal }>();
  const interestTaxes: Row[] = [];

  for (const row of rows) {
    const type = row.type.toLowerCase();

    if (type === "stock purchase" || type === "stock sell") {
      const match = TRADE_COMMENT.exec(row.comment);
      const instrument = instrumentOf(row);
      const opens = type === "stock purchase";

      if (!instrument) {
        skip(row, "unknownMarket");
      } else if (!match || (match[1] === "OPEN") !== opens || row.amount.isNegative() !== opens) {
        skip(row, "unreadable");
      } else {
        const quantity = new Decimal(match[2]);
        const price = new Decimal(match[3]);
        const value = quantity.times(price);

        if (value.isZero()) {
          skip(row, "unreadable");
          continue;
        }

        operations.push({
          ...base(row),
          type: opens ? "BUY" : "SELL",
          instrument,
          quantity,
          price,
          // Paid in another currency: the rate is what was booked over what the units cost.
          fxRate:
            instrument.currency === currency
              ? ONE
              : row.amount.abs().div(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP),
        });
      }
    } else if (type === "dividend") {
      const instrument = instrumentOf(row);
      if (!instrument) {
        skip(row, "unknownMarket");
      } else if (!row.amount.isPositive() || row.amount.isZero()) {
        skip(row, "unreadable");
      } else {
        dividends.push({ row, instrument, tax: ZERO });
      }
    } else if (type === "withholding tax") {
      taxes.push(row);
    } else if (type === "free funds interest") {
      const period = INTEREST_PERIOD.exec(row.comment)?.[1];
      if (!period || !row.amount.isPositive() || row.amount.isZero() || interest.has(period)) {
        skip(row, "unreadable");
      } else {
        interest.set(period, { row, tax: ZERO });
      }
    } else if (type === "free funds interest tax") {
      interestTaxes.push(row);
    } else if (TRANSFER_TYPE.test(type)) {
      if (row.amount.isZero()) {
        skip(row, "unreadable");
      } else {
        operations.push({
          ...base(row),
          type: row.amount.isPositive() ? "DEPOSIT" : "WITHDRAWAL",
          amount: row.amount.abs(),
        });
      }
    } else {
      skip(row, "unknownType");
    }
  }

  /** A tax row that belongs to no payment: a later correction, booked on its own. */
  const standalone = (row: Row, instrument: ImportedInstrument | null) => {
    if (row.amount.isZero()) {
      skip(row, "unreadable");
    } else if (row.amount.isNegative()) {
      operations.push({
        ...base(row),
        type: "FEE",
        amount: row.amount.abs(),
        note: note(row.comment),
      });
    } else if (instrument) {
      // Tax given back: it reaches the account the way a small dividend would.
      operations.push({
        ...base(row),
        type: "DIVIDEND",
        instrument,
        amount: row.amount,
        tax: ZERO,
        note: note(row.comment),
      });
    } else {
      operations.push({
        ...base(row),
        type: "INTEREST",
        amount: row.amount,
        tax: ZERO,
        note: note(row.comment),
      });
    }
  };

  for (const tax of taxes) {
    const nearest = dividends
      .filter((dividend) => dividend.row.ticker === tax.ticker)
      .map((dividend) => ({ dividend, distance: dividend.row.time.minus(tax.time).abs() }))
      .filter(({ distance }) => distance.lte(PAIRING_WINDOW_DAYS))
      .sort((a, b) => a.distance.comparedTo(b.distance))[0]?.dividend;
    const paid = tax.amount.negated();

    if (nearest && paid.isPositive() && nearest.tax.plus(paid).lte(nearest.row.amount)) {
      nearest.tax = nearest.tax.plus(paid);
    } else {
      standalone(tax, instrumentOf(tax));
    }
  }

  for (const tax of interestTaxes) {
    const period = INTEREST_PERIOD.exec(tax.comment)?.[1];
    const payment = period ? interest.get(period) : undefined;
    const paid = tax.amount.negated();

    if (payment && paid.isPositive() && payment.tax.plus(paid).lte(payment.row.amount)) {
      payment.tax = payment.tax.plus(paid);
    } else {
      standalone(tax, null);
    }
  }

  for (const { row, instrument, tax } of dividends) {
    operations.push({ ...base(row), type: "DIVIDEND", instrument, amount: row.amount, tax });
  }
  for (const { row, tax } of interest.values()) {
    operations.push({ ...base(row), type: "INTEREST", amount: row.amount, tax });
  }

  const holdingMismatches = reconcileWithOpenPositions(sheets, operations, base);
  operations.sort((a, b) => a.time.comparedTo(b.time));

  return {
    source: "XTB",
    accountNumber,
    currency,
    operations: operations.map(({ time, ...operation }) => {
      void time;
      return operation;
    }),
    skipped: skipped.sort((a, b) => a.row - b.row),
    holdingMismatches,
  };
}
