import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=30&role=admin") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
};
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test.describe("roadmap head layout (0.22.0)", () => {
  test("Views is the last button of the view row, after All columns", async ({ page }) => {
    await open(page);
    const names = await page.locator(".view-row button").allInnerTexts();
    expect(names.at(-1)).toMatch(/^Views/);
    expect(names).toContain("All columns");
    expect(names.indexOf("All columns")).toBeLessThan(names.length - 1);
  });

  test("Filters, Columns and Export are on the same line as the saved-changes text", async ({ page }) => {
    await open(page);
    const saved = await box(page, ".strip-ok");
    for (const name of [/^Filters/, /^Columns/, /^Export$/]) {
      const b = (await page.getByRole("button", { name }).first().boundingBox())!;
      expect(Math.abs(b.y + b.height / 2 - (saved.y + saved.height / 2))).toBeLessThan(20);
    }
    await expect(page.locator(".page-head").getByRole("button", { name: /^Filters/ })).toHaveCount(0);
  });

  test("Import from spreadsheet sits on the Add an initiative line", async ({ page }) => {
    await open(page);
    const label = await box(page, ".quick-add-label");
    const imp = (await page.getByRole("button", { name: "Import from spreadsheet" }).boundingBox())!;
    expect(Math.abs(imp.y + imp.height / 2 - (label.y + label.height / 2))).toBeLessThan(20);
  });

  test("the add bar and the bulk bar sit above the grid and are as wide as it", async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 });
    await open(page);
    await page.locator('.ag-row[row-id] .ag-checkbox-input').first().check();
    const grid = await box(page, ".grid-wrap");
    for (const sel of [".quick-add", ".bulk-bar"]) {
      const b = await box(page, sel);
      expect(b.y + b.height).toBeLessThanOrEqual(grid.y + 0.5);
      expect(Math.abs(b.width - grid.width)).toBeLessThan(40);
    }
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(300);
    const grid2 = await box(page, ".grid-wrap");
    const quick2 = await box(page, ".quick-add");
    expect(Math.abs(quick2.width - grid2.width)).toBeLessThan(40);
  });

  test("keyboard shortcuts live under Help in the top bar, which can open the command palette", async ({ page }) => {
    await page.goto("/dev/item/R-01");
    await page.getByRole("button", { name: "Help" }).click();
    const dialog = page.getByRole("dialog", { name: /keyboard shortcuts/i });
    await expect(dialog).toContainText("Ctrl+K");
    await expect(dialog).toContainText("Alt+N");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await open(page);
    await expect(page.getByRole("button", { name: /^Commands/ })).toHaveCount(0);
    await expect(page.locator(".grid-foot")).not.toContainText("Alt+N");
  });
});
