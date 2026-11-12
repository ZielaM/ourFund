import { expect, test } from "@playwright/test";
import { signIn } from "./helpers/accounts";
import { admin, signedOut } from "./helpers/env";

test.describe("bez zalogowania", () => {
  test.use({ storageState: signedOut });

  for (const path of ["/", "/settings", "/admin/users", "/nie-ma-takiej-strony"]) {
    test(`${path} przekierowuje do logowania`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL("/login");
      await expect(page.getByRole("heading", { level: 1, name: "Zaloguj się" })).toBeVisible();
    });
  }

  test("nieważne ciasteczko sesji nie daje dostępu", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "ourfund_session", value: "podrobiony", url: baseURL! }]);

    await page.goto("/settings");

    await expect(page).toHaveURL("/login");
  });

  test("po utworzeniu administratora ekran pierwszego uruchomienia znika", async ({ page }) => {
    await page.goto("/setup");

    await expect(page).toHaveURL("/login");
  });

  test("rejestracja jest domyślnie wyłączona", async ({ page }) => {
    await page.goto("/register");

    await expect(
      page.getByRole("heading", { level: 1, name: "Nie ma takiej strony" }),
    ).toBeVisible();
    await expect(page.getByLabel("Nazwa użytkownika")).toHaveCount(0);
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Załóż konto" })).toHaveCount(0);
  });

  test("puste pola są zgłaszane przy polach", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Zaloguj się" }).click();

    await expect(page.getByText("To pole jest wymagane.")).toHaveCount(2);
  });

  test("błędne hasło nie zdradza, czy konto istnieje", async ({ page }) => {
    await signIn(page, admin.username, "zle-haslo-administratora");
    await expect(page.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
    await expect(page.getByLabel("Nazwa użytkownika")).toHaveValue(admin.username);

    await signIn(page, "nie-ma-takiego", "zle-haslo-administratora");
    await expect(page.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
  });

  test("po pięciu nieudanych próbach logowanie jest wstrzymane", async ({ page }) => {
    const username = "zgadywany";

    for (let attempt = 1; attempt <= 5; attempt++) {
      await signIn(page, username, `proba-numer-${attempt}`);
      await expect(page.getByText("Nieprawidłowa nazwa użytkownika lub hasło.")).toBeVisible();
    }

    await signIn(page, username, "proba-numer-6");
    await expect(
      page.getByText("Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za 15 minut."),
    ).toBeVisible();
  });

  test("logowanie i wylogowanie", async ({ page }) => {
    await signIn(page, ` ${admin.username.toUpperCase()} `, admin.password);

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: "Pulpit" })).toBeVisible();
    await expect(page.getByText("Nie masz jeszcze żadnego portfela")).toBeVisible();

    // A signed-in user has no reason to see the sign-in page.
    await page.goto("/login");
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Wyloguj się" }).click();
    await expect(page).toHaveURL("/login");

    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("po zalogowaniu", () => {
  test("nagłówek pokazuje nawigację i nazwę użytkownika", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "Nawigacja główna" });
    await expect(nav.getByRole("link", { name: "Pulpit" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("banner").getByText(admin.username, { exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Pulpit | ourFund");
  });

  test("nieznany adres pokazuje stronę 404 z powrotem do pulpitu", async ({ page }) => {
    const response = await page.goto("/nie-ma-takiej-strony");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Nie ma takiej strony" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Wróć do pulpitu" }).click();
    await expect(page).toHaveURL("/");
  });
});
