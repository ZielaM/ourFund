import { expect, test as setup } from "@playwright/test";
import { fillNewAccount } from "./helpers/accounts";
import { resetDatabase } from "./helpers/db";
import { admin, adminStorageState } from "./helpers/env";
import { field } from "./helpers/ui";

setup("pierwsze uruchomienie: utworzenie konta administratora", async ({ page }) => {
  await resetDatabase();

  // A brand-new instance sends every visitor to the first-run setup.
  await page.goto("/");
  await expect(page).toHaveURL("/setup");
  await expect(
    page.getByRole("heading", { level: 1, name: "Pierwsze uruchomienie" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");

  await page.goto("/login");
  await expect(page).toHaveURL("/setup");

  // Invalid input is explained next to the fields and nothing is created.
  await fillNewAccount(page, {
    username: "Zły Login",
    password: "krotkie",
    passwordConfirmation: "inne",
  });
  await page.getByRole("button", { name: "Utwórz konto administratora" }).click();
  await expect(page.getByText(/Użyj od 3 do 32 znaków/)).toBeVisible();
  await expect(page.getByText("Hasło musi mieć co najmniej 10 znaków.")).toBeVisible();
  await expect(field(page, "Nazwa użytkownika")).toHaveValue("Zły Login");

  await fillNewAccount(page, {
    username: admin.username,
    password: admin.password,
    passwordConfirmation: "inne-haslo-administratora",
  });
  await page.getByRole("button", { name: "Utwórz konto administratora" }).click();
  await expect(page.getByText("Hasła nie są takie same.")).toBeVisible();

  // A valid account signs the administrator in straight away.
  await fillNewAccount(page, admin);
  await page.getByRole("button", { name: "Utwórz konto administratora" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Pulpit" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Użytkownicy" })).toBeVisible();

  await page.context().storageState({ path: adminStorageState });
});
