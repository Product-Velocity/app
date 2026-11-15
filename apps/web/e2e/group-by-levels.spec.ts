import { expect, test, type Page } from "@playwright/test";

// Group by in two levels, the categorised picker, issues under initiatives, staged like Columns (issue #437)
const open = async (page: Page, extra = "") => {
  await page.goto(`/dev/grid?n=40&view=Prioritisation${extra}`);
  await page.waitForSelector(".ag-row");
};
const groupBtn = (page: Page) => page.getByRole("button", { name: /^Group by:/ });
const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const pick = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true }).click();
const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search group by options" });

test.describe("Group by: picker, two levels, issues", () => {
  test("the head buttons say their state: Filter, Columns, Group by", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: /^Filter:/ })).toHaveText(/Filter:\s*None/);
    await expect(page.getByRole("button", { name: /^Columns:/ })).toHaveText(/Columns:\s*\d+ of 168 shown/);
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
  });

  test("the picker lists fields under the Columns picker's categories, Common first, each field once", async ({ page }) => {
    await open(page);
    await groupBtn(page).click();
    const cats = await page.locator(".gp-cat").allInnerTexts();
    expect(cats[0]).toBe("COMMON");
    expect(cats).toEqual(expect.arrayContaining(["WHAT", "WHO", "WHY"]));
    await expect(page.getByRole("menuitemradio", { name: "Build Status" })).toHaveCount(1);
    await expect(page.getByRole("menuitemradio", { name: "Roadmap Category" })).toHaveCount(0); // hidden in the app
  });

  test("staged: the panel stays open while you choose, nothing changes until Apply, Cancel discards", async ({ page }) => {
    await open(page);
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await expect(searchBox(page)).toBeVisible(); // still open
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/); // not applied
    await expect(page.locator(".group-row")).toHaveCount(0);
    await expect(page.locator(".gp-slot").first()).toContainText("Build Status");
    await btn(page, "Cancel").click();
    await expect(searchBox(page)).toHaveCount(0);
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
    await expect(page.locator(".group-row")).toHaveCount(0);
    // Escape discards too
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await page.keyboard.press("Escape");
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
    // Apply puts it in the grid and closes
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await btn(page, "Apply").click();
    await expect(searchBox(page)).toHaveCount(0);
    await expect(groupBtn(page)).toHaveText(/Group by:\s*Build Status/);
    await expect(page.locator(".group-row").first()).toBeVisible();
  });

  test("two levels in one visit; sub-headers are indented; collapsing a parent hides them; Clear and Apply remove the grouping", async ({ page }) => {
    await open(page);
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await expect(page.locator(".gp-slot").nth(1)).toHaveAttribute("data-active", "true"); // the next pick fills Then by
    await searchBox(page).fill("moscow");
    await page.keyboard.press("Enter");
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/Build Status › MoSCoW/);
    await expect(page.locator(".group-row[data-level='1']").first()).toBeVisible();
    await expect(page.locator(".grid-foot")).toContainText("Grouped by Build Status, then MoSCoW");
    // collapsing the main group hides the sub-groups inside it (the sub-header of "Not started" with 4 Must items)
    const sub = page.locator(".group-row[data-level='1']", { hasText: /Must\s*4 items/ });
    await expect(sub).toHaveCount(1);
    await page.getByRole("button", { name: "Collapse group Not started" }).click();
    await expect(page.getByRole("button", { name: "Expand group Not started" })).toHaveAttribute("aria-expanded", "false");
    await expect(sub).toHaveCount(0);
    await page.getByRole("button", { name: "Expand group Not started" }).click();
    await expect(sub).toHaveCount(1);
    await groupBtn(page).click();
    await expect(page.getByRole("menuitemradio", { name: "MoSCoW" })).toHaveCount(0); // the field of the other level is not offered twice
    await expect(page.getByRole("menuitemradio", { name: "Build Status" })).toHaveAttribute("aria-checked", "true");
    await btn(page, "Clear").click();
    await expect(groupBtn(page)).toHaveText(/Group by:\s*Build Status › MoSCoW/); // Clear is staged too
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
    await expect(page.locator(".group-row")).toHaveCount(0);
  });

  test("removing the main level promotes the second one", async ({ page }) => {
    await open(page);
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await pick(page, "MoSCoW");
    await page.getByRole("button", { name: "Remove Group by Build Status" }).click();
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/Group by:\s*MoSCoW$/);
  });

  test("Group by Initiative, with its issues: each initiative is a header with its Jira issues nested beneath it", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await pick(page, "Initiative, with its issues");
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/Group by:\s*Initiative, with its issues/);
    const header = page.locator(".group-row[data-kind='initiative']", { hasText: "R-01" });
    await expect(header).toBeVisible();
    await expect(header).toContainText("2 issues");
    await expect(header).toContainText("1 In Progress · 1 Done"); // the issues in words
    const row = page.locator(".issue-row", { hasText: "SCRUM-17" });
    await expect(row).toContainText("Import flow");
    await expect(row.getByRole("link", { name: "SCRUM-17" })).toHaveAttribute("href", /atlassian\.net\/browse\/SCRUM-17/);
    expect(await page.locator(".issue-row .ag-checkbox-input").count()).toBe(0); // issue rows are not selectable
    // the initiative's header collapses its issues
    await page.getByRole("button", { name: /^Collapse group R-01/ }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: /^Expand group R-01/ }).click();
    await expect(row).toBeVisible();
    // nothing can follow it as the main level
    await groupBtn(page).click();
    await expect(page.locator(".gp-slot").nth(1).getByRole("button").first()).toBeDisabled();
  });

  test("the initiative level can be the second level, inside another group", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await pick(page, "MoSCoW");
    await pick(page, "Initiative, with its issues");
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/MoSCoW › Initiative, with its issues/);
    await expect(page.locator(".group-row[data-level='1'][data-kind='initiative']").first()).toBeVisible();
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toBeVisible();
  });

  test("the initiative level works for GitHub issues too", async ({ page }) => {
    await open(page, "&gh=1");
    await groupBtn(page).click();
    await pick(page, "Initiative, with its issues");
    await btn(page, "Apply").click();
    await expect(page.locator(".issue-row").first()).toBeVisible();
    await expect(page.locator(".issue-row").first().locator(".issue-key")).toContainText("#");
  });

  test("the command palette has Then by", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("group by health");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("then by moscow");
    await page.keyboard.press("Enter");
    await expect(groupBtn(page)).toHaveText(/Health › MoSCoW/);
  });
});
