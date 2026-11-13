import { expect, test, type Page } from "@playwright/test";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
// Prices come from the fixture provider (MARKET_DATA=fixture): 100 for unknown symbols,
// and symbols starting with "MISSING" are never found.
test.describe.configure({ mode: "serial" });

const row = (page: Page, symbol: string) =>
  page
    .getByRole("table", { name: "Lista instrumentów" })
    .getByRole("row", { name: new RegExp(symbol) });

async function openInstrument(page: Page, symbol: string) {
  await page.goto("/instruments");
  await page.getByRole("link", { name: `Szczegóły instrumentu ${symbol}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: symbol })).toBeVisible();
}

test("nowy instrument nie ma kursu, dopóki nie ma na nim transakcji", async ({ page }) => {
  await page.goto("/instruments");
  for (const [symbol, name] of [
    ["KGH", "KGHM"],
    ["OBL", "Obligacja firmowa"],
  ]) {
    await field(page, "Symbol").fill(symbol);
    await field(page, "Nazwa").fill(name);
    await page.getByRole("button", { name: "Dodaj instrument" }).click();
    await expect(page.getByText(`Instrument ${symbol} został dodany.`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText("Notowania zostały odświeżone.")).toBeVisible();
  await expect(page.getByText(/Ostatnie odświeżenie:/)).toBeVisible();

  // Only instruments that appear in a transaction are fetched.
  await expect(row(page, "KGH")).toContainText("brak");
});

test("po zapisaniu transakcji odświeżenie pobiera kurs", async ({ page }) => {
  await page.goto("/");
  await field(page, "Nazwa portfela").fill("Notowania");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await field(page, "Nazwa rachunku").fill("Maklerski");
  await page.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek Maklerski został dodany.")).toBeVisible();
  await page.getByRole("link", { name: "Wróć do portfela" }).click();

  for (const instrument of ["KGH (KGHM)", "OBL (Obligacja firmowa)"]) {
    await page.getByRole("link", { name: "Dodaj transakcję" }).click();
    await field(page, "Data").fill("2026-11-03");
    await field(page, "Instrument").selectOption({ label: instrument });
    await field(page, "Liczba").fill("10");
    await field(page, /Cena za sztukę/).fill("90");
    await page.getByRole("button", { name: "Dodaj transakcję" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Notowania" })).toBeVisible();
  }

  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText("Notowania zostały odświeżone.")).toBeVisible();

  await expect(row(page, "KGH")).toContainText("100,00");
  await expect(row(page, "OBL")).toContainText("100,00");
});

test("kurs wpisany ręcznie ma pierwszeństwo i daje się usunąć", async ({ page }) => {
  await openInstrument(page, "KGH");
  await expect(page.getByText("Puste pole oznacza symbol domyślny: KGH.WA.")).toBeVisible();

  const prices = page.getByRole("table", { name: "Ostatnie notowania instrumentu" });
  await expect(prices.getByRole("row").nth(1)).toContainText("Yahoo Finance");

  // A price needs a valid value and a date that is not in the future.
  await page.getByRole("button", { name: "Zapisz kurs" }).click();
  await expect(page.getByText("To pole jest wymagane.")).toBeVisible();
  await field(page, "Kurs (PLN)").fill("123,45");
  await field(page, "Data").fill("2999-01-01");
  await page.getByRole("button", { name: "Zapisz kurs" }).click();
  await expect(page.getByText("Data nie może być późniejsza niż dzisiejsza.")).toBeVisible();

  await field(page, "Data").fill("2026-11-04");
  await page.getByRole("button", { name: "Zapisz kurs" }).click();
  await expect(page.getByText("Kurs został zapisany.")).toBeVisible();

  const manual = prices.getByRole("row", { name: /04\.11\.2026/ });
  await expect(manual).toContainText("123,45 PLN");
  await expect(manual).toContainText("ręcznie");

  // Refreshing does not overwrite it.
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText("Notowania zostały odświeżone.")).toBeVisible();
  await openInstrument(page, "KGH");
  await expect(prices.getByRole("row", { name: /04\.11\.2026/ })).toContainText("123,45 PLN");

  await page.getByRole("button", { name: "Usuń kurs z dnia 04.11.2026" }).click();
  await expect(prices.getByRole("row", { name: /04\.11\.2026/ })).toHaveCount(0);
});

test("błędny symbol notowań jest zgłaszany po odświeżeniu", async ({ page }) => {
  await openInstrument(page, "OBL");

  await field(page, "Symbol w Yahoo Finance").fill("zły symbol");
  await page.getByRole("button", { name: "Zapisz źródło" }).click();
  await expect(page.getByText(/Symbol może zawierać litery, cyfry/)).toBeVisible();

  await field(page, "Symbol w Yahoo Finance").fill("missing.wa");
  await page.getByRole("button", { name: "Zapisz źródło" }).click();
  await expect(page.getByText("Źródło notowań zostało zapisane.")).toBeVisible();
  await expect(field(page, "Symbol w Yahoo Finance")).toHaveValue("MISSING.WA");

  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText(/części danych nie udało się pobrać/)).toBeVisible();
  await expect(
    page.getByText("OBL: nie znaleziono symbolu MISSING.WA w Yahoo Finance."),
  ).toBeVisible();
});

test("instrument z kursami wpisywanymi ręcznie nie jest pobierany", async ({ page }) => {
  await openInstrument(page, "OBL");
  await field(page, "Skąd brać kursy").selectOption({ label: "Wpisuję ręcznie" });
  await page.getByRole("button", { name: "Zapisz źródło" }).click();
  await expect(page.getByText("Źródło notowań zostało zapisane.")).toBeVisible();

  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText("Notowania zostały odświeżone.")).toBeVisible();
  await expect(page.getByText(/OBL: nie znaleziono symbolu/)).toHaveCount(0);
});

test("nieznany instrument daje stronę 404", async ({ page }) => {
  await page.goto("/instruments/00000000-0000-4000-8000-000000000000");

  await expect(page.getByRole("heading", { level: 1, name: "Nie ma takiej strony" })).toBeVisible();
});
