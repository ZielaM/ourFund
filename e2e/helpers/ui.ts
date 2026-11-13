import type { Locator, Page } from "@playwright/test";

/**
 * Finds a form field by its label, among visible elements only.
 *
 * With Cache Components the page the user came from stays in the document, hidden, so a
 * plain `getByLabel` can match a field on that page as well.
 */
export function field(
  scope: Page | Locator,
  label: string | RegExp,
  options?: { exact?: boolean },
): Locator {
  return scope.getByLabel(label, options).filter({ visible: true });
}
