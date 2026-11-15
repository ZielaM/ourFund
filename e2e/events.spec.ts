import { expect, test, type Page } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

const investor = { username: "zdarzenia", password: "haslo-do-zdarzen-123" };

let page: Page;
let portfolioUrl: string;

test.beforeAll(async ({ browser }) => {
  page = await newVisitor(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

const notice = () => page.getByRole("link", { name: /do uzupełnienia$/ });
const suggestions = () =>
  page.getByRole("table", { name: "Dywidendy i splity, których nie ma na rachunkach" });

test("po odświeżeniu notowań portfel pokazuje brakujący split i dywidendę", async ({
  page: adminPage,
}) => {
  await createUserAsAdmin(adminPage, investor);
  await signIn(page, investor.username, investor.password);

  await field(page, "Nazwa portfela").fill("Zdarzenia");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Zdarzenia" })).toBeVisible();
  portfolioUrl = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await field(page, "Nazwa rachunku").fill("Makler");
  await page.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek Makler został dodany.")).toBeVisible();

  // The fixture data knows one company with a 2:1 split in March and a dividend in June.
  await page.goto("/instruments");
  await field(page, "Symbol").fill("EVENTS");
  await field(page, "Nazwa").fill("Spółka ze zdarzeniami");
  await page.getByRole("button", { name: "Dodaj instrument" }).click();
  await expect(page.getByText("Instrument EVENTS został dodany.")).toBeVisible();

  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await field(page, "Data").fill("2026-01-05");
  await field(page, "Instrument").selectOption({ label: "EVENTS (Spółka ze zdarzeniami)" });
  await field(page, "Liczba").fill("10");
  await field(page, /Cena za sztukę/).fill("200");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  await expect(notice()).toHaveCount(0);

  await page.goto("/instruments");
  await page.getByRole("button", { name: "Odśwież notowania" }).click();
  await expect(page.getByText("Notowania zostały odświeżone.")).toBeVisible();

  await page.goto(portfolioUrl);
  await expect(notice()).toHaveText("2 dywidendy lub splity do uzupełnienia");
  await notice().click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Dywidendy i splity do uzupełnienia" }),
  ).toBeVisible();

  const split = suggestions().getByRole("row", { name: /Split 2:1/ });
  await expect(split).toContainText("02.03.2026");
  await expect(split).toContainText("10 szt. zamienia się w 20 szt.");
  // The split is not recorded yet, so the dividend still counts ten units.
  const dividend = suggestions().getByRole("row", { name: /Dywidenda/ });
  await expect(dividend).toContainText("15.06.2026");
  await expect(dividend).toContainText(/Dywidenda 15,00\szł brutto/);
});

test("split zapisuje się z wypełnionego formularza i zmienia liczbę sztuk", async () => {
  await page
    .getByRole("link", { name: "Zapisz: split EVENTS z 02.03.2026 na rachunku Makler" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Nowa transakcja" })).toBeVisible();
  await expect(field(page, "Typ transakcji")).toHaveValue("SPLIT");
  await expect(field(page, "Data")).toHaveValue("2026-03-02");
  await expect(field(page, "Stosunek podziału")).toHaveValue("2");

  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  const holding = page.getByRole("table", { name: "Otwarte pozycje" }).getByRole("row", {
    name: /EVENTS/,
  });
  await expect(holding).toContainText("20");

  await expect(notice()).toHaveText("1 dywidenda lub split do uzupełnienia");
});

test("dywidenda otwiera formularz z kwotą i podatkiem, a zapisana znika z listy", async () => {
  await notice().click();
  await expect(suggestions().getByRole("row", { name: /Split/ })).toHaveCount(0);
  // Twenty units after the split: 20 x 1,50 zł.
  await expect(suggestions().getByRole("row", { name: /Dywidenda/ })).toContainText(
    /Dywidenda 30,00\szł brutto/,
  );

  await page
    .getByRole("link", { name: "Zapisz: dywidenda EVENTS z 15.06.2026 na rachunku Makler" })
    .click();
  await expect(field(page, "Typ transakcji")).toHaveValue("DIVIDEND");
  await expect(field(page, /^Kwota/)).toHaveValue("30");
  await expect(field(page, "Podatek pobrany u źródła")).toHaveValue("5,7");

  // The broker paid two weeks after the ex-dividend day.
  await field(page, "Data").fill("2026-06-29");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  await expect(notice()).toHaveCount(0);

  await page.goto(`${portfolioUrl}/events`);
  await expect(page.getByText("Nic do uzupełnienia.")).toBeVisible();
});

test("pominięte zdarzenie nie jest więcej podpowiadane", async () => {
  // Without the recorded payment the dividend is suggested again.
  await page.goto(portfolioUrl);
  await page.getByRole("link", { name: "Edytuj transakcję: Dywidenda, 29.06.2026" }).click();
  await page.getByRole("button", { name: "Usuń transakcję" }).click();
  await expect(page).toHaveURL(portfolioUrl);
  await expect(notice()).toHaveText("1 dywidenda lub split do uzupełnienia");

  await notice().click();
  await page
    .getByRole("button", { name: "Pomiń: dywidenda EVENTS z 15.06.2026 na rachunku Makler" })
    .click();
  await expect(page.getByText("Nic do uzupełnienia.")).toBeVisible();

  await page.goto(portfolioUrl);
  await expect(notice()).toHaveCount(0);
});

test("cudzy portfel nie pokazuje podpowiedzi", async ({ page: adminPage }) => {
  await adminPage.goto(`${portfolioUrl}/events`);
  await expect(adminPage.getByRole("heading", { level: 1, name: /do uzupełnienia/ })).toHaveCount(
    0,
  );
});
