import { expect, test, type Locator, type Page } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

// A return covers everything a person owns, so the story has a user of its own:
// other test files add transactions to the administrator's portfolios.
const taxpayer = { username: "podatnik", password: "haslo-podatnika-123" };
let page: Page;
let portfolioUrl: string;

type TransactionFields = {
  type: string;
  account: string;
  date: string;
  instrument: string;
  quantity?: string;
  price?: string;
  fee?: string;
  amount?: string;
  tax?: string;
};

async function addTransaction(fields: TransactionFields) {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await field(page, "Typ transakcji").selectOption({ label: fields.type });
  await field(page, "Rachunek").selectOption({ label: fields.account });
  await field(page, "Data").fill(fields.date);
  await field(page, "Instrument").selectOption({ label: fields.instrument });
  if (fields.quantity !== undefined) {
    await field(page, "Liczba").fill(fields.quantity);
  }
  if (fields.price !== undefined) {
    await field(page, /Cena za sztukę/).fill(fields.price);
  }
  if (fields.fee !== undefined) {
    await field(page, /Prowizja/).fill(fields.fee);
  }
  if (fields.amount !== undefined) {
    await field(page, /^Kwota/).fill(fields.amount);
  }
  if (fields.tax !== undefined) {
    await field(page, "Podatek pobrany u źródła").fill(fields.tax);
  }
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
}

async function addInstrument(symbol: string, name: string, market?: string, currency?: string) {
  await page.goto("/instruments");
  await field(page, "Symbol").fill(symbol);
  await field(page, "Nazwa").fill(name);
  if (market) {
    await field(page, "Rynek").selectOption({ label: market });
  }
  if (currency) {
    await field(page, "Waluta notowań").selectOption(currency);
  }
  await page.getByRole("button", { name: "Dodaj instrument" }).click();
  await expect(page.getByText(`Instrument ${symbol} został dodany.`)).toBeVisible();
}

/** The amount next to a label in one of the report's columns of figures. */
function figure(section: Locator, label: string): Locator {
  return section.locator("dl > div").filter({ hasText: label }).locator("dd");
}

const section = (name: string) => page.getByRole("region", { name });

