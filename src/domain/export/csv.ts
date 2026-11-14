import type { Decimal } from "@/domain/decimal";

/** Excel needs this mark to read a UTF-8 file with Polish letters correctly. */
const BYTE_ORDER_MARK = "﻿";
const SEPARATOR = ";";

/**
 * Text typed by a user, made safe for a spreadsheet: a cell that starts like a formula is
 * prefixed with an apostrophe so the spreadsheet shows it instead of running it.
 */
export function csvText(value: string | null): string {
  if (!value) {
    return "";
  }
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** A number the way a Polish spreadsheet reads it: decimal comma, no grouping. */
export function csvNumber(value: Decimal | null): string {
  return value ? value.toFixed().replace(".", ",") : "";
}

function escape(cell: string): string {
  return /[";\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/**
 * A CSV file for spreadsheets set to Polish: semicolons between cells, CRLF line ends.
 * Cells must already be formatted with `csvText` or `csvNumber`.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(escape).join(SEPARATOR));
  return `${BYTE_ORDER_MARK}${lines.join("\r\n")}\r\n`;
}
