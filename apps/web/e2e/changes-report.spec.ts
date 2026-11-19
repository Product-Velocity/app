import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Changes report (issue #472): the test page /dev/reports?demo=changes has three initiatives with changes today (fictional data).
const open = async (page: Page) => {
  await page.goto("/dev/reports?report=changes&demo=changes");
  await page.waitForSelector("[data-testid=changes-grid] .ag-row");
};
const grid = (page: Page) => page.locator("[data-testid=changes-grid]");
const bar = (page: Page, name: RegExp) => page.getByRole("region", { name: "Changes tools" }).getByRole("button", { name });

test.describe("Changes report", () => {
  test("lists the changes of today grouped by initiative, newest first, with a count, whether the initiative moved, and flags to follow up", async ({ page }) => {
    await open(page);
    const heads = grid(page).locator(".group-row");
    await expect(heads).toHaveCount(3);
    await expect(heads.nth(0)).toContainText("R-03");
    await expect(heads.nth(0)).toContainText("Initiative: Health");
    await expect(heads.nth(0)).toContainText("⚑ Stale issues");
    await expect(heads.nth(1)).toContainText("R-01");
    await expect(heads.nth(1)).toContainText("2 changes"); // the Jira move and the Build Status that went with it are one row
    await expect(heads.nth(1)).toContainText("1 linked-issue change");
    await expect(heads.nth(1)).toContainText("⚑ Tracker done, initiative open"); // a Jira-style initiative: tracker done, no phase, no status
    await expect(heads.nth(2)).toContainText("Initiative unchanged"); // only its linked issue changed
    await expect(page.getByText("3 initiatives changed, 3 to follow up.")).toBeVisible();
  });

  test("Source says where the value came from, Source type how it arrived, and a person on a tracker value only ran the Sync", async ({ page }) => {
    await open(page);
    const headers = await grid(page).locator(".ag-header-cell-text").allInnerTexts();
    expect(headers.indexOf("Source")).toBeGreaterThan(-1);
    expect(headers.indexOf("Source type")).toBe(headers.indexOf("Source") + 1); // Source sits in front of Source type
    const row = (type: string) => grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: type });
    await expect(row("Health").first()).toContainText("Product Velocity");
    await expect(row("Linked issue (Jira)")).toContainText("Jira");
    await expect(row("Linked issue (GitHub)")).toContainText("GitHub");
    await expect(row("Linked issue (GitHub)")).toContainText("GitHub webhook"); // the source type
    // Build Status is the tracker's value: the person only pressed Sync (they must not read as the one who changed it)
    await expect(row("Linked issue (Jira)")).toContainText("Sync run by");
    await expect(row("Health").first()).not.toContainText("Sync run by");
  });

  test("a tracker move is one row: the linked-issue status and the Build Status that went with it, with the Jira user", async ({ page }) => {
    await open(page);
    const jira = grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "Linked issue (Jira)" });
    await expect(jira).toHaveCount(1); // not one row for the status and another for the Build Status
    await expect(jira).toContainText("Project Execution");
    await expect(jira).toContainText("Project Closed");
    await expect(jira).toContainText("Build Status:");
    await expect(jira).toContainText("In progress");
    await expect(jira).toContainText("Done");
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: /^.*Build status/ })).toHaveCount(0);
    await expect(jira).toContainText("Dana Reyes"); // the Jira user, from Jira's own history
    // it answers to the Build status filter and to a search for the Jira user
    await page.getByRole("searchbox", { name: "Search changes" }).fill("dana");
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search changes" }).fill("");
  });

  test("the action bar: filter, columns, group by and search, like the Roadmap grid", async ({ page }) => {
    await open(page);
    await expect(bar(page, /^Filter:\s*None/)).toBeVisible();
    await expect(bar(page, /^Columns:\s*11 of 11 shown/)).toBeVisible();
    await expect(bar(page, /^Group by:\s*Initiative/)).toBeVisible();
    // search
    await page.getByRole("searchbox", { name: "Search changes" }).fill("bidder");
    await expect(grid(page).locator(".group-row")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search changes" }).fill("");
    await expect(grid(page).locator(".group-row")).toHaveCount(3);
    // a quick filter and a rule, with their chips
    await bar(page, /^Filter:/).click();
    await page.getByRole("button", { name: /Tracker changes/ }).click();
    await expect(page.getByText(/\d of \d changes match/)).toBeVisible();
    await page.getByRole("button", { name: "+ Add rule" }).click();
    await page.getByLabel("Field of rule 1").selectOption("source");
    await page.getByRole("group", { name: "Values of rule 1" }).getByRole("button", { name: "Jira" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(bar(page, /^Filter:\s*2 active/)).toBeVisible();
    await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Source: Jira");
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)")).toHaveCount(1); // the Jira move (with its Build Status)
    await page.getByRole("button", { name: "Remove filter Tracker changes" }).click();
    await page.getByRole("button", { name: "Remove filter Source: Jira" }).click();
    await expect(bar(page, /^Filter:\s*None/)).toBeVisible();
  });

  test("columns: hide one and it is gone; reset brings it back", async ({ page }) => {
    await open(page);
    await bar(page, /^Columns:/).click();
    await page.getByRole("button", { name: "Remove Source type" }).click();
    await page.getByRole("button", { name: /^Apply columns \(10\)/ }).click();
    await expect(bar(page, /^Columns:\s*10 of 11 shown/)).toBeVisible();
    await expect(grid(page).locator(".ag-header-cell-text", { hasText: /^Source type$/ })).toHaveCount(0);
    await bar(page, /^Columns:/).click();
    await page.getByRole("button", { name: "Reset to default" }).click();
    await page.getByRole("button", { name: /^Apply columns \(11\)/ }).click();
    await expect(grid(page).locator(".ag-header-cell-text", { hasText: /^Source type$/ })).toHaveCount(1);
  });

  test("a flag has an action: Move to Test where the move is allowed, a gate request where it passes a gate", async ({ page }) => {
    await open(page);
    const gates = () => page.evaluate(() => (window as unknown as { __pv: { gates: { calls: string[] } } }).__pv.gates.calls);
    // R-01 has no phase (counts as Discover): Test passes Gate A and B, so the button opens the request, on the gate that opens that phase
    const r01 = grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "R-01" }).first();
    await expect(r01.getByRole("button", { name: "Request gate B (to Test)" })).toBeVisible();
    // R-02 is in Build with the tracker done: one click moves it
    const r02 = grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "R-02" });
    await expect(r02.getByText("⚑ Build done")).toBeVisible();
    await r02.getByRole("button", { name: "Move to Test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "R-02 moved to Test." })).toBeVisible();
    expect(await gates()).toContain("move item-2 Test");
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "R-02" }).getByRole("button", { name: "Move to Test" })).toHaveCount(0); // the flag is gone: it is in Test now
    // the request opens the same dialog as the bulk bar, on Gate B
    await r01.getByRole("button", { name: "Request gate B (to Test)" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Request a gate for 1 initiative" })).toBeVisible();
    await expect(page.locator("#gate-pick")).toHaveValue("B");
    expect(await gates()).not.toContain("move item-1 Test"); // nothing was moved: the database would have refused it
  });

  test("a failed move says why and changes nothing; a viewer gets no buttons", async ({ page }) => {
    await open(page);
    await page.evaluate(() => { (window as unknown as { __pv: { gates: { failMove: string } } }).__pv.gates.failMove = "This move passes a decision gate; request it instead"; });
    await grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "R-02" }).getByRole("button", { name: "Move to Test" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "R-02 was not moved: This move passes a decision gate" })).toBeVisible();
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "R-02" }).getByText("⚑ Build done")).toBeVisible(); // still flagged
    await page.goto("/dev/reports?report=changes&demo=changes&role=viewer");
    await page.waitForSelector("[data-testid=changes-grid] .ag-row");
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)", { hasText: "R-02" }).getByText("⚑ Build done")).toBeVisible();
    await expect(page.getByRole("button", { name: /Move to Test|Request gate/ })).toHaveCount(0); // a flag is information for a viewer
  });

  test("Refresh reads the changes and the roadmap again and says when; Collapse all and Expand all fold every group", async ({ page }) => {
    await open(page);
    const loads = () => page.evaluate(() => (window as unknown as { __pv: { feedLoads: number } }).__pv.feedLoads);
    const before = await loads();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Updated \d\d:\d\d:\d\d$/ })).toBeVisible();
    await expect.poll(loads).toBeGreaterThan(before);
    await expect(grid(page).locator(".group-row")).toHaveCount(3); // what was shown stays shown
    // fold and unfold every group
    const rows = grid(page).locator(".ag-row:not(.ag-full-width-row)");
    expect(await rows.count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Collapse all groups" }).click();
    await expect(rows).toHaveCount(0);
    await expect(grid(page).locator(".group-toggle[aria-expanded='false']")).toHaveCount(3);
    await page.getByRole("button", { name: "Expand all groups" }).click();
    await expect(rows.first()).toBeVisible();
    await expect(grid(page).locator(".group-toggle[aria-expanded='true']")).toHaveCount(3);
    // not grouped: nothing to fold
    await page.getByRole("button", { name: /^Group by:/ }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: /(Collapse|Expand) all groups/ })).toBeDisabled();
  });

  test("clicking an initiative opens its details beside the report, in view", async ({ page }) => {
    await open(page);
    await grid(page).locator(".ag-row button.link-button").first().click();
    const panel = page.getByTestId("item-panel");
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const view = page.viewportSize()!;
    expect(box.y).toBeLessThan(view.height / 2); // it used to open under the page, out of sight
    expect(box.x).toBeGreaterThan(view.width / 3); // beside the report
    await panel.getByRole("button", { name: /Close panel/ }).click();
    await expect(panel).toHaveCount(0);
  });

  test("a change of a linked issue names the issue and links to it in the tracker", async ({ page }) => {
    await open(page);
    const jira = grid(page).locator('a[href="https://example.test/browse/DEMO-7049"]').first();
    await expect(jira).toHaveAttribute("target", "_blank");
    await expect(jira).toHaveAttribute("rel", /noopener/);
    await expect(grid(page).locator(".chg-issue", { hasText: "Bidder adapter" }).first()).toBeVisible();
    await expect(grid(page).locator('a[href="https://example.test/meridian/web/issues/412"]')).toHaveCount(1);
  });

  test("grouping by change type and keeping only flagged initiatives", async ({ page }) => {
    await open(page);
    await bar(page, /^Group by:/).click();
    await page.getByRole("button", { name: /Choose the grouping for Group by/ }).click(); // the next pick would fill Then by, like in the Roadmap grid
    await page.getByRole("group", { name: "Group by options" }).getByRole("button", { name: /^Change type/ }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(bar(page, /^Group by:\s*Change type/)).toBeVisible();
    await expect(grid(page).locator(".group-row")).toHaveCount(3); // Status, Health, Linked issue (the Build Status went with its Jira move)
    // a second level inside each group
    await bar(page, /^Group by:/).click();
    await page.getByRole("group", { name: "Group by options" }).getByRole("button", { name: /^Source$/ }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(bar(page, /^Group by:\s*Change type › Source/)).toBeVisible();
    await expect(grid(page).locator(".group-row[data-level='1']").first()).toBeVisible();
    // keeping only flagged initiatives
    await bar(page, /^Group by:/).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(grid(page).locator(".group-row")).toHaveCount(0);
    await bar(page, /^Filter:/).click();
    await page.getByRole("button", { name: /To follow up/ }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(grid(page).locator(".ag-row:not(.ag-full-width-row)")).toHaveCount(4); // all three initiatives have a flag in this data
  });

  test("has no accessibility violations", async ({ page }) => {
    await open(page);
    const r = await new AxeBuilder({ page }).include(".reports").analyze();
    expect(r.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target).join(" | "))).toEqual([]);
  });
});
