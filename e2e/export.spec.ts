import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

// An export contains everything a person entered, so the story has a user of its own.
const owner = { username: "archiwista", password: "haslo-archiwisty-123" };
let page: Page;

async function download(linkName: string): Promise<{ fileName: string; content: string }> {
  await page.goto("/settings");
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: linkName }).click(),
  ]);
  return {
    fileName: file.suggestedFilename(),
    content: await readFile(await file.path(), "utf8"),
  };
}

test.beforeAll(async ({ browser }) => {
  page = await newVisitor(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

test("transakcje pobiera się jako plik CSV dla arkusza kalkulacyjnego", async ({
  page: adminPage,
}) => {
  await createUserAsAdmin(adminPage, owner);
  await signIn(page, owner.username, owner.password);
  await expect(
    page.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();

  await field(page, "Nazwa portfela").fill("Archiwum");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Archiwum" })).toBeVisible();
  const portfolioUrl = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await field(page, "Nazwa rachunku").fill("Makler");
  await page.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek Makler został dodany.")).toBeVisible();

  await page.goto("/instruments");
  await field(page, "Symbol").fill("EXPPL");
  await field(page, "Nazwa").fill("Spółka eksportowa");
  await page.getByRole("button", { name: "Dodaj instrument" }).click();
  await expect(page.getByText("Instrument EXPPL został dodany.")).toBeVisible();

  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await field(page, "Typ transakcji").selectOption({ label: "Kupno" });
  await field(page, "Data").fill("2026-01-12");
  await field(page, "Instrument").selectOption({ label: "EXPPL (Spółka eksportowa)" });
  await field(page, "Liczba").fill("10");
  await field(page, /Cena za sztukę/).fill("100,50");
  await field(page, /Prowizja/).fill("5");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);

  const { fileName, content } = await download("Pobierz transakcje (CSV)");

  expect(fileName).toMatch(/^ourfund-transakcje-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = content.replace("﻿", "").trimEnd().split("\r\n");
  expect(lines[0]).toBe(
    "Data;Portfel;Rachunek;Typ;Symbol;Rynek;Nazwa;Liczba;Cena;Waluta rozliczenia;Kurs waluty;Kwota;Prowizja;Podatek u źródła;Stosunek splitu;Notatka",
  );
  expect(lines[1]).toBe(
    "2026-01-12;Archiwum;Makler;Kupno;EXPPL;GPW;Spółka eksportowa;10;100,5;PLN;1;;5;0;;",
  );
  expect(lines).toHaveLength(2);
});

test("pełną kopię danych pobiera się jako plik JSON", async () => {
  const { fileName, content } = await download("Pobierz pełną kopię (JSON)");

  expect(fileName).toMatch(/^ourfund-dane-\d{4}-\d{2}-\d{2}\.json$/);
  const document = JSON.parse(content);
  expect(document.app).toBe("ourFund");
  expect(document.username).toBe(owner.username);
  expect(document.portfolios).toHaveLength(1);
  expect(document.portfolios[0].name).toBe("Archiwum");
  expect(document.portfolios[0].accounts[0].transactions[0]).toMatchObject({
    date: "2026-01-12",
    type: "BUY",
    instrument: { symbol: "EXPPL", market: "GPW" },
    quantity: "10",
    price: "100.5",
    fee: "5",
  });
  expect(document.instruments.map((instrument: { symbol: string }) => instrument.symbol)).toEqual([
    "EXPPL",
  ]);
});

test("eksport wymaga zalogowania", async ({ browser }) => {
  const visitor = await newVisitor(browser);

  for (const path of ["/api/export/transactions", "/api/export/data"]) {
    const response = await visitor.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toContain("/login");
  }

  // A cookie that is not a session gets past the redirect but not past the check.
  await visitor
    .context()
    .addCookies([
      { name: "ourfund_session", value: "not-a-session", url: "http://localhost:3100" },
    ]);
  for (const path of ["/api/export/transactions", "/api/export/data"]) {
    const response = await visitor.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(401);
    expect(await response.text(), path).toBe("");
  }

  await visitor.context().close();
});
