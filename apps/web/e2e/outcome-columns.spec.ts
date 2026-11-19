import { expect, test, type Page } from "@playwright/test";

// The Outcome reviews columns (Ashu 2026-11-19): read-only, worked out from the 30, 60 and 90 day reviews. The harness puts the last row (R-12) in Roll-out since 2026-08-01
// with a key result from 10 to 110 and its 30 day review recorded (value 60, adoption 18%); every other row has no reviews.
const open = async (page: Page) => {
  await page.goto("/dev/grid?n=12&role=admin&gates=1&view=Outcomes");
  await page.waitForSelector(".ag-row");
};
const lastId = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { controller: { rows: { id: string }[] } } }).__pv.controller.rows.at(-1)!.id);
const cell = async (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);

test.describe("the Outcome reviews columns", () => {
  test("the Outcomes view shows them with full names, filled from the reviews", async ({ page }) => {
    await open(page);
    const heads = await page.locator(".ag-header-cell").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    for (const name of ["Outcome Review Date", "Outcome Reviews Recorded", "Realized KR Value", "% Realized KR Value", "Latest Adoption %", "KR Progress (latest review)"]) expect(heads).toContain(name);
    const id = await lastId(page);
    await expect(await cell(page, id, "outcome_review_date")).toHaveText(/30 Sep 2026|2026-09-30/); // the date follows the grid's date format
    await expect(await cell(page, id, "outcome_reviews_recorded")).toHaveText("1 of 3");
    await expect(await cell(page, id, "realized_kr_value")).toHaveText("60");
    await expect(await cell(page, id, "outcome_latest_adoption")).toHaveText("18");
    await expect(await cell(page, id, "kr_realized_pct")).toHaveText("54.5%"); // 60 of the target 110
    await expect(await cell(page, id, "outcome_kr_progress")).toHaveText("50");
  });

  test("a row that has not reached Roll-out has empty cells, and the columns cannot be edited", async ({ page }) => {
    await open(page);
    const first = await page.evaluate(() => (window as unknown as { __pv: { controller: { rows: { id: string }[] } } }).__pv.controller.rows[0]!.id);
    await expect(await cell(page, first, "outcome_reviews_recorded")).toHaveText("");
    const id = await lastId(page);
    await (await cell(page, id, "realized_kr_value")).dblclick();
    await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0);
  });
});
