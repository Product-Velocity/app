import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=60") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
};
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test.describe("floating bars", () => {
  test("selecting rows does not change the grid's height or position; the quick-add makes room above the bulk bar and they never overlap", async ({ page }) => {
    await open(page);
    const grid = await box(page, ".grid-wrap");
    await page.locator('.ag-row[row-id] .ag-checkbox-input').first().check();
    await expect(page.getByRole("region", { name: "Bulk actions for the selected items" })).toBeVisible();
    const gridAfter = await box(page, ".grid-wrap");
    const quickAfter = await box(page, ".quick-add");
    expect(gridAfter.height).toBe(grid.height);
    expect(gridAfter.y).toBe(grid.y);
    // the quick-add sits above the bulk bar (decided in R-022); they do not overlap, and both stay inside the window
    const bulk = await box(page, ".bulk-bar");
    expect(quickAfter.y + quickAfter.height).toBeLessThanOrEqual(bulk.y + 0.5);
    expect(bulk.y + bulk.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  test("the bulk bar never covers the last row: scrolled to the bottom, the last row ends above it", async ({ page }) => {
    await open(page, "n=60");
    await page.locator('.ag-row[row-id] .ag-checkbox-input').first().check();
    await page.locator(".ag-body-vertical-scroll-viewport").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(200);
    const bulk = await box(page, ".bulk-bar");
    const rows = await page.locator('.ag-center-cols-container .ag-row:not([row-id^="spacer"])').evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().bottom));
    const lastBottom = Math.max(...rows);
    const quick = await box(page, ".quick-add");
    expect(lastBottom).toBeLessThanOrEqual(Math.min(bulk.y, quick.y) + 1);
  });

  test("the empty row at the end is not an initiative: no checkbox and not counted", async ({ page }) => {
    await open(page, "n=30");
    await page.locator('.ag-row[row-id] .ag-checkbox-input').first().check();
    await expect(page.getByText("30 items")).toBeVisible();
    await expect(page.locator('.ag-row[row-id="spacer:bulk-bar"] input[type="checkbox"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions for the selected items" })).toHaveCount(0);
    await expect(page.locator('.ag-row[row-id="spacer:bulk-bar"] input[type="checkbox"]')).toHaveCount(0);
  });
});

test("the empty row sits after the last initiative, never before the first", async ({ page }) => {
  await open(page, "n=30");
  await page.locator(".ag-body-vertical-scroll-viewport").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  const rows = await page.locator(".ag-row[row-id]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("row-id")!, top: e.getBoundingClientRect().top })));
  const spacer = rows.find((r) => r.id === "spacer:bulk-bar");
  expect(spacer).toBeTruthy();
  expect(spacer!.top).toBe(Math.max(...rows.map((r) => r.top)));
});