test.beforeAll(async ({ browser }) => {
  page = await newVisitor(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

test("bez transakcji nie ma czego rozliczać", async ({ page: adminPage }) => {
  await createUserAsAdmin(adminPage, taxpayer);
  await signIn(page, taxpayer.username, taxpayer.password);
  await expect(
    page.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Podatki" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Podatki" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nie ma jeszcze czego rozliczać" })).toBeVisible();
});

test("zestawienie liczy sprzedaż metodą FIFO i pomija IKE", async () => {
  await page.goto("/");
  await field(page, "Nazwa portfela").fill("Podatkowy");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Podatkowy" })).toBeVisible();
  portfolioUrl = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  const newAccount = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Dodaj rachunek" }) });
  await field(newAccount, "Nazwa rachunku").fill("Makler");
  await newAccount.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek Makler został dodany.")).toBeVisible();
  await field(newAccount, "Nazwa rachunku").fill("Emerytura");
  await field(newAccount, "Typ rachunku").selectOption({ label: "IKE" });
  await newAccount.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek Emerytura został dodany.")).toBeVisible();

  await addInstrument("TAXPL", "Spółka krajowa");
  const domestic = "TAXPL (Spółka krajowa)";

  // 2025: a loss of 100 zł. 2026: 1 500 zł of revenue against 1 000 + 5 + 7 zł of costs.
  await addTransaction({
    type: "Kupno",
    account: "Makler",
    date: "2025-03-03",
    instrument: domestic,
    quantity: "5",
    price: "100",
  });
  await addTransaction({
    type: "Sprzedaż",
    account: "Makler",
    date: "2025-09-01",
    instrument: domestic,
    quantity: "5",
    price: "80",
  });
  await addTransaction({
    type: "Kupno",
    account: "Makler",
    date: "2026-01-12",
    instrument: domestic,
    quantity: "10",
    price: "100",
    fee: "5",
  });
  await addTransaction({
    type: "Sprzedaż",
    account: "Makler",
    date: "2026-06-10",
    instrument: domestic,
    quantity: "10",
    price: "150",
    fee: "7",
  });
  // A much larger gain on the IKE account must not show up anywhere.
  await addTransaction({
    type: "Kupno",
    account: "Emerytura",
    date: "2026-01-12",
    instrument: domestic,
    quantity: "10",
    price: "100",
  });
  await addTransaction({
    type: "Sprzedaż",
    account: "Emerytura",
    date: "2026-06-10",
    instrument: domestic,
    quantity: "10",
    price: "900",
  });

  await page.goto("/taxes");
  await page.getByRole("link", { name: "Rok 2026" }).click();
  await expect(
    page.getByRole("heading", { name: "Zestawienie do PIT-38 za 2026 rok" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Rok 2026" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const securities = section("Sprzedaż papierów wartościowych");
  await expect(figure(securities, "Przychód")).toHaveText(/^1\s500,00\szł$/);
  await expect(figure(securities, "Koszty uzyskania przychodu")).toHaveText(/^1\s012,00\szł$/);
  await expect(figure(securities, "Dochód")).toHaveText(/^488,00\szł$/);
  // The loss of 100 zł made in 2025 is deducted first; 19% of 388 zł, rounded to full złoty.
  await expect(figure(securities, "Strata z lat ubiegłych")).toHaveText(/^100,00\szł$/);
  await expect(figure(securities, "Podstawa opodatkowania")).toHaveText(/^388,00\szł$/);
  await expect(figure(securities, "Podatek 19%")).toHaveText(/^74,00\szł$/);
  await expect(securities.getByText(/100,00\szł ze straty z 2025 r\./)).toBeVisible();

  const sales = page.getByRole("table", { name: "Sprzedaże papierów wartościowych w 2026 roku" });
  await expect(sales.getByRole("row")).toHaveCount(2);
  const sale = sales.getByRole("row", { name: /TAXPL/ });
  await expect(sale).toContainText("10.06.2026");
  await expect(sale).toContainText("kupione od 12.01.2026");
  await expect(sale).toContainText("Makler");
  await expect(sale).toContainText(/\+488,00\szł/);

  const earlier = page.getByRole("table", {
    name: "Wynik ze sprzedaży papierów wartościowych w poprzednich latach",
  });
  await expect(earlier.getByRole("row", { name: /2025/ })).toContainText(/-100,00\szł/);

  const outside = section("Poza zeznaniem");
  await expect(outside).toContainText("Emerytura (IKE, portfel Podatkowy)");
});

test("rok podatkowy wybiera się z listy lat", async () => {
  await page.goto("/taxes");
  await page.getByRole("link", { name: "Rok 2025" }).click();
  await expect(
    page.getByRole("heading", { name: "Zestawienie do PIT-38 za 2025 rok" }),
  ).toBeVisible();

  const securities = section("Sprzedaż papierów wartościowych");
  await expect(figure(securities, "Strata")).toHaveText(/^100,00\szł$/);
  await expect(figure(securities, "Podatek 19%")).toHaveText(/^0,00\szł$/);
  await expect(
    securities.getByText(/zostaje: 100,00\szł z 2025 r\. \(najpóźniej w zeznaniu za 2030 r\.\)/),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wyniki z poprzednich lat" })).toHaveCount(0);
});

test("zagraniczna dywidenda jest przeliczana po kursie NBP i dopłacana do 19%", async () => {
  await addInstrument("TAXUS", "Spółka zagraniczna", "NASDAQ", "USD");
  await addTransaction({
    type: "Dywidenda",
    account: "Makler",
    date: "2026-05-15",
    instrument: "TAXUS (Spółka zagraniczna)",
    amount: "100",
    tax: "15",
  });

  // The made-up NBP rate is 4 zł for a dollar on every working day.
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText(/Notowania zostały odświeżone/)).toBeVisible();

  await page.goto("/taxes");
  await page.getByRole("link", { name: "Rok 2026" }).click();
  await expect(page.getByText(/Brakuje kursów NBP/)).toHaveCount(0);

  const foreign = section("Dywidendy i odsetki z zagranicy");
  await expect(figure(foreign, "Przychód brutto")).toHaveText(/^400,00\szł$/);
  await expect(figure(foreign, "Podatek 19%")).toHaveText(/^76,00\szł$/);
  await expect(figure(foreign, "Podatek pobrany za granicą")).toHaveText(/^60,00\szł$/);
  await expect(figure(foreign, "Do zapłaty")).toHaveText(/^16,00\szł$/);

  const payments = page.getByRole("table", { name: "Dywidendy i odsetki z zagranicy w 2026 roku" });
  const payment = payments.getByRole("row", { name: /TAXUS/ });
  await expect(payment).toContainText(/100,00\sUSD/);
  await expect(payment).toContainText("4,00");
  // The rate of the working day before the payment.
  await expect(payment).toContainText("z 14.05.2026");

  // The sale of securities is settled separately and did not change.
  await expect(figure(section("Sprzedaż papierów wartościowych"), "Podatek 19%")).toHaveText(
    /^74,00\szł$/,
  );
});

test("zestawienie pokazuje tylko własne transakcje", async ({ page: adminPage }) => {
  await adminPage.goto("/taxes?year=2026");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Podatki" })).toBeVisible();
  await expect(adminPage.getByText("TAXPL")).toHaveCount(0);
  await expect(adminPage.getByText("TAXUS")).toHaveCount(0);
});

test("zestawienie wymaga zalogowania", async ({ browser }) => {
  const visitor = await newVisitor(browser);
  await visitor.goto("/taxes");
  await expect(visitor).toHaveURL(/\/login/);
  await visitor.context().close();
});
