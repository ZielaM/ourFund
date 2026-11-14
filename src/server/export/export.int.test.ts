import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/server/auth/sessions";
import { disconnectDb, getDb } from "@/server/db/client";
import { resetDatabase } from "@/test/db";
import { createTestUser } from "@/test/fixtures";
import { downloadHeaders, exportFileName } from "./download";
import {
  exportData,
  exportTransactionsCsv,
  EXPORT_VERSION,
  type TransactionCsvLabels,
} from "./export";

const db = getDb();
const now = new Date("2026-11-13T12:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

let ania: SessionUser;
let bartek: SessionUser;
let xtb: string;
let ike: string;
let cdr: string;
let wig: string;
let edo: string;

const labels: TransactionCsvLabels = {
  columns: {
    date: "Data",
    portfolio: "Portfel",
    account: "Rachunek",
    type: "Typ",
    symbol: "Symbol",
    market: "Rynek",
    name: "Nazwa",
    quantity: "Liczba",
    price: "Cena",
    currency: "Waluta",
    fxRate: "Kurs",
    amount: "Kwota",
    fee: "Prowizja",
    tax: "Podatek",
    splitRatio: "Split",
    note: "Notatka",
  },
  types: { BUY: "Kupno", DEPOSIT: "Wpłata", DIVIDEND: "Dywidenda" },
};

const lines = (csv: string) => csv.replace("﻿", "").trimEnd().split("\r\n");

beforeEach(async () => {
  await resetDatabase(db);
  ania = await createTestUser(db, "ania");
  bartek = await createTestUser(db, "bartek");

  cdr = (
    await db.instrument.create({
      data: { symbol: "CDR", market: "GPW", name: "CD Projekt", type: "STOCK", currency: "PLN" },
    })
  ).id;
  wig = (
    await db.instrument.create({
      data: {
        symbol: "ETFBW20TR",
        market: "GPW",
        name: "Beta ETF WIG20TR",
        type: "ETF",
        currency: "PLN",
        quoteSymbol: "ETFBW20TR.WA",
      },
    })
  ).id;
  edo = (
    await db.instrument.create({
      data: {
        symbol: "EDO1135",
        market: "SKARB",
        name: "Obligacje 10-letnie EDO1135",
        type: "BOND",
        currency: "PLN",
        priceSource: "TREASURY",
        bondSeries: {
          create: {
            kind: "EDO",
            firstRate: "5.35",
            margin: "2",
            rates: { create: [{ period: 2, rate: "4.5" }] },
          },
        },
      },
    })
  ).id;
  // An instrument nobody of interest uses must not leak into an export.
  await db.instrument.create({
    data: { symbol: "AAPL", market: "NASDAQ", name: "Apple", type: "STOCK", currency: "USD" },
  });

  const main = await db.portfolio.create({
    data: { userId: ania.id, name: "Główny", benchmarkInstrumentId: wig },
  });
  const other = await db.portfolio.create({ data: { userId: ania.id, name: "Emerytalny" } });
  xtb = (
    await db.account.create({ data: { portfolioId: main.id, name: "XTB", institution: "XTB" } })
  ).id;
  ike = (await db.account.create({ data: { portfolioId: other.id, name: "IKE", type: "IKE" } })).id;

  await db.transaction.createMany({
    data: [
      { accountId: xtb, type: "DEPOSIT", date: day("2026-01-02"), amount: "5000", currency: "PLN" },
      {
        accountId: xtb,
        type: "BUY",
        date: day("2026-01-12"),
        instrumentId: cdr,
        quantity: "10",
        price: "100.5",
        fee: "5",
        currency: "PLN",
        note: "=SUM(A1:A9); pierwszy zakup",
      },
      {
        accountId: ike,
        type: "BUY",
        date: day("2026-01-05"),
        instrumentId: edo,
        quantity: "3",
        price: "100",
        currency: "PLN",
      },
    ],
  });
  await db.price.createMany({
    data: [
      { instrumentId: cdr, date: day("2026-02-02"), close: "123.45", source: "MANUAL" },
      { instrumentId: cdr, date: day("2026-02-03"), close: "200", source: "YAHOO" },
    ],
  });

  const foreign = await db.portfolio.create({ data: { userId: bartek.id, name: "Cudzy" } });
  const account = await db.account.create({ data: { portfolioId: foreign.id, name: "Tajny" } });
  await db.transaction.create({
    data: {
      accountId: account.id,
      type: "DEPOSIT",
      date: day("2026-03-03"),
      amount: "999",
      currency: "PLN",
    },
  });
});

afterAll(async () => {
  await disconnectDb();
});

describe("exportData", () => {
  it("contains the user's portfolios, accounts and transactions without database ids", async () => {
    const document = await exportData(db, ania, now);

    expect(document.app).toBe("ourFund");
    expect(document.version).toBe(EXPORT_VERSION);
    expect(document.exportedAt).toBe("2026-11-13T12:00:00.000Z");
    expect(document.username).toBe("ania");
    expect(document.portfolios.map((portfolio) => portfolio.name)).toEqual([
      "Główny",
      "Emerytalny",
    ]);

    const [main, other] = document.portfolios;
    expect(main.benchmark).toEqual({ symbol: "ETFBW20TR", market: "GPW" });
    expect(other.benchmark).toBeNull();
    expect(main.accounts).toHaveLength(1);
    expect(main.accounts[0]).toMatchObject({ name: "XTB", type: "STANDARD", institution: "XTB" });
    expect(main.accounts[0].transactions).toEqual([
      {
        date: "2026-01-02",
        type: "DEPOSIT",
        instrument: null,
        quantity: null,
        price: null,
        currency: "PLN",
        fxRate: "1",
        amount: "5000",
        fee: "0",
        tax: "0",
        splitRatio: null,
        note: null,
      },
      {
        date: "2026-01-12",
        type: "BUY",
        instrument: { symbol: "CDR", market: "GPW" },
        quantity: "10",
        price: "100.5",
        currency: "PLN",
        fxRate: "1",
        amount: null,
        fee: "5",
        tax: "0",
        splitRatio: null,
        note: "=SUM(A1:A9); pierwszy zakup",
      },
    ]);
    expect(other.accounts[0].type).toBe("IKE");
    expect(JSON.stringify(document)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("describes the instruments in use, with bond terms and prices entered by hand", async () => {
    const { instruments } = await exportData(db, ania, now);

    expect(instruments.map((instrument) => instrument.symbol)).toEqual([
      "CDR",
      "EDO1135",
      "ETFBW20TR",
    ]);

    const [stock, bond, benchmark] = instruments;
    expect(stock).toMatchObject({ market: "GPW", type: "STOCK", currency: "PLN", bond: null });
    // Downloaded quotes are not the user's data.
    expect(stock.manualPrices).toEqual([{ date: "2026-02-02", close: "123.45" }]);
    expect(bond.bond).toEqual({
      kind: "EDO",
      firstRate: "5.35",
      margin: "2",
      rates: [{ period: 2, rate: "4.5" }],
    });
    expect(bond.priceSource).toBe("TREASURY");
    expect(benchmark.quoteSymbol).toBe("ETFBW20TR.WA");
  });

  it("never contains another user's data", async () => {
    const mine = JSON.stringify(await exportData(db, ania, now));
    expect(mine).not.toContain("Cudzy");
    expect(mine).not.toContain("Tajny");
    expect(mine).not.toContain("999");

    const theirs = await exportData(db, bartek, now);
    expect(theirs.portfolios.map((portfolio) => portfolio.name)).toEqual(["Cudzy"]);
    expect(theirs.instruments).toEqual([]);
  });

  it("is an empty document for a user without portfolios", async () => {
    const carl = await createTestUser(db, "carl");
    const document = await exportData(db, carl, now);

    expect(document.portfolios).toEqual([]);
    expect(document.instruments).toEqual([]);
  });
});

describe("exportTransactionsCsv", () => {
  it("lists all transactions of all portfolios, oldest first", async () => {
    const [header, ...rows] = lines(await exportTransactionsCsv(db, ania, labels));

    expect(header).toBe(
      "Data;Portfel;Rachunek;Typ;Symbol;Rynek;Nazwa;Liczba;Cena;Waluta;Kurs;Kwota;Prowizja;Podatek;Split;Notatka",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe("2026-01-02;Główny;XTB;Wpłata;;;;;;PLN;1;5000;0;0;;");
    expect(rows[1]).toBe(
      "2026-01-05;Emerytalny;IKE;Kupno;EDO1135;SKARB;Obligacje 10-letnie EDO1135;3;100;PLN;1;;0;0;;",
    );
  });

  it("writes decimal commas and defuses notes that look like formulas", async () => {
    const rows = lines(await exportTransactionsCsv(db, ania, labels));

    expect(rows[3]).toBe(
      '2026-01-12;Główny;XTB;Kupno;CDR;GPW;CD Projekt;10;100,5;PLN;1;;5;0;;"\'=SUM(A1:A9); pierwszy zakup"',
    );
  });

  it("falls back to the type's code when it has no display name", async () => {
    const csv = await exportTransactionsCsv(db, ania, { ...labels, types: {} });
    expect(lines(csv)[1]).toContain(";DEPOSIT;");
  });

  it("never contains another user's transactions", async () => {
    expect(await exportTransactionsCsv(db, ania, labels)).not.toContain("Tajny");

    const theirs = lines(await exportTransactionsCsv(db, bartek, labels));
    expect(theirs).toHaveLength(2);
    expect(theirs[1]).toContain("Cudzy;Tajny");
  });
});

describe("download helpers", () => {
  it("names the file after the app, its contents and the day in Poland", () => {
    expect(exportFileName("transakcje", "csv", new Date("2026-11-13T23:30:00Z"))).toBe(
      "ourfund-transakcje-2026-11-14.csv",
    );
  });

  it("makes the browser save the response and never cache it", () => {
    expect(downloadHeaders("plik.csv", "text/csv; charset=utf-8")).toEqual({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plik.csv"',
      "Cache-Control": "no-store",
    });
  });
});
