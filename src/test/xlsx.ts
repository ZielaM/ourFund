import { strToU8, zipSync } from "fflate";

export type TestCell = string | number | null;
export type TestSheet = { name: string; rows: TestCell[][] };

const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * Builds a minimal .xlsx file the way spreadsheet programs write one: strings go to the
 * shared strings table, numbers are stored as numbers, empty cells are left out.
 */
export function buildWorkbook(sheets: readonly TestSheet[]): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (text: string) => {
    const existing = strings.indexOf(text);
    return existing >= 0 ? existing : strings.push(text) - 1;
  };

  const sheetXml = (sheet: TestSheet) => {
    const rows = sheet.rows
      .map((cells, rowIndex) => {
        const body = cells
          .map((cell, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
            if (cell === null) {
              return "";
            }
            return typeof cell === "number"
              ? `<c r="${reference}"><v>${cell}</v></c>`
              : `<c r="${reference}" t="s"><v>${stringIndex(cell)}</v></c>`;
          })
          .join("");
        return body ? `<row r="${rowIndex + 1}">${body}</row>` : "";
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  };

  const parts: Record<string, Uint8Array> = {};
  sheets.forEach((sheet, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet));
  });

  parts["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  parts["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  parts["xl/sharedStrings.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
      .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
      .join("")}</sst>`,
  );

  return zipSync(parts);
}
