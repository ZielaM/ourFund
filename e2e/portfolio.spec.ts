import { expect, test, type Page } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

let portfolioUrl: string;

type TransactionFields = {
  type: string;
  account?: string;
  date: string;
  instrument?: string;
  quantity?: string;
  price?: string;
  fee?: string;
  amount?: string;
  tax?: string;
  currency?: string;
};

async function fillTransaction(page: Page, fields: TransactionFields) {
  await field(page, "Typ transakcji").selectOption({ label: fields.type });
  if (fields.account) {
    await field(page, "Rachunek").selectOption({ label: fields.account });
  }
  await field(page, "Data").fill(fields.date);
  if (fields.instrument) {
    await field(page, "Instrument").selectOption({ label: fields.instrument });
  }
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
  if (fields.currency) {
    await field(page, "Waluta", { exact: true }).selectOption(fields.currency);
  }
}

async function addTransaction(page: Page, fields: TransactionFields) {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await fillTransaction(page, fields);
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
}

const holdingsTable = (page: Page) => page.getByRole("table", { name: "Otwarte pozycje" });
const cdr = "CDR (CD Projekt)";

test("pusty pulpit zaprasza do utworzenia portfela", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByText("To pole jest wymagane.")).toBeVisible();

  await field(page, "Nazwa portfela").fill("Główny");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Główny" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dodaj pierwszy rachunek" })).toBeVisible();
  portfolioUrl = new URL(page.url()).pathname;
});

test("nazwa portfela nie może się powtarzać", async ({ page }) => {
  await page.goto("/");
  await field(page, "Nazwa portfela").fill("Główny");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();

  await expect(page.getByText("Masz już portfel o tej nazwie.")).toBeVisible();
  await expect(field(page, "Nazwa portfela")).toHaveValue("Główny");
});

test("rachunki dodaje się w ustawieniach portfela", async ({ page }) => {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ustawienia portfela" })).toBeVisible();

  const newAccount = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Dodaj rachunek" }) });
  await field(newAccount, "Nazwa rachunku").fill("XTB");
  await field(newAccount, "Instytucja").fill("XTB");
  await newAccount.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek XTB został dodany.")).toBeVisible();

  await field(newAccount, "Nazwa rachunku").fill("IKE");
  await field(newAccount, "Typ rachunku").selectOption({ label: "IKE" });
  await newAccount.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek IKE został dodany.")).toBeVisible();

  await field(newAccount, "Nazwa rachunku").fill("XTB");
  await newAccount.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("W tym portfelu jest już rachunek o tej nazwie.")).toBeVisible();

  await page.getByRole("link", { name: "Wróć do portfela" }).click();
  await expect(page.getByText("Brak otwartych pozycji.")).toBeVisible();
  await expect(page.getByText("Brak transakcji.")).toBeVisible();
});

test("instrumenty trafiają do wspólnego katalogu", async ({ page }) => {
  await page.goto("/instruments");
  await expect(page.getByText("Katalog jest pusty.")).toBeVisible();

  await field(page, "Symbol").fill("cdr");
  await field(page, "Nazwa").fill("CD Projekt");
  await page.getByRole("button", { name: "Dodaj instrument" }).click();
  await expect(page.getByText("Instrument CDR został dodany.")).toBeVisible();

  const row = page.getByRole("row", { name: /CDR/ });
  await expect(row).toContainText("CD Projekt");
  await expect(row).toContainText("Akcja");
  await expect(row).toContainText("GPW");
  await expect(row).toContainText("PLN");

  await field(page, "Symbol").fill("CDR");
  await field(page, "Nazwa").fill("Duplikat");
  await page.getByRole("button", { name: "Dodaj instrument" }).click();
  await expect(page.getByText("Instrument o tym symbolu już istnieje na tym rynku.")).toBeVisible();
});

