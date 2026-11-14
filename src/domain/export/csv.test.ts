import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/decimal";
import { csvNumber, csvText, toCsv } from "./csv";

describe("csvText", () => {
  it("leaves ordinary text alone", () => {
    expect(csvText("CD Projekt")).toBe("CD Projekt");
    expect(csvText(null)).toBe("");
    expect(csvText("")).toBe("");
  });

  it("defuses text that a spreadsheet would run as a formula", () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")');
    expect(csvText("+48 123")).toBe("'+48 123");
    expect(csvText("-zysk")).toBe("'-zysk");
    expect(csvText("@import")).toBe("'@import");
  });
});

describe("csvNumber", () => {
  it("writes a decimal comma and no trailing zeros or grouping", () => {
    expect(csvNumber(new Decimal("1234.5000"))).toBe("1234,5");
    expect(csvNumber(new Decimal("-80"))).toBe("-80");
    expect(csvNumber(new Decimal("0.00000001"))).toBe("0,00000001");
    expect(csvNumber(null)).toBe("");
  });
});

describe("toCsv", () => {
  it("separates cells with semicolons and lines with CRLF, after a byte order mark", () => {
    expect(toCsv(["Data", "Kwota"], [["2026-01-02", "10,5"]])).toBe(
      "﻿Data;Kwota\r\n2026-01-02;10,5\r\n",
    );
  });

  it("quotes cells that contain a separator, a quote or a line break", () => {
    const csv = toCsv(["Notatka"], [["a;b"], ['mówi "tak"'], ["dwie\nlinie"]]);
    expect(csv).toBe('﻿Notatka\r\n"a;b"\r\n"mówi ""tak"""\r\n"dwie\nlinie"\r\n');
  });

  it("writes the header alone when there are no rows", () => {
    expect(toCsv(["Data"], [])).toBe("﻿Data\r\n");
  });
});
