import { ImportFormatError, type ImportedReport } from "./types";
import { readWorkbook, WorkbookError } from "./xlsx";
import { parseXtbReport, type XtbHints } from "./xtb";

/** Uploaded reports are tens of kilobytes; anything near this size is not one. */
export const MAX_IMPORT_FILE_BYTES = 4 * 1024 * 1024;

export type ReadReportResult =
  | { ok: true; report: ImportedReport }
  | { ok: false; reason: "tooLarge" | "notWorkbook" | "notReport" | "noCurrency" };

/** Turns the bytes of an uploaded XTB report into operations, or says what is wrong with it. */
export function readXtbFile(bytes: Uint8Array, hints: XtbHints = {}): ReadReportResult {
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, reason: "tooLarge" };
  }

  try {
    return { ok: true, report: parseXtbReport(readWorkbook(bytes), hints) };
  } catch (error) {
    if (error instanceof WorkbookError || error instanceof ImportFormatError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}
