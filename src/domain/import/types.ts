import type { Decimal } from "@/domain/decimal";
import type { IsoDate } from "@/domain/portfolio/dates";
import type { Market } from "@/domain/portfolio/markets";

/** An instrument as a broker's file names it; the catalogue entry is found or created later. */
export type ImportedInstrument = {
  symbol: string;
  name: string;
  type: "STOCK" | "ETF";
  currency: string;
  /** Markets it may be listed on, most likely first; the file does not always tell. */
  markets: Market[];
};

type OperationBase = {
  /** The broker's own id of the operation; makes a second import of the same file harmless. */
  externalId: string;
  date: IsoDate;
  /** Currency in which cash moved on the account. */
  currency: string;
  note: string | null;
  /** Row of the file the operation was read from, for messages. */
  row: number;
};

/** One account operation read from a broker's file, in the app's own terms. */
export type ImportedOperation =
  | (OperationBase & {
      type: "BUY" | "SELL";
      instrument: ImportedInstrument;
      quantity: Decimal;
      /** Price of one unit in the instrument's currency; zero for shares received for free. */
      price: Decimal;
      /** Units of `currency` per one unit of the instrument's currency. */
      fxRate: Decimal;
    })
  | (OperationBase & {
      type: "DIVIDEND";
      instrument: ImportedInstrument;
      /** Gross amount. */
      amount: Decimal;
      tax: Decimal;
    })
  | (OperationBase & { type: "INTEREST"; amount: Decimal; tax: Decimal })
  | (OperationBase & { type: "DEPOSIT" | "WITHDRAWAL" | "FEE"; amount: Decimal });

/** A row that was left out, and why. */
export type SkippedRow = {
  row: number;
  /** What the file calls the operation. */
  label: string;
  reason: "unknownType" | "unreadable" | "unknownMarket";
  amount: Decimal | null;
};

/** What an importer makes of a file. Another broker is another function returning this. */
export type ImportedReport = {
  source: "XTB";
  accountNumber: string;
  /** Currency of the account the file describes. */
  currency: string;
  /** Oldest first. */
  operations: ImportedOperation[];
  skipped: SkippedRow[];
  /**
   * Instruments whose open quantity stated by the file differs from what the operations
   * add up to. Empty when the file covers the whole history and everything was understood.
   */
  holdingMismatches: { symbol: string; inFile: Decimal; fromOperations: Decimal }[];
};

/** The file is a workbook, but not a report this importer understands. */
export class ImportFormatError extends Error {
  constructor(readonly reason: "notReport" | "noCurrency") {
    super(`Cannot import the file: ${reason}`);
    this.name = "ImportFormatError";
  }
}