test("transakcje budują pozycję metodą FIFO i saldo gotówki", async ({ page }) => {
  await addTransaction(page, {
    type: "Wpłata",
    date: "2026-01-02",
    amount: "5 000",
    currency: "PLN",
  });
  await addTransaction(page, {
    type: "Kupno",
    date: "2026-01-10",
    instrument: cdr,
    quantity: "10",
    price: "100",
    fee: "5",
  });
  await addTransaction(page, {
    type: "Kupno",
    date: "2026-02-10",
    instrument: cdr,
    quantity: "10",
    price: "200,00",
  });
  await addTransaction(page, {
    type: "Sprzedaż",
    date: "2026-03-10",
    instrument: cdr,
    quantity: "15",
    price: "300",
    fee: "10",
  });
  await addTransaction(page, {
    type: "Dywidenda",
    date: "2026-06-01",
    instrument: cdr,
    amount: "50",
    tax: "9,50",
    currency: "PLN",
  });

  // 5 units left from the second purchase; the sale consumed the first lot and half of the second.
  const position = holdingsTable(page).getByRole("row", { name: /CDR/ });
  await expect(position.getByRole("cell").nth(1)).toHaveText("5");
  await expect(position.getByRole("cell").nth(2)).toHaveText("200,00 PLN");
  await expect(position.getByRole("cell").nth(3)).toHaveText("1 000,00 zł");
  await expect(position.getByRole("cell").nth(4)).toHaveText("+2 485,00 zł");
  await expect(position.getByRole("cell").nth(5)).toHaveText("40,50 zł");

  // 5000 − 1005 − 2000 + 4490 + 40,50
  const cash = page.getByRole("table", { name: "Salda gotówkowe" });
  await expect(cash.getByRole("row", { name: /XTB/ })).toContainText("6 525,50 zł");

  const history = page.getByRole("table", { name: "Historia transakcji" });
  await expect(history.getByRole("row")).toHaveCount(6);
  await expect(history.getByRole("row").nth(1)).toContainText("01.06.2026");
  await expect(history.getByRole("row").nth(1)).toContainText("Dywidenda");
  await expect(history.getByRole("row").nth(2)).toContainText("+4 490,00 zł");
  await expect(history.getByRole("row").nth(4)).toContainText("-1 005,00 zł");
});

test("formularz transakcji pilnuje danych i stanu rachunku", async ({ page }) => {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();

  // Missing and malformed values are reported next to the fields.
  await field(page, "Liczba").fill("dużo");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  // The instrument and the price are missing.
  await expect(page.getByText("To pole jest wymagane.")).toHaveCount(2);
  await expect(page.getByText("Wpisz liczbę, na przykład 12,50.")).toBeVisible();
  await expect(field(page, "Liczba")).toHaveValue("dużo");

  // More units than the account holds.
  await fillTransaction(page, {
    type: "Sprzedaż",
    date: "2026-04-01",
    instrument: cdr,
    quantity: "6",
    price: "300",
  });
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page.getByText(/Na tym rachunku nie ma tylu sztuk/)).toBeVisible();
  await expect(field(page, "Liczba")).toHaveValue("6");

  // Units held on another account cannot be sold from this one.
  await field(page, "Rachunek").selectOption({ label: "IKE" });
  await field(page, "Liczba").fill("1");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page.getByText(/Na tym rachunku nie ma tylu sztuk/)).toBeVisible();

  // A date in the future.
  await field(page, "Rachunek").selectOption({ label: "XTB" });
  await field(page, "Data").fill("2999-01-01");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page.getByText("Data nie może być późniejsza niż dzisiejsza.")).toBeVisible();

  await page.getByRole("link", { name: "Anuluj" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  await expect(
    page.getByRole("table", { name: "Historia transakcji" }).getByRole("row"),
  ).toHaveCount(6);
});

test("zakup w innej walucie pokazuje kurs przewalutowania", async ({ page }) => {
  await page.goto("/instruments");
  await field(page, "Symbol").fill("AAPL");
  await field(page, "Nazwa").fill("Apple");
  await field(page, "Rynek").selectOption({ label: "NASDAQ" });
  await field(page, "Waluta notowań").selectOption("USD");
  await page.getByRole("button", { name: "Dodaj instrument" }).click();
  await expect(page.getByText("Instrument AAPL został dodany.")).toBeVisible();

  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await fillTransaction(page, {
    type: "Kupno",
    date: "2026-05-04",
    instrument: "AAPL (Apple)",
    quantity: "2",
    price: "100",
  });

  // Settled in the instrument's currency by default: no rate needed.
  await expect(field(page, "Cena za sztukę (USD)")).toBeVisible();
  await expect(field(page, "Waluta rozliczenia")).toHaveValue("USD");
  await expect(field(page, "Kurs przewalutowania")).toHaveCount(0);

  await field(page, "Waluta rozliczenia").selectOption("PLN");
  await expect(page.getByText("Ile PLN kosztowała 1 jednostka USD.")).toBeVisible();
  await field(page, "Kurs przewalutowania").fill("4");
  await field(page, /Prowizja/).fill("8");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);

  // Cost stays in USD (200 + 8/4); cash left the PLN balance (2 × 100 × 4 + 8).
  const position = holdingsTable(page).getByRole("row", { name: /AAPL/ });
  await expect(position.getByRole("cell").nth(3)).toHaveText("202,00 USD");
  await expect(
    page.getByRole("table", { name: "Salda gotówkowe" }).getByRole("row", { name: /XTB/ }),
  ).toContainText("5 717,50 zł");
});

