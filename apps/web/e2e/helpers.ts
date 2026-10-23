import type { Locator, Page } from "@playwright/test";

/** Choose an option in a searchable drop-down (a list with more than 8 options): open it, pick the option with this value. */
export async function chooseOption(page: Page, within: Page | Locator, label: string | RegExp, value: string) {
  await within.getByRole("button", { name: label }).click();
  await page.locator(`.select-panel [role="option"][data-value="${value}"]`).click();
}
