import { expect, test, type Browser } from "@playwright/test";
import { signedOut } from "./helpers/env";

async function pageColors(browser: Browser, colorScheme: "light" | "dark") {
  const context = await browser.newContext({ colorScheme, storageState: signedOut });
  const page = await context.newPage();
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();

  const colors = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const button = getComputedStyle(document.querySelector('button[type="submit"]')!);
    return {
      background: body.backgroundColor,
      text: body.color,
      button: button.backgroundColor,
      buttonText: button.color,
    };
  });
  await context.close();
  return colors;
}

test("wygląd podąża za jasnym lub ciemnym motywem systemu", async ({ browser }) => {
  const light = await pageColors(browser, "light");
  expect(light.background).toBe("rgb(243, 245, 249)");
  expect(light.text).toBe("rgb(22, 32, 53)");
  expect(light.button).toBe("rgb(27, 47, 94)");

  const dark = await pageColors(browser, "dark");
  expect(dark.background).toBe("rgb(15, 21, 36)");
  expect(dark.text).toBe("rgb(230, 234, 242)");
  // On dark paper the button turns pale and its label dark, so it stays readable.
  expect(dark.button).toBe("rgb(169, 192, 240)");
  expect(dark.buttonText).toBe("rgb(15, 21, 36)");
});

test("motyw można przełączyć przyciskiem i wybór zostaje po odświeżeniu", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.getByRole("radio", { name: "Zgodnie z ustawieniami systemu" })).toBeChecked();
  expect(await background()).toBe("rgb(243, 245, 249)");

  await page.getByRole("button", { name: "Włącz ciemny motyw" }).click();
  await expect(page.getByRole("radio", { name: "Ciemny" })).toBeChecked();
  expect(await background()).toBe("rgb(15, 21, 36)");

  // The choice is applied before the first paint of the next page load.
  await page.reload();
  await expect(page.getByRole("button", { name: "Włącz jasny motyw" })).toBeVisible();
  expect(await background()).toBe("rgb(15, 21, 36)");

  // Back to the system setting: light first, and dark as soon as the system switches.
  await page.getByRole("radio", { name: "Zgodnie z ustawieniami systemu" }).check();
  expect(await background()).toBe("rgb(243, 245, 249)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe("rgb(15, 21, 36)");

  await page.getByRole("radio", { name: "Jasny" }).check();
  expect(await background()).toBe("rgb(243, 245, 249)");
});
