import { expect, test } from "@playwright/test";
import { createUserAsAdmin, fillNewAccount, newVisitor, signIn } from "./helpers/accounts";
import { admin } from "./helpers/env";
import { field } from "./helpers/ui";

test.describe("zarządzanie użytkownikami", () => {
  test("administrator widzi siebie na liście kont", async ({ page }) => {
    await page.goto("/admin/users");

    const row = page.getByRole("row", { name: new RegExp(admin.username) });
    await expect(row).toContainText("to Ty");
    await expect(row).toContainText("Administrator");
    await expect(row).toContainText("Aktywne");
  });

  test("zajęta nazwa użytkownika jest zgłaszana przy polu", async ({ page }) => {
    await page.goto("/admin/users");
    await fillNewAccount(page, { username: admin.username, password: "dowolne-haslo-123" });
    await page.getByRole("button", { name: "Utwórz konto" }).click();

    await expect(page.getByText("Ta nazwa użytkownika jest już zajęta.")).toBeVisible();
    await expect(field(page, "Nazwa użytkownika")).toHaveValue(admin.username);
  });

  test("własnego konta administrator nie blokuje ani nie resetuje", async ({ page }) => {
    await page.goto("/admin/users");
    await page.getByRole("link", { name: `Zarządzaj kontem ${admin.username}` }).click();

    await expect(page.getByText("To Twoje konto. Hasło zmienisz w ustawieniach.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zablokuj konto" })).toHaveCount(0);
    await page.getByRole("link", { name: "Przejdź do ustawień" }).click();
    await expect(page).toHaveURL("/settings");
  });

  test("nowy użytkownik loguje się i nie ma dostępu do administracji", async ({
    page,
    browser,
  }) => {
    const account = { username: "ania", password: "haslo-ani-12345" };
    await createUserAsAdmin(page, account);
    await expect(page.getByRole("row", { name: /ania/ })).toContainText("Użytkownik");

    const visitor = await newVisitor(browser);
    await signIn(visitor, account.username, account.password);

    await expect(visitor).toHaveURL("/");
    await expect(visitor.getByRole("link", { name: "Użytkownicy" })).toHaveCount(0);
    await visitor.goto("/admin/users");
    await expect(
      visitor.getByRole("heading", { level: 1, name: "Nie ma takiej strony" }),
    ).toBeVisible();
    await expect(visitor.getByRole("table")).toHaveCount(0);
    await visitor.context().close();
  });

  test("zablokowanie wylogowuje i uniemożliwia logowanie, odblokowanie przywraca dostęp", async ({
    page,
    browser,
  }) => {
    const account = { username: "blokowany", password: "haslo-blokowanego-1" };
    await createUserAsAdmin(page, account);

    const visitor = await newVisitor(browser);
    await signIn(visitor, account.username, account.password);
    await expect(visitor).toHaveURL("/");

    await page.getByRole("link", { name: `Zarządzaj kontem ${account.username}` }).click();
    await page.getByRole("button", { name: "Zablokuj konto" }).click();
    await expect(page.getByText("Konto zostało zablokowane.")).toBeVisible();
    await expect(page.getByText("Zablokowane", { exact: true })).toBeVisible();

    // The session that was open is no longer valid.
    await visitor.goto("/settings");
    await expect(visitor).toHaveURL("/login");
    await signIn(visitor, account.username, account.password);
    await expect(visitor.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();

    await page.getByRole("button", { name: "Odblokuj konto" }).click();
    await expect(page.getByText("Konto zostało odblokowane.")).toBeVisible();

    await signIn(visitor, account.username, account.password);
    await expect(visitor).toHaveURL("/");
    await visitor.context().close();
  });

  test("administrator nadaje nowe hasło", async ({ page, browser }) => {
    const account = { username: "zapominalski", password: "stare-haslo-12345" };
    const newPassword = "nadane-haslo-67890";
    await createUserAsAdmin(page, account);

    await page.getByRole("link", { name: `Zarządzaj kontem ${account.username}` }).click();
    await field(page, "Nowe hasło", { exact: true }).fill(newPassword);
    await field(page, "Powtórz hasło").fill(newPassword);
    await page.getByRole("button", { name: "Ustaw hasło" }).click();
    await expect(page.getByText("Nowe hasło zostało ustawione.")).toBeVisible();

    const visitor = await newVisitor(browser);
    await signIn(visitor, account.username, account.password);
    await expect(visitor.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
    await signIn(visitor, account.username, newPassword);
    await expect(visitor).toHaveURL("/");
    await visitor.context().close();
  });

  test("nieistniejące konto daje stronę 404", async ({ page }) => {
    await page.goto("/admin/users/00000000-0000-4000-8000-000000000000");

    await expect(
      page.getByRole("heading", { level: 1, name: "Nie ma takiej strony" }),
    ).toBeVisible();
  });
});
