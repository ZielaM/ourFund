import { expect, test } from "@playwright/test";

test.describe("strona startowa", () => {
  test("pokazuje nazwę aplikacji i opis po polsku", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("ourFund");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.getByRole("heading", { level: 1, name: "ourFund" })).toBeVisible();
    await expect(page.getByText("Rachunki IKE, IKZE i OKI obok zwykłych")).toBeVisible();
  });

  test("nie pozwala wyszukiwarkom indeksować prywatnej instancji", async ({ request }) => {
    const response = await request.get("/robots.txt");

    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Disallow: /");
  });
});

test.describe("stan aplikacji", () => {
  test("/api/health potwierdza połączenie z bazą", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });
});
