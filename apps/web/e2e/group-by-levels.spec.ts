import AxeBuilder from "@axe-core/playwright";
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
    await expect(page.getByRole("button", { name: /^Columns:/ })).toHaveText(/Columns:\s*\d+ of 177 shown/);
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
  });

  test("the picker: Most used as pills, the other fields under the Columns picker's categories as tabs, each field once", async ({ page }) => {
    await open(page);
    await groupBtn(page).click();
    await expect(searchBox(page)).toBeFocused(); // the search box takes the focus when the panel opens
    const tabs = await page.locator(".gp-tab").allInnerTexts();
    expect(tabs[tabs.length - 1]).toBe("All"); // All is the last tab; the panel opens on the first category
    expect(tabs).toEqual(expect.arrayContaining(["What", "Who", "Why"]));
    await expect(page.getByRole("group", { name: "Most used fields" }).getByRole("menuitemradio")).toHaveCount(8);
    await expect(page.getByRole("menuitemradio", { name: "Build Status" })).toHaveCount(1);
    await expect(page.getByRole("menuitemradio", { name: "Roadmap Category" })).toHaveCount(1); // shown again since 2026-11-18 (What)
    await expect(page.getByRole("menuitemradio", { name: "Focus Area" })).toHaveCount(1); // the first category (What)
    await expect(page.getByRole("menuitemradio", { name: "Business Owner" })).toHaveCount(0);
    await page.getByRole("button", { name: "Who", exact: true }).click(); // a tab narrows the grid to its category
    await expect(page.getByRole("menuitemradio", { name: "Business Owner" })).toHaveCount(1);
    await expect(page.getByRole("menuitemradio", { name: "Focus Area" })).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("menuitemradio", { name: "Business Owner" })).toHaveCount(1);
    await expect(page.getByRole("menuitemradio", { name: "Focus Area" })).toHaveCount(1);
  });

  test("the panel keeps its footer in reach: it is no taller than the visible window, and its body scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 600 });
    await open(page);
    await groupBtn(page).click();
    const panel = page.locator(".gp");
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(600);
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
    expect(await page.locator(".gp-body").evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
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

  test("the fold button steps through the levels: close the second, close the first, open the first, open the second, then again (issue #663)", async ({ page }) => {
    await open(page);
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await searchBox(page).fill("moscow");
    await page.keyboard.press("Enter");
    await btn(page, "Apply").click();
    const main = page.locator(".group-row[data-level='0']");
    const sub = page.locator(".group-row[data-level='1']");
    const rows = page.locator(".ag-row:not(.ag-full-width-row)");
    const fold = page.getByRole("button", { name: /^(Collapse|Expand) level/ });
    await expect(fold).toHaveAccessibleName("Collapse level 2 (sub-groups)");
    await expect(sub.first()).toBeVisible();
    await expect(rows.first()).toBeVisible();
    await fold.click(); // 1. the sub-groups fold: their rows go, the sub-headers stay
    await expect(rows).toHaveCount(0);
    await expect(sub.first()).toBeVisible();
    await expect(fold).toHaveAccessibleName("Collapse level 1 (groups)");
    await fold.click(); // 2. the groups fold: the sub-headers go too
    await expect(sub).toHaveCount(0);
    await expect(main.first()).toBeVisible();
    await expect(fold).toHaveAccessibleName("Expand level 1 (groups)");
    await fold.click(); // 3. the groups open: the sub-headers show, still folded
    await expect(sub.first()).toBeVisible();
    await expect(rows).toHaveCount(0);
    await expect(fold).toHaveAccessibleName("Expand level 2 (sub-groups)");
    await fold.click(); // 4. the sub-groups open: everything is back
    await expect(rows.first()).toBeVisible(); // the rows are back (the grid only draws the ones in view)
    await expect(fold).toHaveAccessibleName("Collapse level 2 (sub-groups)"); // and it reverses
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
    await expect(chip).toContainText("4 issues");
    await expect(chip).toContainText("1 To Do · 1 In Progress · 2 Done"); // the issues in words, no separate header row
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
    await expect(chip).toContainText("4 issues"); // the chip stays
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
    await expect(page.locator('.ag-row[row-id="item-1"] .issue-chip')).toContainText("4 issues");
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

  test("choose what to show: the issue types with counts, only the ticked ones are listed; the chip says how many are hidden", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).check();
    const types = page.getByRole("group", { name: "Issue types" });
    await expect(types.getByRole("button", { name: /^(✓ )?Feature/ })).toContainText("1");
    await expect(types.getByRole("button", { name: /^(✓ )?Task/ })).toContainText("1");
    await types.getByRole("button", { name: /Task/ }).click();
    await expect(types.getByRole("button", { name: /Task/ })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".issue-row")).toHaveCount(0); // staged: nothing changes before Apply
    await btn(page, "Apply").click();
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toBeVisible();
    await expect(page.locator(".issue-row", { hasText: "SCRUM-18" })).toHaveCount(0);
    await expect(page.locator('.ag-row[row-id="item-1"] .issue-chip')).toHaveAttribute("aria-label", /3 issues.*1 hidden by the filter/);
    await expect(groupBtn(page)).toContainText("with issues");
    // the last type cannot be unticked, and Everything puts them all back (the test issues have three types: Feature, Sub-task and Task)
    await groupBtn(page).click();
    await types.getByRole("button", { name: /Sub-task/ }).click();
    await expect(types.getByRole("button", { name: /Sub-task/ })).toHaveAttribute("aria-pressed", "false");
    await expect(types.getByRole("button", { name: /Feature/ })).toHaveAttribute("aria-pressed", "true");
    await types.getByRole("button", { name: /Feature/ }).click();
    await expect(types.getByRole("button", { name: /Feature/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Everything", exact: true }).click();
    await expect(types.getByRole("button", { name: /Task/ })).toHaveAttribute("aria-pressed", "true");
    await btn(page, "Apply").click();
    await expect(page.locator(".issue-row", { hasText: "SCRUM-18" })).toBeVisible();
  });

  test("Hide Done and Cancelled leaves out the finished issues, and Cancel keeps what was set", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).check();
    await page.getByLabel("Hide Done and Cancelled").check();
    await btn(page, "Cancel").click();
    await expect(groupBtn(page)).toHaveText(/Group by:\s*None/);
    await groupBtn(page).click();
    await page.getByLabel(/Show issues under each initiative/).check();
    await page.getByLabel("Hide Done and Cancelled").check();
    await expect(page.locator(".gp-head")).toContainText("hiding Done and Cancelled");
    await btn(page, "Apply").click();
    await expect(page.locator(".issue-row", { hasText: "SCRUM-17" })).toBeVisible(); // In Progress stays
    await expect(page.locator(".issue-row", { hasText: "SCRUM-18" })).toHaveCount(0); // Done is hidden
    await groupBtn(page).click();
    await expect(page.getByLabel("Hide Done and Cancelled")).toBeChecked(); // reopened with what was applied
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

  test("a grouped grid, and one with issues under the initiatives, has no accessibility violations (group rows and issue rows are cells of a row)", async ({ page }) => {
    await open(page, "&jira=1");
    await groupBtn(page).click();
    await pick(page, "Build Status");
    await page.getByLabel(/Show issues under each initiative/).check();
    await btn(page, "Apply").click();
    await expect(page.locator(".group-row").first()).toBeVisible();
    await expect(page.locator(".issue-row").first()).toBeVisible();
    // AG Grid keeps a full-width row that is below the visible area as an empty placeholder until it scrolls into view (virtualisation), so only the rows that
    // are drawn are checked: every group row and every issue row on screen must be a proper cell of its row.
    const placeholder = /<div class="ag-full-width-anchor" role="presentation"><\/div><\/div>$/; // a row whose only child is the empty anchor
    const r = await new AxeBuilder({ page }).include(".grid-wrap").analyze();
    const found = r.violations.flatMap((v) => v.nodes.filter((n) => !placeholder.test(n.html.trim())).map((n) => v.id + ": " + n.target.join(" ")));
    expect(found).toEqual([]);
  });
});

test.describe("Tracker columns: the lock is in the header, the words follow the tracker", () => {
  test("a Jira workspace says 'from Jira' in the header; no row carries a lock icon", async ({ page }) => {
    await page.goto("/dev/grid?n=12&role=admin&view=Delivery&jira=1");
    await page.waitForSelector(".ag-row");
    const header = page.locator(".ag-header-cell", { hasText: "Build Status" });
    await expect(header).toContainText("from Jira");
    await expect(header.getByRole("img", { name: "Read only" })).toBeVisible();
    await expect(page.locator(".ag-body .lock-cell svg")).toHaveCount(0);
    await expect(page.locator(".grid-foot")).toContainText("values come from Jira");
  });
});
