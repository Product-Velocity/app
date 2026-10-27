import type { Locator, Page } from "@playwright/test";

/** Choose an option in a searchable drop-down (a list with more than 8 options): open it, pick the option with this value. */
export async function chooseOption(page: Page, within: Page | Locator, label: string | RegExp, value: string) {
  await within.getByRole("button", { name: label }).click();
  await page.locator(`.select-panel [role="option"][data-value="${value}"]`).click();
}

/** The tab (or temporary tab) of a view in the view row. */
export const viewTab = (page: Page, name: string) => page.locator(".view-chip", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });

/** Opens a view: its tab when it is in the bar, otherwise from the "N more views" menu. */
export async function goToView(page: Page, name: string) {
  const tab = viewTab(page, name);
  if (await tab.count()) { await tab.click(); return; }
  await page.getByRole("button", { name: /more views?$/ }).click();
  await page.getByRole("dialog", { name: "Views" }).locator(".vm-open", { hasText: new RegExp(`^${name}`) }).first().click();
}