test("edycja i usunięcie transakcji przeliczają pozycję", async ({ page }) => {
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Edytuj transakcję: Sprzedaż, 10.03.2026" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edycja transakcji" })).toBeVisible();
  await expect(field(page, "Liczba")).toHaveValue("15");
  await expect(field(page, /Prowizja/)).toHaveValue("10");
  await expect(field(page, "Rachunek")).toBeDisabled();

  // Selling all 20 units closes the position.
  await field(page, "Liczba").fill("20");
  await page.getByRole("button", { name: "Zapisz transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  await expect(holdingsTable(page).getByRole("row", { name: /CDR/ })).toHaveCount(0);
  await page.getByText("Zamknięte pozycje (1)").click();
  await expect(
    page.getByRole("table", { name: "Zamknięte pozycje" }).getByRole("row", { name: /CDR/ }),
  ).toContainText("+2 985,00 zł");

  // A purchase that a later sale depends on cannot be deleted.
  await page.getByRole("link", { name: "Edytuj transakcję: Kupno, 10.01.2026" }).click();
  await page.getByRole("button", { name: "Usuń transakcję" }).click();
  await expect(page.getByText(/Na tym rachunku nie ma tylu sztuk/)).toBeVisible();

  // Deleting the sale reopens the position with both purchases.
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Edytuj transakcję: Sprzedaż, 10.03.2026" }).click();
  await page.getByRole("button", { name: "Usuń transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  const position = holdingsTable(page).getByRole("row", { name: /CDR/ });
  await expect(position.getByRole("cell").nth(1)).toHaveText("20");
  await expect(position.getByRole("cell").nth(3)).toHaveText("3 005,00 zł");
});

test("rachunek z transakcjami nie daje się usunąć, pusty tak", async ({ page }) => {
  // Each account is a list item that opens when its summary is clicked.
  const account = (name: string) =>
    page.getByRole("listitem").filter({
      has: page.getByLabel(`Edytuj rachunek ${name}`, { exact: true }),
    });

  await page.goto(`${portfolioUrl}/settings`);

  await page.getByLabel("Edytuj rachunek XTB", { exact: true }).click();
  await account("XTB").getByRole("button", { name: "Usuń rachunek" }).click();
  await expect(page.getByText(/Ten rachunek ma transakcje/)).toBeVisible();

  await page.getByLabel("Edytuj rachunek IKE", { exact: true }).click();
  await field(account("IKE"), "Nazwa rachunku").fill("IKE mBank");
  await account("IKE").getByRole("button", { name: "Zapisz rachunek" }).click();
  await expect(page.getByLabel("Edytuj rachunek IKE mBank", { exact: true })).toBeVisible();

  await account("IKE mBank").getByRole("button", { name: "Usuń rachunek" }).click();
  await expect(page.getByLabel("Edytuj rachunek IKE mBank", { exact: true })).toHaveCount(0);
});

test("inny użytkownik nie widzi cudzego portfela", async ({ page, browser }) => {
  const account = { username: "sasiad", password: "haslo-sasiada-123" };
  await createUserAsAdmin(page, account);

  const visitor = await newVisitor(browser);
  await signIn(visitor, account.username, account.password);
  await expect(
    visitor.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();

  for (const path of [
    portfolioUrl,
    `${portfolioUrl}/settings`,
    `${portfolioUrl}/transactions/new`,
  ]) {
    await visitor.goto(path);
    await expect(
      visitor.getByRole("heading", { level: 1, name: "Nie ma takiej strony" }),
    ).toBeVisible();
  }

  // The instrument catalogue, in contrast, is shared.
  await visitor.goto("/instruments");
  await expect(visitor.getByRole("row", { name: /CDR/ })).toBeVisible();
  await visitor.context().close();
});

test("zmiana nazwy i usunięcie portfela", async ({ page }) => {
  await page.goto(`${portfolioUrl}/settings`);

  await field(page, "Nazwa portfela").fill("Długoterminowy");
  await page.getByRole("button", { name: "Zapisz nazwę" }).click();
  await expect(page.getByText("Nazwa portfela została zmieniona.")).toBeVisible();

  await page.getByRole("button", { name: "Usuń portfel" }).click();
  await expect(page.getByText("Zaznacz potwierdzenie, żeby kontynuować.")).toBeVisible();

  await field(page, /Rozumiem, że portfel „Długoterminowy”/).check();
  await page.getByRole("button", { name: "Usuń portfel" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();
});
