import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { buildWorkbook } from "@/test/xlsx";
import { cellNumber, readWorkbook, serialToDate, WorkbookError } from "./xlsx";

const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

function rawWorkbook(sheetXml: string, sharedStringsXml?: string): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(
      `<workbook ${MAIN} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dane" sheetId="1" r:id="rId7"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId7" Target="/xl/worksheets/data.xml"/></Relationships>`,
    ),
    "xl/worksheets/data.xml": strToU8(sheetXml),
    ...(sharedStringsXml ? { "xl/sharedStrings.xml": strToU8(sharedStringsXml) } : {}),
    // Parts a reader has no use for are never unpacked.
    "xl/styles.xml": strToU8("<styleSheet/>"),
  });
}

function reasonOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof WorkbookError ? error.reason : "other";
  }
}

describe("readWorkbook", () => {
  it("reads every sheet as rows of text, in the order of the workbook", () => {
    const sheets = readWorkbook(
      buildWorkbook([
        {
          name: "Pierwszy",
          rows: [
            ["Nazwa", "Kwota"],
            ["Zażółć & <gęślą>", 12.5],
          ],
        },
        { name: "Drugi", rows: [[1, 2, 3]] },
      ]),
    );

    expect(sheets).toEqual([
      {
        name: "Pierwszy",
        rows: [
          ["Nazwa", "Kwota"],
          ["Zażółć & <gęślą>", "12.5"],
        ],
      },
      { name: "Drugi", rows: [["1", "2", "3"]] },
    ]);
  });

  it("keeps the place of cells and rows that the file leaves out", () => {
    const [sheet] = readWorkbook(
      buildWorkbook([{ name: "Luki", rows: [["a", null, "c"], [], [null, "b"]] }]),
    );

    expect(sheet.rows).toEqual([["a", "", "c"], [], ["", "b"]]);
  });

  it("finds a sheet through the workbook's relations, whatever its file is called", () => {
    const [sheet] = readWorkbook(
      rawWorkbook(
        `<worksheet ${MAIN}><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`,
      ),
    );

    expect(sheet).toEqual({ name: "Dane", rows: [["7"]] });
  });

  it("reads inline strings and shared strings made of formatted runs", () => {
    const [sheet] = readWorkbook(
      rawWorkbook(
        `<worksheet ${MAIN}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>w komórce</t></is></c><c r="B1" t="s"><v>0</v></c><c r="C1" t="s"><v>9</v></c></row></sheetData></worksheet>`,
        `<sst ${MAIN}><si><r><t>po</t></r><r><t xml:space="preserve"> kawałku</t></r></si></sst>`,
      ),
    );

    // An index outside the table reads as empty instead of failing.
    expect(sheet.rows).toEqual([["w komórce", "po kawałku", ""]]);
  });

  it("reads a sheet without any rows", () => {
    const [sheet] = readWorkbook(rawWorkbook(`<worksheet ${MAIN}><sheetData/></worksheet>`));
    expect(sheet.rows).toEqual([]);
  });

  it("refuses a file that is not a zip archive", () => {
    expect(reasonOf(() => readWorkbook(strToU8("Data;Kwota\n2026-01-02;5")))).toBe("notWorkbook");
  });

  it("refuses a zip archive that is not a workbook", () => {
    expect(reasonOf(() => readWorkbook(zipSync({ "notes.txt": strToU8("hello") })))).toBe(
      "notWorkbook",
    );
  });
});

describe("cellNumber", () => {
  it("reads plain and scientific notation exactly", () => {
    expect(cellNumber("18.25")?.toFixed()).toBe("18.25");
    expect(cellNumber("-7.5")?.toFixed()).toBe("-7.5");
    expect(cellNumber(" 12 ")?.toFixed()).toBe("12");
    expect(cellNumber("2.5E-12")?.isZero()).toBe(false);
  });

  it("rejects text", () => {
    expect(cellNumber("")).toBeNull();
    expect(cellNumber("12 zł")).toBeNull();
    expect(cellNumber("1,5")).toBeNull();
  });
});

describe("serialToDate", () => {
  it("turns a spreadsheet day number into a moment in time", () => {
    expect(serialToDate(new Decimal(25569)).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(serialToDate(new Decimal("46034.5")).toISOString()).toBe("2026-01-12T12:00:00.000Z");
  });
});
