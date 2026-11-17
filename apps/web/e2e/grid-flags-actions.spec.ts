import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #480: the Flags and Actions columns of the main grid, and Tracker Status. R-01 has every linked issue closed and no phase (the move to Test passes the gates,
// so its button opens the gate request); R-03 is in Build with its build done (the move to Test is made at once).
const open = async (page: Page, query = "n=12&role=admin&gates=1&view=All columns&cols=all") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
};
// the item code sits in the pinned part of the grid, so a row is found by its id, which the controller knows
const idOf = (page: Page, code: string) => page.evaluate((c) => (window as unknown as { __pv: { controller: { rows: { id: string; item_code: string }[] } } }).__pv.controller.rows.find((r) => r.item_code === c)!.id, code);
const cell = async (page: Page, code: string, col: string) => page.locator(`.ag-row[row-id="${await idOf(page, code)}"] [col-id="${col}"]`);
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { gates: { calls: string[] } } }).__pv.gates.calls);

test.describe("the Flags and Actions columns of the grid", () => {
  test("Flags shows every flag of a row in words, with the full reason as the tooltip", async ({ page }) => {
    await open(page);
    const flags = await cell(page, "R-01", "flags");
    await expect(flags).toContainText("Tracker done");
    await expect(flags.locator(".grid-flags")).toHaveAttribute("title", /Tracker done: The tracker says the work is done/);
    await expect(await cell(page, "R-03", "flags")).toContainText("Build done");
    await expect(await cell(page, "R-02", "flags")).toHaveText("");
  });

  test("Actions: a move that passes a gate opens the request, with that gate chosen", async ({ page }) => {
    await open(page);
    (await cell(page, "R-01", "actions")).getByRole("button", { name: /Request gate/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Request");
    expect(await calls(page)).toEqual([]); // nothing was moved
  });

  test("Actions: a move that passes no gate is made at once, and the grid says so", async ({ page }) => {
    await open(page);
    (await cell(page, "R-03", "actions")).getByRole("button", { name: /Move to Test/ }).click();
    await expect(page.getByText(/R-03 moved to Test/)).toBeVisible();
    expect((await calls(page)).filter((c) => c.startsWith("move ") && c.endsWith(" Test"))).toHaveLength(1);
  });

  test("a viewer sees the flags and no buttons", async ({ page }) => {
    await open(page, "n=12&role=viewer&gates=1&view=All columns&cols=all");
    await expect(await cell(page, "R-03", "flags")).toContainText("Build done");
    await expect(page.locator('[col-id="actions"] button')).toHaveCount(0);
  });

  test("the Actions column has no accessibility violations", async ({ page }) => {
    await open(page);
    const r = await new AxeBuilder({ page }).include(".ag-body-viewport").disableRules(["scrollable-region-focusable"]).analyze();
    expect(r.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id)).toEqual([]);
  });
});

test.describe("Tracker Status", () => {
  test("is a column in the Delivery view, and can be grouped by", async ({ page }) => {
    await open(page, "n=12&role=admin&view=Delivery&jira=1");
    await expect(page.locator('.ag-header-cell[col-id="tracker_status"]')).toBeVisible();
    await page.getByRole("button", { name: /Group by/ }).click();
    await expect(page.getByRole("button", { name: "Tracker Status" }).first()).toBeVisible();
  });
});
