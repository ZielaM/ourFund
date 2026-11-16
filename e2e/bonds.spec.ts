import { expect, test, type Page } from "@playwright/test";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

/** A date `days` before today, in Polish time, as a date field expects it. */
function daysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(
    new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  );
}

// Bought 400 days ago, a yearly bond is always a few weeks into its second interest period.
const purchaseDate = daysAgo(400);
let portfolioUrl: string;

async function addSeries(page: Page, series: string, firstRate: string, margin = "") {
  await page.goto("/instruments");
  await field(page, "Seria", { exact: true }).fill(series);
  await field(page, "Oprocentowanie w pierwszym okresie (%)").fill(firstRate);
  await field(page, "Marża (%)").fill(margin);
  await page.getByRole("button", { name: "Dodaj serię" }).click();
}

async function openSeries(page: Page, series: string) {
  await page.goto("/instruments");
  await page.getByRole("link", { name: `Szczegóły instrumentu ${series}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: series })).toBeVisible();
}

async function buyBonds(page: Page, series: string, name: string, quantity: string) {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await field(page, "Data").fill(purchaseDate);
  await field(page, "Instrument").selectOption({ label: `${series} (${name})` });
  await expect(page.getByText("Obligacje skarbowe kupuje się po 100 zł za sztukę.")).toBeVisible();
  await field(page, "Liczba").fill(quantity);
  await field(page, /Cena za sztukę/).fill("100");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
}

test("serię obligacji dodaje się z jej warunkami emisji", async ({ page }) => {
  await addSeries(page, "ABC", "pięć");
  await expect(page.getByText(/Podaj symbol serii, na przykład EDO1135/)).toBeVisible();
  await expect(
    page.getByText("Podaj oprocentowanie w procentach, na przykład 5,35."),
  ).toBeVisible();

  await addSeries(page, "tos1128", "4,40");
  await expect(page.getByText("Seria TOS1128 została dodana.")).toBeVisible();
  const row = page
    .getByRole("table", { name: "Lista instrumentów" })
    .getByRole("row", { name: /TOS1128/ });
  await expect(row).toContainText("Obligacje 3-letnie TOS1128");
  await expect(row).toContainText("Obligacja");
  await expect(row).toContainText("Obligacje skarbowe");

  await addSeries(page, "TOS1128", "5");
  await expect(page.getByText("Ta seria jest już w katalogu.")).toBeVisible();

  await addSeries(page, "EDO1135", "5,35", "2");
  await expect(page.getByText("Seria EDO1135 została dodana.")).toBeVisible();
});

test("obligacja stałoprocentowa pokazuje warunki i nie wymaga wpisywania stóp", async ({
  page,
}) => {
  await openSeries(page, "TOS1128");

  await expect(page.getByRole("heading", { name: "Warunki emisji" })).toBeVisible();
  await expect(page.getByText("36 miesięcy")).toBeVisible();
  await expect(page.getByText("kapitalizowane co roku, wypłacane przy wykupie")).toBeVisible();
  await expect(page.getByText("4,40%")).toBeVisible();
  await expect(page.getByText("1,00 zł od sztuki (zakupy od 1 września 2024 r.)")).toBeVisible();
  await expect(
    page.getByText("Oprocentowanie jest stałe przez cały okres oszczędzania."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Zapisz oprocentowanie" })).toHaveCount(0);

  // Bonds have no quotes: neither a quote source nor prices entered by hand.
  await expect(page.getByRole("heading", { name: "Źródło notowań" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Kurs wpisany ręcznie" })).toHaveCount(0);
});

test("obligacje są wyceniane z narosłymi odsetkami od dnia zakupu", async ({ page }) => {
  await page.goto("/");
  await field(page, "Nazwa portfela").fill("Obligacje");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Obligacje" })).toBeVisible();
  portfolioUrl = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await field(page, "Nazwa rachunku").fill("PKO BP");
  await page.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek PKO BP został dodany.")).toBeVisible();

  await buyBonds(page, "TOS1128", "Obligacje 3-letnie TOS1128", "10");

  // After a full year at 4.40% a bond is worth 104.40; a few weeks later slightly more.
  const position = page
    .getByRole("table", { name: "Otwarte pozycje" })
    .getByRole("row", { name: /TOS1128/ });
  await expect(position.getByRole("cell").nth(1)).toHaveText("10");
  await expect(position.getByRole("cell").nth(3)).toHaveText(/^1\s04\d,\d\d\szł$/);
  await expect(position.getByRole("cell").nth(4)).toContainText("1 000,00 zł");
  await expect(position.getByRole("cell").nth(5)).toContainText(/\+4\d,\d\d\szł/);

  // A fixed-rate bond is never an estimate and needs no quotes.
  await expect(position).not.toContainText("szacunek");
  await expect(page.getByText(/Bez notowań rynkowych/)).toHaveCount(0);
  await expect(page.getByText(/Bez wpisanego oprocentowania/)).toHaveCount(0);
  // The whole portfolio is bonds.
  const structure = page.getByRole("region", { name: "Struktura portfela" });
  await expect(structure.getByRole("heading", { name: "Klasy aktywów" })).toBeVisible();
  await expect(structure).toContainText("Obligacje");
  await expect(structure).toContainText("100,0%");
});

test("obligacja indeksowana jest szacunkiem, dopóki nie ma oprocentowania bieżącego okresu", async ({
  page,
}) => {
  await buyBonds(page, "EDO1135", "Obligacje 10-letnie EDO1135", "5");

  const position = page
    .getByRole("table", { name: "Otwarte pozycje" })
    .getByRole("row", { name: /EDO1135/ });
  await expect(position).toContainText("szacunek");
  await expect(
    page.getByText("Bez wpisanego oprocentowania bieżącego okresu: EDO1135."),
  ).toBeVisible();

  // Entering the rate announced for the second year makes the valuation exact.
  await openSeries(page, "EDO1135");
  await expect(page.getByText(/inflacja ogłoszona przez GUS plus marża/)).toBeVisible();
  await expect(
    page.getByText("Oprocentowanie kolejnych okresów nie jest jeszcze znane."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Zapisz oprocentowanie" }).click();
  await expect(page.getByText("To pole jest wymagane.")).toBeVisible();

  await field(page, "Oprocentowanie (%)").fill("4,5");
  await page.getByRole("button", { name: "Zapisz oprocentowanie" }).click();
  await expect(page.getByText("Oprocentowanie zostało zapisane.")).toBeVisible();
  const rates = page.getByRole("table", { name: "Oprocentowanie kolejnych okresów" });
  await expect(rates.getByRole("row", { name: /Okres 2/ })).toContainText("4,50%");

  await page.goto(portfolioUrl);
  await expect(position).not.toContainText("szacunek");
  await expect(page.getByText(/Bez wpisanego oprocentowania/)).toHaveCount(0);
  // 5 bonds worth 105.35 after the first year, plus a few weeks of the second.
  await expect(position.getByRole("cell").nth(3)).toHaveText(/^52\d,\d\d\szł$/);

  // Removing the rate brings the estimate back.
  await openSeries(page, "EDO1135");
  await page.getByRole("button", { name: "Usuń oprocentowanie okresu 2" }).click();
  await expect(
    page.getByText("Oprocentowanie kolejnych okresów nie jest jeszcze znane."),
  ).toBeVisible();
  await page.goto(portfolioUrl);
  await expect(position).toContainText("szacunek");
});
