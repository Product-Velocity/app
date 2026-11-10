import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #393: the Alignment tab of the item panel and the Crowd columns of the grid (in-memory test data, fictional).
const open = async (page: Page, query = "n=40") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const cell = (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);
const panel = (page: Page) => page.getByTestId("item-panel");

test("the Alignment tab shows the current result, why groups disagree and the earlier session", async ({ page }) => {
  await open(page);
  await cell(page, "item-1", "item_code").click();
  await panel(page).getByRole("tab", { name: "Alignment" }).click();
  const tab = panel(page).locator(".ip-alignment");
  await expect(tab.getByRole("heading", { name: /Current result/ })).toContainText("Q1 priorities");
  await expect(tab).toContainText("2 of 8");
  await expect(tab).toContainText("88.5");
  await expect(tab).toContainText("Contested: Sales rate it high, Engineering low (gap 55 of 100).");
  await expect(tab.getByRole("heading", { name: "Earlier sessions" })).toBeVisible();
  await expect(tab).toContainText("Q4 planning");
  await expect(tab).toContainText("Place 3 of 8 · score 64.3 · 9 voted");
  await expect(tab).not.toContainText("@"); // no name or address anywhere
  await panel(page).screenshot({ path: "../../docs/screenshots/393-alignment-tab.png" });
  const axe = await new AxeBuilder({ page }).include('[data-testid="item-panel"]').analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("a tie is written with =, and an initiative without a result says so", async ({ page }) => {
  await open(page);
  await cell(page, "item-2", "item_code").click();
  await panel(page).getByRole("tab", { name: "Alignment" }).click();
  await expect(panel(page).locator(".ip-alignment")).toContainText("=3 of 8");
  await expect(panel(page).locator(".ip-alignment")).toContainText("(tied)");
  await expect(panel(page).locator(".ip-alignment")).toContainText("has been in one session so far");
  await cell(page, "item-4", "item_code").click();
  await expect(panel(page).getByText("No alignment result to show yet.")).toBeVisible();
});

test("the Crowd Rank column shows the latest result, is empty without one and cannot be edited; the keyboard reaches the tab", async ({ page }) => {
  await open(page, "n=40&role=admin&view=Prioritisation&cols=all");
  await page.getByRole("button", { name: /columns shown$/ }).click();
  const columns = page.getByRole("group", { name: "Choose columns" });
  await columns.getByRole("button", { name: /^Alignment/ }).click();
  await columns.getByRole("checkbox", { name: /Crowd Rank/ }).check();
  await page.getByRole("button", { name: /^Apply columns/ }).click();
  await page.getByRole("button", { name: /columns shown$/ }).scrollIntoViewIfNeeded();
  await page.evaluate(() => (document.querySelector('.ag-body-horizontal-scroll-viewport') as HTMLElement | null)?.scrollTo({ left: 100000 }));
  await expect(cell(page, "item-1", "crowd_rank")).toHaveText("2");
  await expect(cell(page, "item-2", "crowd_rank")).toHaveText("3");
  await expect(cell(page, "item-4", "crowd_rank")).toHaveText("");
  const values = await page.evaluate(() => (window as unknown as { __pv: { controller: { row: (id: string) => Record<string, unknown> } } }).__pv.controller.row("item-1"));
  expect(values).toMatchObject({ crowd_rank: 2, crowd_score: 88.5, crowd_consensus: 45, crowd_votes: 14 });
  await cell(page, "item-1", "crowd_rank").dblclick();
  await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0); // computed: cannot be edited
  await page.screenshot({ path: "../../docs/screenshots/393-crowd-rank-column.png", clip: { x: 0, y: 0, width: 1600, height: 460 } });
  // keyboard: arrow keys move along the tabs of the panel
  await cell(page, "item-1", "item_code").click();
  await panel(page).getByRole("tab", { name: "Overview" }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(panel(page).getByRole("tab", { name: "Alignment" })).toHaveAttribute("aria-selected", "true");
});
