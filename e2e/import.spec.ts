import { expect, test, type Page } from "@playwright/test";
import { xtbWorkbook, type XtbOperation } from "../src/test/xtb-report";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

const investor = { username: "importer", password: "haslo-importera-123" };
let page: Page;
let portfolioUrl: string;

// A made-up account history laid out like XTB's report.
const history: XtbOperation[] = [
  { type: "Deposit", time: "2026-01-02 10:00", amount: 5000, id: "d1" },
  {
    type: "Stock purchase",
    time: "2026-01-12 09:30",
    amount: -1000,
    comment: "OPEN BUY 10 @ 100.00",
    ticker: "IMPA.PL",
    instrument: "Importowana Spółka",
    id: "b1",
  },
  {
    type: "Stock sell",
    time: "2026-03-02 09:30",
    amount: 600,
    comment: "CLOSE BUY 4/10 @ 150.00",
    ticker: "IMPA.PL",
    instrument: "Importowana Spółka",
    id: "s1",
  },
  {
    type: "Dividend",
    time: "2026-05-15 08:00",
    amount: 30,
    comment: "IMPA.PL PLN 5.0/ SHR",
    ticker: "IMPA.PL",
    instrument: "Importowana Spółka",
    id: "v1",
  },
  {
    type: "Withholding tax",
    time: "2026-05-15 08:00",
    amount: -5.7,
    comment: "IMPA.PL PLN WHT 19%",
    ticker: "IMPA.PL",
    id: "t1",
  },
  { type: "Currency conversion", time: "2026-06-01 08:00", amount: -5, id: "c1" },
];

function report(operations: XtbOperation[], name = "PLN_10000001_2020-01-01_2026-11-14.xlsx") {
  return {
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(xtbWorkbook({ operations })),
  };
}

async function check(file: Parameters<Page["setInputFiles"]>[1]) {
  await field(page, "Plik z XTB (.xlsx)").setInputFiles(file);
  await page.getByRole("button", { name: "Sprawdź plik" }).click();
}

test.beforeAll(async ({ browser }) => {
  page = await newVisitor(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

test("plik musi być raportem z XTB", async ({ page: adminPage }) => {
  await createUserAsAdmin(adminPage, investor);
  await signIn(page, investor.username, investor.password);
  await expect(
    page.getByRole("heading", { name: "Nie masz jeszcze żadnego portfela" }),
  ).toBeVisible();

  await field(page, "Nazwa portfela").fill("Importowany");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Importowany" })).toBeVisible();
  portfolioUrl = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await field(page, "Nazwa rachunku").fill("XTB");
  await page.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek XTB został dodany.")).toBeVisible();

  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Importuj z XTB" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import z XTB" })).toBeVisible();

  await page.getByRole("button", { name: "Sprawdź plik" }).click();
  await expect(page.getByText("Wybierz plik do wczytania.")).toBeVisible();

  await check({
    name: "notatki.xlsx",
    mimeType: "text/plain",
    buffer: Buffer.from("to nie arkusz"),
  });
  await expect(page.getByText("To nie jest plik .xlsx.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Co zostanie dodane" })).toHaveCount(0);
});

test("podgląd pokazuje, co zostanie dodane, zanim cokolwiek się zapisze", async () => {
  await check(report(history));

  const preview = page.getByRole("region", { name: "Co zostanie dodane" });
  await expect(preview.getByRole("status")).toHaveText(
    "Plik rachunku 10000001 (PLN). 4 nowe operacje.",
  );
  await expect(preview).toContainText("Nowe instrumenty w katalogu");
  await expect(preview).toContainText("IMPA (Importowana Spółka)");

  const skipped = preview.getByRole("table", { name: "Wiersze pliku pominięte przy imporcie" });
  await expect(skipped.getByRole("row", { name: /Currency conversion/ })).toContainText(
    "nieznany rodzaj operacji",
  );

  await preview.getByText("Pokaż operacje do dodania (4)").click();
  const operations = preview.getByRole("table", { name: "Operacje, które zostaną dodane" });
  await expect(operations.getByRole("row")).toHaveCount(5);
  await expect(operations.getByRole("row", { name: /Kupno/ })).toContainText("12.01.2026");
  await expect(operations.getByRole("row", { name: /Kupno/ })).toContainText(/-1\s000,00\szł/);
  await expect(operations.getByRole("row", { name: /Sprzedaż/ })).toContainText(/\+600,00\szł/);
  // The dividend arrives after the tax withheld on it.
  await expect(operations.getByRole("row", { name: /Dywidenda/ })).toContainText(/\+24,30\szł/);

  // Nothing has been written yet.
  await page.goto(portfolioUrl);
  await expect(page.getByText("Brak transakcji.")).toBeVisible();
});

