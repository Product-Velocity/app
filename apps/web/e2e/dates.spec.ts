import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=30&role=admin&datefmt=dd/mm/yyyy&view=All columns&cols=all") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
};

test.describe("date fields (0.23.0)", () => {
  test("a date cell is typed in the account format and shown in it", async ({ page }) => {
    await open(page);
    const cell = page.locator('.ag-row[row-index="0"] [col-id="planned_start"]');
    await cell.scrollIntoViewIfNeeded();
    await cell.dblclick();
    await page.getByLabel("Date", { exact: true }).fill("05/03/2027");
    await page.keyboard.press("Enter");
    await expect(cell).toContainText("05/03/2027");
  });

  test("the picker button is offered in the cell editor", async ({ page }) => {
    await open(page);
    const cell = page.locator('.ag-row[row-index="0"] [col-id="planned_start"]');
    await cell.scrollIntoViewIfNeeded();
    await cell.dblclick();
    await expect(page.getByRole("button", { name: "Pick a date" })).toBeVisible();
  });
});
