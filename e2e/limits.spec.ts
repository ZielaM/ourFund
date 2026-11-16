import { expect, test, type Page } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

// One story told in steps: each test continues where the previous one stopped.
test.describe.configure({ mode: "serial" });

const saver = { username: "oszczedzajacy", password: "haslo-na-emeryture-123" };
// The limit shown is this year's, so the deposit has to be dated this year as well.
const today = new Date().toISOString().slice(0, 10);

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await newVisitor(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

const limits = () => page.getByRole("region", { name: /Limity wpłat na IKE i IKZE/ });

test("pulpit bez rachunku IKE nie pokazuje limitów", async ({ page: adminPage }) => {
  await createUserAsAdmin(adminPage, saver);
  await signIn(page, saver.username, saver.password);

  await field(page, "Nazwa portfela").fill("Emerytura");
  await page.getByRole("button", { name: "Utwórz portfel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Emerytura" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Otwórz portfel Emerytura" })).toBeVisible();
  await expect(limits()).toHaveCount(0);
});

test("rachunek IKE pokazuje limit i wpłaty z tego roku", async () => {
  await page.getByRole("link", { name: "Otwórz portfel Emerytura" }).click();
  await page.getByRole("link", { name: "Dodaj rachunek" }).click();
  await field(page, "Nazwa rachunku").fill("Moje IKE");
  await field(page, "Typ rachunku").selectOption({ label: "IKE" });
  await page.getByRole("button", { name: "Dodaj rachunek" }).click();
  await expect(page.getByText("Rachunek Moje IKE został dodany.")).toBeVisible();

  await page.goto("/");
  await expect(limits().getByRole("heading", { level: 3, name: "IKE" })).toBeVisible();
  await expect(limits().getByText(/nie ma zapisanych wpłat/)).toBeVisible();
  await expect(limits().getByRole("meter", { name: "Wykorzystanie limitu IKE" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );

  await page.getByRole("link", { name: "Otwórz portfel Emerytura" }).click();
  await page.getByRole("link", { name: "Dodaj transakcję" }).click();
  await field(page, "Typ transakcji").selectOption({ label: "Wpłata" });
  await field(page, "Data").fill(today);
  await field(page, /^Kwota/).fill("5000");
  await page.getByRole("button", { name: "Dodaj transakcję" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Emerytura" })).toBeVisible();

  await page.goto("/");
  await expect(limits().getByText(/^5\s000,00\szł/)).toBeVisible();
  await expect(limits().getByText(/Do limitu zostało/)).toBeVisible();
  await expect(limits().getByText(/nie ma zapisanych wpłat/)).toHaveCount(0);
  // The IKZE card appears only for someone who has such an account.
  await expect(limits().getByRole("heading", { level: 3, name: "IKZE" })).toHaveCount(0);
});
