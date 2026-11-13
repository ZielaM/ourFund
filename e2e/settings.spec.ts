import { expect, test } from "@playwright/test";
import { createUserAsAdmin, newVisitor, signIn } from "./helpers/accounts";
import { field } from "./helpers/ui";

test("użytkownik zmienia własne hasło", async ({ page, browser }) => {
  const account = { username: "zmieniajacy", password: "pierwsze-haslo-123" };
  const newPassword = "drugie-haslo-456789";
  await createUserAsAdmin(page, account);

  const user = await newVisitor(browser);
  await signIn(user, account.username, account.password);
  await user.getByRole("link", { name: /Ustawienia/ }).click();
  await expect(user).toHaveURL("/settings");
  await expect(user.getByRole("heading", { level: 1, name: "Ustawienia" })).toBeVisible();
  await expect(user.getByText("Użytkownik", { exact: true })).toBeVisible();

  // The current password must be right.
  await field(user, "Obecne hasło").fill("nie-to-haslo");
  await field(user, "Nowe hasło", { exact: true }).fill(newPassword);
  await field(user, "Powtórz hasło").fill(newPassword);
  await user.getByRole("button", { name: "Zmień hasło" }).click();
  await expect(user.getByText("Obecne hasło jest nieprawidłowe.")).toBeVisible();

  await field(user, "Obecne hasło").fill(account.password);
  await field(user, "Nowe hasło", { exact: true }).fill(newPassword);
  await field(user, "Powtórz hasło").fill(newPassword);
  await user.getByRole("button", { name: "Zmień hasło" }).click();
  await expect(user.getByText("Hasło zostało zmienione.")).toBeVisible();

  // The session used for the change stays signed in; the old password stops working.
  await user.reload();
  await expect(user).toHaveURL("/settings");
  await user.getByRole("button", { name: "Wyloguj się" }).click();

  await signIn(user, account.username, account.password);
  await expect(user.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
  await signIn(user, account.username, newPassword);
  await expect(user).toHaveURL("/");
  await user.context().close();
});
