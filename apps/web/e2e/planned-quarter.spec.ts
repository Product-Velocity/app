import { expect, test, type Page } from "@playwright/test";

// R-114: Planned Quarter is a field a person sets; a G2M date outside it is a hint, never a change.
const open = async (page: Page) => {
  await page.goto("/dev/grid?n=50&view=All columns&cols=all");
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const cell = (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);
const quarterOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as { __pv: { controller: { row: (id: string) => { g2m_quarter: unknown } } } }).__pv.controller.row(i).g2m_quarter, id);

test("the column is Planned Quarter, set with the keyboard from a list of quarters, and cleared to Unscheduled", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("columnheader", { name: "Planned Quarter" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "G2M Quarter" })).toHaveCount(0);
  await cell(page, "item-1", "g2m_quarter").click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: /Choose an option/ })).toBeFocused();
  await page.keyboard.type("Q3 2027");
  await page.keyboard.press("Enter");
  await expect(cell(page, "item-1", "g2m_quarter")).toContainText("Q3 2027");
  expect(await quarterOf(page, "item-1")).toBe("Q3 2027");
  await cell(page, "item-1", "g2m_quarter").click();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "Unscheduled" }).click();
  expect(await quarterOf(page, "item-1")).toBeNull();
});

test("changing the G2M date does not change the quarter; a date outside it shows a warning with words", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as { __pv: { controller: { edit: (id: string, f: string, v: string) => unknown } } }).__pv.controller.edit("item-2", "g2m_quarter", "Q3 2027"));
  await page.evaluate(() => (window as unknown as { __pv: { controller: { edit: (id: string, f: string, v: string) => unknown } } }).__pv.controller.edit("item-2", "g2m_date_est", "2027-08-10"));
  await expect(cell(page, "item-2", "g2m_quarter")).toHaveText("Q3 2027");
  await page.evaluate(() => (window as unknown as { __pv: { controller: { edit: (id: string, f: string, v: string) => unknown } } }).__pv.controller.edit("item-2", "g2m_date_est", "2027-11-10"));
  await expect(cell(page, "item-2", "g2m_quarter")).toHaveText("Q3 2027 \u26A0");
  expect(await quarterOf(page, "item-2")).toBe("Q3 2027");
  await page.screenshot({ path: "test-results/planned-quarter-grid.png" });
});