test("zatwierdzenie dodaje operacje i instrument", async () => {
  await page.getByRole("link", { name: "Importuj z XTB" }).click();
  await check(report(history));
  await page.getByRole("button", { name: "Importuj 4 operacje" }).click();

  await expect(page.getByRole("status")).toContainText("Dodano 4 operacje.");
  await expect(page.getByRole("status")).toContainText("Nowe instrumenty w katalogu: 1.");
  await page.getByRole("link", { name: "Wróć do portfela" }).click();

  const position = page
    .getByRole("table", { name: "Otwarte pozycje" })
    .getByRole("row", { name: /IMPA/ });
  await expect(position.getByRole("cell").nth(1)).toHaveText("6");
  await expect(position).toContainText(/600,00\szł/);

  // 5 000 - 1 000 + 600 + 24,30
  const cash = page.getByRole("region", { name: "Gotówka" });
  await expect(cash.getByRole("row", { name: /XTB/ })).toContainText(/4\s624,30\szł/);
});

test("ponowny import tego samego pliku niczego nie dubluje", async () => {
  await page.goto(`${portfolioUrl}/import`);
  await check(report(history));

  const preview = page.getByRole("region", { name: "Co zostanie dodane" });
  await expect(preview.getByRole("status")).toHaveText(
    "Plik rachunku 10000001 (PLN). Brak nowych operacji, już zaimportowanych: 4.",
  );
  await expect(page.getByRole("button", { name: "Importuj 0 operacji" })).toBeDisabled();

  // A longer report adds only what is new.
  await check(
    report([...history, { type: "Withdrawal", time: "2026-07-01 10:00", amount: -100, id: "w1" }]),
  );
  await expect(preview.getByRole("status")).toHaveText(
    "Plik rachunku 10000001 (PLN). 1 nowa operacja, już zaimportowanych: 4.",
  );
  await page.getByRole("button", { name: "Importuj 1 operację" }).click();
  await expect(page.getByRole("status")).toContainText("Dodano 1 operację.");
});

test("plik ze sprzedażą ponad stan rachunku nie da się zaimportować", async () => {
  await page.goto(`${portfolioUrl}/import`);
  await check(
    report([
      {
        type: "Stock sell",
        time: "2026-08-03 09:30",
        amount: 1500,
        comment: "CLOSE BUY 10 @ 150.00",
        ticker: "IMPA.PL",
        instrument: "Importowana Spółka",
        id: "s2",
      },
    ]),
  );

  await expect(
    page.getByText(/Sprzedaż IMPA z dnia 03\.08\.2026 przekracza stan rachunku/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Importuj 1 operację" })).toBeDisabled();
});

test("gdy pliku nie da się rozpoznać, walutę wybiera użytkownik", async () => {
  await page.goto(`${portfolioUrl}/import`);
  const unnamed = {
    name: "raport.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      xtbWorkbook({
        currency: null,
        operations: [{ type: "Deposit", time: "2026-09-01 10:00", amount: 50, id: "e1" }],
      }),
    ),
  };

  await check(unnamed);
  await expect(page.getByText(/Nie udało się ustalić waluty rachunku z pliku/)).toBeVisible();

  await field(page, "Waluta rachunku w XTB").selectOption("EUR");
  await check(unnamed);
  await expect(
    page.getByRole("region", { name: "Co zostanie dodane" }).getByRole("status"),
  ).toHaveText("Plik rachunku 10000001 (EUR). 1 nowa operacja.");
});

test("importować można tylko do własnego portfela", async ({ page: adminPage }) => {
  await adminPage.goto(`${portfolioUrl}/import`);
  await expect(adminPage.getByRole("heading", { name: "Nie ma takiej strony" })).toBeVisible();
});
