import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { Decimal } from "@/domain/decimal";

/** The file is not a readable .xlsx workbook, or is unreasonably large once unpacked. */
export class WorkbookError extends Error {
  constructor(readonly reason: "notWorkbook" | "tooLarge") {
    super(`Cannot read the workbook: ${reason}`);
    this.name = "WorkbookError";
  }
}

/** One sheet as text: `rows[0]` is row 1, `rows[0][0]` is cell A1. Empty cells are "". */
export type Sheet = {
  name: string;
  rows: string[][];
};

/** A compressed file can unpack to far more than its size; nothing this big is a report. */
const MAX_PART_BYTES = 30 * 1024 * 1024;

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Everything stays text: numbers are parsed later, exactly, where their meaning is known.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ["sheet", "Relationship", "row", "c", "si", "r", "t"].includes(name),
});

function asNode(value: unknown): Node {
  return typeof value === "object" && value !== null ? (value as Node) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Text of `<t>` elements: plain strings, or objects when the element has attributes. */
function textOf(elements: unknown): string {
  return asList(elements)
    .map((element) =>
      typeof element === "string" ? element : String(asNode(element)["#text"] ?? ""),
    )
    .join("");
}

/** A shared or inline string: its own text, or the text of its formatted runs. */
function stringOf(item: unknown): string {
  const node = asNode(item);
  return (
    textOf(node.t) +
    asList(node.r)
      .map((run) => textOf(asNode(run).t))
      .join("")
  );
}

/** "AB12" -> 27 (zero-based column index). */
function columnIndex(reference: string): number {
  let index = 0;
  for (const letter of reference) {
    if (letter < "A" || letter > "Z") {
      break;
    }
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function readSheet(xml: string, sharedStrings: readonly string[]): string[][] {
  const sheetData = asNode(asNode(parser.parse(xml).worksheet).sheetData);
  const rows: string[][] = [];

  for (const [position, rowNode] of asList(sheetData.row).entries()) {
    const row = asNode(rowNode);
    const rowIndex = Number(row["@r"] ?? position + 1) - 1;
    const cells: string[] = [];

    for (const cellNode of asList(row.c)) {
      const cell = asNode(cellNode);
      const column = columnIndex(String(cell["@r"] ?? ""));
      if (column < 0) {
        continue;
      }

      const type = cell["@t"];
      const raw = typeof cell.v === "string" ? cell.v : "";
      const value =
        type === "s"
          ? (sharedStrings[Number(raw)] ?? "")
          : type === "inlineStr"
            ? stringOf(cell.is)
            : raw;

      while (cells.length < column) {
        cells.push("");
      }
      cells[column] = value;
    }

    while (rows.length < rowIndex) {
      rows.push([]);
    }
    rows[rowIndex] = cells;
  }

  return rows.map((row) => row.map((cell) => cell ?? ""));
}

/**
 * Reads the sheets of an .xlsx file as text. Only cell values are read: no formulas,
 * styles or macros, and nothing is evaluated.
 */
export function readWorkbook(bytes: Uint8Array): Sheet[] {
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      filter: (file) => {
        const wanted =
          file.name === "xl/workbook.xml" ||
          file.name === "xl/_rels/workbook.xml.rels" ||
          file.name === "xl/sharedStrings.xml" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);

        if (wanted && file.originalSize > MAX_PART_BYTES) {
          throw new WorkbookError("tooLarge");
        }
        return wanted;
      },
    });
  } catch (error) {
    if (error instanceof WorkbookError) {
      throw error;
    }
    throw new WorkbookError("notWorkbook");
  }

  const part = (name: string) => (parts[name] ? strFromU8(parts[name]) : null);
  const workbookXml = part("xl/workbook.xml");
  const relationsXml = part("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationsXml) {
    throw new WorkbookError("notWorkbook");
  }

  try {
    const sharedXml = part("xl/sharedStrings.xml");
    const sharedStrings = sharedXml
      ? asList(asNode(parser.parse(sharedXml).sst).si).map(stringOf)
      : [];

    const targets = new Map(
      asList(asNode(parser.parse(relationsXml).Relationships).Relationship).map((relation) => {
        const target = String(asNode(relation)["@Target"] ?? "");
        return [
          String(asNode(relation)["@Id"] ?? ""),
          target.startsWith("/") ? target.slice(1) : `xl/${target}`,
        ];
      }),
    );

    return asList(asNode(asNode(parser.parse(workbookXml).workbook).sheets).sheet).map((sheet) => {
      const node = asNode(sheet);
      const xml = part(targets.get(String(node["@r:id"] ?? "")) ?? "");
      return {
        name: String(node["@name"] ?? ""),
        rows: xml ? readSheet(xml, sharedStrings) : [],
      };
    });
  } catch {
    throw new WorkbookError("notWorkbook");
  }
}

/** A numeric cell ("12.5", "2.5E-12") as an exact decimal; null for anything else. */
export function cellNumber(text: string): Decimal | null {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.trim())) {
    return null;
  }
  return new Decimal(text.trim());
}

/** Day number of 1970-01-01 in the calendar spreadsheets use for dates. */
const UNIX_EPOCH_SERIAL = 25569;
const DAY_MS = 86_400_000;

/** A spreadsheet date-time (days since 1899-12-30, as UTC) as a point in time. */
export function serialToDate(serial: Decimal): Date {
  return new Date(serial.minus(UNIX_EPOCH_SERIAL).times(DAY_MS).round().toNumber());
}
