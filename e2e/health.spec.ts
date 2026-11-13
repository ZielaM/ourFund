import { expect, test } from "@playwright/test";
import { signedOut } from "./helpers/env";

test.use({ storageState: signedOut });

test("/api/health potwierdza połączenie z bazą bez logowania", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", database: "ok" });
});

test("prywatna instancja nie pozwala wyszukiwarkom na indeksowanie", async ({ request }) => {
  const response = await request.get("/robots.txt");

  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Disallow: /");
});
