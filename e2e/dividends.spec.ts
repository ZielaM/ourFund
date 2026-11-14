import { expect, test, type Page } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

// The page adds up everything a person received, so the story has a user of its own:
// other test files record dividends in the administrator's portfolios.
const investor = { username: "dywidendowiec", password: "haslo-inwestora-123" };
let page: Page;
let portfolioUrl: string;

type Payment = {
  type: "Dywidenda" | "Odsetki";
  account: string;
  date: string;
  instrument?: string;
  amount: string;
  tax: string;
};

async function addPayment(payment: Payment) {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await field(page, "Typ transakcji").selectOption({ label: payment.type });
  await field(page, "Rachunek").selectOption({ label: payment.account });
  await field(page, "Data").fill(payment.date);
  if (payment.instrument) {
    await field(page, "Instrument").selectOption({ label: payment.instrument });
  }
  await field(page, /^Kwota/).fill(payment.amount);
  await field(page, "Podatek pobrany u źródła").fill(payment.tax);
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

test.beforeAll(async ({ browser }) => {
  page = await newVisitor(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

test("bez wypłat strona zachęca do zapisania pierwszej", async ({ page: adminPage }) => {
  await createUserAsAdmin(adminPage, investor);
  await signIn(page, investor.username, investor.password);
  await expect(
    page.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Dywidendy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dywidendy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nie ma jeszcze żadnej wypłaty" })).toBeVisible();
});

test("wypłaty z wszystkich rachunków sumują się po potrąceniu podatku", async () => {
  await page.goto("/");
  await field(page, "Nazwa portfela").fill("Dywidendowy");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dywidendowy" })).toBeVisible();
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

  await addInstrument("DIVPL", "Spółka dywidendowa");
  const company = "DIVPL (Spółka dywidendowa)";

  // 2026: 81 zł in March, 50 zł in March on the IKE account, 8,10 zł of interest in August.
  await addPayment({
    type: "Dywidenda",
    account: "Makler",
    date: "2026-03-10",
    instrument: company,
    amount: "100",
    tax: "19",
  });
  await addPayment({
    type: "Dywidenda",
    account: "Emerytura",
    date: "2026-03-20",
    instrument: company,
    amount: "50",
    tax: "0",
  });
  await addPayment({
    type: "Odsetki",
    account: "Makler",
    date: "2026-08-03",
    amount: "10",
    tax: "1,90",
  });
  // 2025: 40,50 zł.
  await addPayment({
    type: "Dywidenda",
    account: "Makler",
    date: "2025-06-02",
    instrument: company,
    amount: "50",
    tax: "9,50",
  });

  await page.goto("/dividends");
  await page.getByRole("link", { name: "Rok 2026" }).click();

  const summary = page.getByRole("region", { name: "Podsumowanie" });
  await expect(summary).toContainText("Otrzymane w 2026 roku");
  await expect(summary).toContainText(/139,10\szł/);
  await expect(summary).toContainText(/Od pierwszej wypłaty: 179,60\szł/);

  const sources = page.getByRole("table", { name: "Wypłaty w 2026 roku według instrumentów" });
  const company2026 = sources.getByRole("row", { name: /DIVPL/ });
  await expect(company2026.getByRole("cell").nth(1)).toHaveText("2");
  await expect(company2026.getByRole("cell").nth(2)).toHaveText(/^131,00\szł$/);
  await expect(sources.getByRole("row", { name: /Odsetki od gotówki/ })).toContainText(/8,10\szł/);

  const payments = page.getByRole("table", { name: "Wypłaty w 2026 roku", exact: true });
  await expect(payments.getByRole("row")).toHaveCount(4);
  const first = payments.getByRole("row").nth(1);
  await expect(first).toContainText("03.08.2026");
  await expect(first).toContainText("Odsetki od gotówki");
  await expect(payments.getByRole("row", { name: /20\.03\.2026/ })).toContainText("Emerytura");

  // The chart's data is also available as a table.
  const months = page.getByRole("region", { name: "Miesiąc po miesiącu" });
  await months.getByText("Pokaż dane w tabeli").click();
  await expect(months.getByRole("row", { name: /marzec/ })).toContainText(/131,00\szł/);
  await expect(months.getByRole("row", { name: /sierpień/ })).toContainText(/8,10\szł/);
  await expect(months.getByRole("row", { name: /styczeń/ })).toContainText(/0,00\szł/);

  const years = page.getByRole("table", { name: "Dywidendy i odsetki netto w kolejnych latach" });
  await expect(years.getByRole("row", { name: /2025/ })).toContainText(/40,50\szł/);
});

test("rok wybiera się z listy lat", async () => {
  await page.goto("/dividends");
  await page.getByRole("link", { name: "Rok 2025" }).click();

  const summary = page.getByRole("region", { name: "Podsumowanie" });
  await expect(summary).toContainText("Otrzymane w 2025 roku");
  await expect(summary).toContainText(/40,50\szł/);
  await expect(page.getByRole("table", { name: "Wypłaty w 2025 roku", exact: true })).toContainText(
    "02.06.2025",
  );
});

test("wypłata w obcej walucie jest przeliczana po kursie NBP", async () => {
  await addInstrument("DIVUS", "Spółka zagraniczna", "NASDAQ", "USD");
  await addPayment({
    type: "Dywidenda",
    account: "Makler",
    date: "2026-05-15",
    instrument: "DIVUS (Spółka zagraniczna)",
    amount: "100",
    tax: "15",
  });

  // The made-up NBP rate is 4 zł for a dollar on every working day.
  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText(/Notowania zostały odświeżone/)).toBeVisible();

  await page.goto("/dividends");
  await page.getByRole("link", { name: "Rok 2026" }).click();
  await expect(page.getByText(/Brakuje kursów NBP/)).toHaveCount(0);

  const payment = page
    .getByRole("table", { name: "Wypłaty w 2026 roku", exact: true })
    .getByRole("row", { name: /DIVUS/ });
  await expect(payment).toContainText(/100,00\sUSD/);
  await expect(payment).toContainText(/340,00\szł/);
  await expect(payment).toContainText(/85,00\sUSD/);
  await expect(page.getByRole("region", { name: "Podsumowanie" })).toContainText(/479,10\szł/);
});

test("strona pokazuje tylko własne wypłaty i wymaga zalogowania", async ({
  page: adminPage,
  browser,
}) => {
  await adminPage.goto("/dividends?year=2026");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Dywidendy" })).toBeVisible();
  await expect(adminPage.getByText("DIVPL")).toHaveCount(0);

  const visitor = await newVisitor(browser);
  await visitor.goto("/dividends");
  await expect(visitor).toHaveURL(/\/login/);
  await visitor.context().close();
});
