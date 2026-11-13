import { expect, type Browser, type Page } from "@playwright/test";
import { signedOut } from "./env";
import { field } from "./ui";

export async function fillNewAccount(
  page: Page,
  account: { username: string; password: string; passwordConfirmation?: string },
) {
  await field(page, "Nazwa użytkownika").fill(account.username);
  await field(page, "Hasło", { exact: true }).fill(account.password);
  await field(page, "Powtórz hasło").fill(account.passwordConfirmation ?? account.password);
}

export async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await field(page, "Nazwa użytkownika").fill(username);
  await field(page, "Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
}

/** Creates an account through the administrator's "Użytkownicy" page. */
export async function createUserAsAdmin(
  adminPage: Page,
  account: { username: string; password: string; role?: "Użytkownik" | "Administrator" },
) {
  await adminPage.goto("/admin/users");
  await fillNewAccount(adminPage, account);
  if (account.role) {
    await field(adminPage, "Rola").selectOption({ label: account.role });
  }
  await adminPage.getByRole("button", { name: "Utwórz konto" }).click();
  await expect(adminPage.getByText(`Konto ${account.username} zostało utworzone.`)).toBeVisible();
}

/** Opens a separate browser session that is not signed in. */
export async function newVisitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: signedOut });
  return context.newPage();
}
