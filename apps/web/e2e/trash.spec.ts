import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=12&role=admin") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const select = async (page: Page, ...ids: string[]) => {
  for (const id of ids) await page.locator(`.ag-row[row-id="${id}"] input[type="checkbox"]`).first().check();
};
const bar = (page: Page) => page.getByRole("region", { name: /Bulk actions/ });
const rowIds = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { controller: { rows: { id: string; stack_rank: number }[] } } }).__pv.controller.rows.map((r) => `${r.id}:${r.stack_rank}`));
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);

test.describe("delete, undo and the Trash", () => {
  test("select 3, delete, undo, delete again: confirmation, ranks, status line", async ({ page }) => {
    await open(page);
    await select(page, "item-2", "item-4", "item-6");
    await bar(page).getByRole("button", { name: "Delete…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete 3 initiatives?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("R-02 Initiative number 2");
    await expect(dialog).toContainText("R-06");
    await expect(dialog).toContainText("restore them for 30 days");
    await dialog.getByRole("button", { name: "Delete 3 initiatives" }).click();
    for (const id of ["item-2", "item-4", "item-6"]) await expect(page.locator(`.ag-row[row-id="${id}"]`)).toHaveCount(0);
    await expect(page.locator(".strip")).toContainText("Deleted 3 items");
    expect(await rowIds(page)).toEqual(["item-1:1", "item-3:2", "item-5:3", "item-7:4", "item-8:5", "item-9:6", "item-10:7", "item-11:8", "item-12:9"]);
    await settle(page);
    await page.keyboard.press("Control+z");
    await expect(page.locator(`.ag-row[row-id="item-4"]`)).toHaveCount(1);
    await expect(page.locator(".strip")).toContainText("Undid: Deleted 3 items");
    expect(await rowIds(page)).toEqual(Array.from({ length: 12 }, (_, i) => `item-${i + 1}:${i + 1}`));
    await page.keyboard.press("Control+Shift+z");
    await expect(page.locator(`.ag-row[row-id="item-4"]`)).toHaveCount(0);
    await settle(page);
  });

  test("Delete on the checkbox column asks first; Escape keeps everything; Delete on an editable cell still clears the cell", async ({ page }) => {
    await open(page);
    await select(page, "item-3");
    await page.locator(`.ag-row[row-id="item-3"] input[type="checkbox"]`).first().focus();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("dialog", { name: "Delete 1 initiative?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`.ag-row[row-id="item-3"]`)).toHaveCount(1);
    await expect(page.locator(".ag-cell-focus")).toBeVisible(); // focus is back on the grid
    // an editable cell keeps its old meaning
    await page.locator(`.ag-row[row-id="item-3"] [col-id="moscow"]`).click();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(`.ag-row[row-id="item-3"] [col-id="moscow"]`)).toHaveText("");
  });

  test("a creator can only delete what they added; the others are named as staying", async ({ page }) => {
    await open(page, "n=12&role=creator");
    await select(page, "item-1", "item-2", "item-3"); // 1 and 3 were added by the signed-in test user, 2 by someone else
    await bar(page).getByRole("button", { name: "Delete…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete 2 initiatives?" });
    await expect(dialog).toContainText("1 initiative was added by someone else, so it stays");
    await dialog.getByRole("button", { name: "Delete 2 initiatives" }).click();
    await expect(page.locator(`.ag-row[row-id="item-1"]`)).toHaveCount(0);
    await expect(page.locator(`.ag-row[row-id="item-2"]`)).toHaveCount(1);
    await settle(page);
  });

  test("a creator who selected only other people's items is told nothing can be deleted", async ({ page }) => {
    await open(page, "n=12&role=creator");
    await select(page, "item-2", "item-4");
    await bar(page).getByRole("button", { name: "Delete…" }).click();
    await expect(page.getByRole("dialog", { name: "Nothing to delete" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(`.ag-row[row-id="item-2"]`)).toHaveCount(1);
  });

  test("viewers and leadership see no delete button and cannot delete with the keyboard", async ({ page }) => {
    for (const role of ["viewer", "leadership"]) {
      await open(page, `n=8&role=${role}`);
      await select(page, "item-1");
      await expect(bar(page)).toBeVisible();
      await expect(bar(page).getByRole("button", { name: "Delete…" })).toHaveCount(0);
      await page.locator(`.ag-row[row-id="item-1"] input[type="checkbox"]`).first().focus();
      await page.keyboard.press("Delete");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("the command palette deletes the selection", async ({ page }) => {
    await open(page);
    await select(page, "item-5");
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("delete");
    await expect(palette.getByRole("option", { name: /Delete 1 selected initiative/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Delete 1 initiative?" })).toBeVisible();
    await page.getByRole("button", { name: "Delete 1 initiative" }).click();
    await expect(page.locator(`.ag-row[row-id="item-5"]`)).toHaveCount(0);
    await settle(page);
  });

  test("the item panel has a Delete button that closes the panel", async ({ page }) => {
    await open(page);
    await page.locator(`.ag-row[row-id="item-3"] [col-id="item_code"]`).click();
    const panel = page.getByTestId("item-panel");
    await panel.getByRole("button", { name: "Delete…" }).click();
    await page.getByRole("dialog", { name: "Delete 1 initiative?" }).getByRole("button", { name: "Delete 1 initiative" }).click();
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
    await expect(page.locator(`.ag-row[row-id="item-3"]`)).toHaveCount(0);
    await settle(page);
  });

  test("the delete confirmation has no accessibility violations", async ({ page }) => {
    await open(page);
    await select(page, "item-1", "item-2");
    await bar(page).getByRole("button", { name: "Delete…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});

test.describe("Trash page", () => {
  const trash = async (page: Page, role = "admin") => {
    await page.goto(`/dev/trash?role=${role}`);
    await page.waitForSelector(".trash-table");
  };

  test("lists who deleted what and when, with the days left; restore one item", async ({ page }) => {
    await trash(page);
    const rows = page.locator(".trash-table tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "R-02" })).toContainText("ana@example.test");
    await expect(rows.filter({ hasText: "R-02" })).toContainText("13 Apr 2027");
    await expect(rows.filter({ hasText: "R-02" })).toContainText("29 days");
    await page.getByRole("button", { name: /Restore R-02/ }).click();
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole("status").filter({ hasText: "Restored 1 initiative at their old rank." })).toBeVisible();
  });

  test("restore several at once", async ({ page }) => {
    await trash(page);
    await page.getByLabel("Select all deleted initiatives").check();
    await page.getByRole("button", { name: /^Restore 4 selected/ }).click();
    await expect(page.getByText("The Trash is empty.")).toBeVisible();
  });

  test("delete forever is for admins and needs the words typed", async ({ page }) => {
    await trash(page);
    await page.getByLabel(/Select R-05/).check();
    await page.getByRole("button", { name: "Delete forever…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete 1 initiative forever?" });
    await expect(dialog).toBeVisible();
    const go = dialog.getByRole("button", { name: "Delete forever" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Type delete forever/).fill("delete");
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Type delete forever/).fill("delete forever");
    await go.click();
    await expect(page.locator(".trash-table tbody tr")).toHaveCount(3);
    await expect(page.getByText("Deleted 1 initiative forever.")).toBeVisible();
  });

  test("a creator can restore but has no delete forever; a viewer cannot see the Trash", async ({ page }) => {
    await trash(page, "creator");
    await expect(page.getByRole("button", { name: /Restore/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete forever…" })).toHaveCount(0);
    await page.goto("/dev/trash?role=viewer");
    await expect(page.getByText("Only creators and admins can see the Trash.")).toBeVisible();
  });

  test("the Trash page has no accessibility violations", async ({ page }) => {
    await trash(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
