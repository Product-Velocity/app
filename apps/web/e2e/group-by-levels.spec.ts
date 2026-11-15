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

  test("staged: a click that drops the focus (Safari and Firefox on a Mac, a list that re-renders) does not close the panel or lose the choices", async ({ page }) => {
    await open(page);
    // the focus is dropped just after the button is released, for every click inside the panel
    await page.evaluate(() => { document.addEventListener("click", (e) => { if ((e.target as Element).closest(".gp")) setTimeout(() => { const a = document.activeElement as HTMLElement | null; if (a && a !== document.body) a.blur(); }, 0); }, true); });
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await pick(page, "Health");
    await page.getByLabel(/Show issues under each initiative/).check();
    await page.waitForTimeout(300);
    await expect(searchBox(page)).toBeVisible(); // still open
    await expect(page.locator(".gp-slot").nth(0)).toContainText("Build Status");
    await expect(page.locator(".gp-slot").nth(1)).toContainText("Health");
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/Build Status › Health\s*· with issues/);
    // a click outside still closes it without applying
    await groupBtn(page).click();
    await pick(page, "MoSCoW");
    await page.getByRole("heading", { level: 1 }).first().click({ force: true });
    await expect(searchBox(page)).toHaveCount(0);
    await expect(groupBtn(page)).toHaveText(/Build Status › Health/);
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

  test("Show issues (a checkbox, staged with Apply): the initiative keeps its row, its issues sit under it, and a chip on its name folds and unfolds them", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).check();
    await expect(page.locator(".issue-row")).toHaveCount(0); // not applied yet
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toContainText("with issues");
    const parent = page.locator('.ag-row[row-id="item-1"]');
    await expect(parent).toBeVisible(); // the initiative stays a data row
    const chip = parent.locator(".issue-chip");
    await expect(chip).toContainText("2 issues");
    await expect(chip).toContainText("1 In Progress · 1 Done"); // the issues in words, no separate header row
    await expect(page.locator(".group-row")).toHaveCount(0);
    const row = page.locator(".issue-row", { hasText: "SCRUM-17" });
    await expect(row).toContainText("Import flow");
    await expect(row.getByRole("link", { name: "SCRUM-17" })).toHaveAttribute("href", /atlassian\.net\/browse\/SCRUM-17/);
    expect(await page.locator(".issue-row .ag-checkbox-input").count()).toBe(0); // issue rows are not selectable
    // fold and unfold this initiative's issues
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await chip.click();
    await expect(row).toHaveCount(0);
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await expect(chip).toContainText("2 issues"); // the chip stays
    await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0); // a click on the chip does not start editing the name
    await chip.click();
    await expect(row).toBeVisible();
    // turning it off removes the chips and the rows
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).uncheck();
    await btn(page, "Apply").click();
    await expect(page.locator(".issue-row")).toHaveCount(0);
    await expect(page.locator(".issue-chip")).toHaveCount(0);
  });

  test("Show issues lines the issues up with the grid columns: key under Initiative ID, type and title under Initiative Name, behind a branch line", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).check();
    await btn(page, "Apply").click();
    const row = page.locator(".issue-row", { hasText: "SCRUM-17" });
    await expect(row).toBeVisible();
    const grid = (await page.getByTestId("grid").boundingBox())!;
    const idHead = (await page.locator('.ag-header-cell[col-id="item_code"]').boundingBox())!;
    const nameHead = (await page.locator('.ag-header-cell[col-id="initiative_name"]').boundingBox())!;
    const key = (await row.locator(".issue-key").boundingBox())!;
    const type = (await row.locator(".issue-type").boundingBox())!;
    const branch = (await row.locator(".issue-branch").boundingBox())!;
    expect(Math.abs(key.x - idHead.x)).toBeLessThan(16); // the key is under the Initiative ID column
    expect(key.x + key.width).toBeLessThan(nameHead.x); // and ends before the name column
    expect(branch.x).toBeGreaterThanOrEqual(nameHead.x); // the branch line and the type start inside the name column
    expect(type.x).toBeGreaterThan(branch.x);
    expect(type.x).toBeLessThan(nameHead.x + 40);
    expect(grid.x).toBeLessThan(idHead.x);
    // the second issue is the last: its branch stops halfway, the first one's runs through
    const first = (await row.locator(".issue-branch").boundingBox())!;
    const lastRow = page.locator(".issue-row", { hasText: "SCRUM-18" });
    const last = (await lastRow.locator(".issue-branch").boundingBox())!;
    expect(last.height).toBeLessThan(first.height - 5);
    // when the name column is widened the issues follow it
    const before = (await row.locator(".issue-status").boundingBox())!.x;
    const handle = page.locator('.ag-header-cell[col-id="initiative_name"] .ag-header-cell-resize');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 80, hb.y + hb.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await row.locator(".issue-status").boundingBox())!.x).toBeGreaterThan(before + 40);
  });

  test("Show issues works under Group by and Then by; Cancel leaves it as it was", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await pick(page, "MoSCoW");
    await pick(page, "Health");
    await page.getByLabel(/Show issues under each initiative/).check();
    await btn(page, "Cancel").click();
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
    await groupBtn(page).click();
    await pick(page, "MoSCoW");
    await pick(page, "Health");
    await page.getByLabel(/Show issues under each initiative/).check();
    await btn(page, "Apply").click();
    await expect(groupBtn(page)).toHaveText(/MoSCoW › Health\s*· with issues/);
    await expect(page.locator(".group-row[data-level='0']").first()).toBeVisible();
    await expect(page.locator(".group-row[data-level='1']").first()).toBeVisible();
    await expect(page.locator('.ag-row[row-id="item-1"] .issue-chip')).toContainText("2 issues");
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toBeVisible();
  });

  test("Show issues works for GitHub issues too", async ({ page }) => {
    await open(page, "&gh=1");
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).check();
    await btn(page, "Apply").click();
    await expect(page.locator(".issue-chip").first()).toBeVisible();
    await expect(page.locator(".issue-row").first()).toBeVisible();
    await expect(page.locator(".issue-row").first().locator(".issue-key")).toContainText("#");
  });

  test("the palette folds and unfolds every initiative's issues at once", async ({ page }) => {
    await open(page, "&jira=1");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("show issues");
    await page.keyboard.press("Enter");
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toBeVisible();
    await page.keyboard.press("Control+K");
    await page.keyboard.type("collapse all issues");
    await page.keyboard.press("Enter");
    await expect(page.locator(".issue-row")).toHaveCount(0);
    await expect(page.locator('.ag-row[row-id="item-1"] .issue-chip')).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("expand all issues");
    await page.keyboard.press("Enter");
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toBeVisible();
  });

  test("the command palette has Then by and Show issues", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("group by health");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("then by moscow");
    await page.keyboard.press("Enter");
    await expect(groupBtn(page)).toHaveText(/Health › MoSCoW/);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("show issues");
    await page.keyboard.press("Enter");
    await expect(groupBtn(page)).toContainText("with issues");
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toHaveCount(0); // not the jira harness: no issues to show here
    await expect(page.locator(".issue-chip")).toHaveCount(0);
  });
});
