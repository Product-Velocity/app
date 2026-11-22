import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page) => {
  await page.goto("/dev/attention");
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
  await page.evaluate(() => { try { window.localStorage.clear(); } catch { /* storage may be blocked */ } });
};
/** One row element holds the pinned name, the middle cells and the pinned next step. */
const centre = (page: Page, id: string) => page.locator(`[row-id="${id}"]`);
const action = (page: Page, id: string) => page.locator(`[row-id="${id}"] [col-id="action"]`);
const names = (page: Page) => page.locator(".ag-row .lst-name");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { gates: { calls: string[] } } }).__pv.gates.calls);

test.describe("Needs attention", () => {
  test("lists every reason in words, worst first, with the count of each", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "10 need attention" })).toContainText("showing 10");
    // urgent first: blocked work and a cancelled initiative that is still being built, then the rest by rank
    await expect(names(page)).toHaveText([/R-03/, /R-05/, /R-07/, /R-01/, /R-02/, /R-04/, /R-06/, /R-08/, /R-09/, /R-10/]);
    await expect(centre(page, "item-1")).toContainText("The build is done in the tracker. Move to Test?");
    await expect(centre(page, "item-2")).toContainText("before gate B");
    await expect(centre(page, "item-3")).toContainText("Cancelled but the build is still in progress");
    await expect(centre(page, "item-4")).toContainText("look at this Hold again has come");
    await expect(centre(page, "item-5")).toContainText("Health is Blocked");
    await expect(centre(page, "item-6")).toContainText("72 days in Define (usually at most 30)");
    await expect(centre(page, "item-7")).toContainText("Gate B has waited 12 days for a decision");
    await expect(centre(page, "item-8")).toContainText("2 open conditions: Legal review; Privacy note");
    // issue #472: the phase is Test (or later) while the tracker says the build has not started
    await expect(centre(page, "item-9")).toContainText("The phase is Test, but the tracker says the build has not started.");
    // the urgency and the reasons are words, not only colour
    await expect(centre(page, "item-3")).toContainText("Urgent");
    await expect(centre(page, "item-7")).toContainText("Soon");
    await expect(page.getByRole("button", { name: "Phase ahead of the build (4)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Build done (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open conditions (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All (10)" })).toHaveAttribute("aria-pressed", "true");
    // reasons nobody has are not offered as empty tabs; they are named in one line
    await expect(page.getByRole("button", { name: /Stale issues/ })).toHaveCount(0);
    await expect(page.locator(".lst-zero")).toContainText("Stale issues");
  });

  test("a reason chip keeps only that reason, and chips can be combined", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Waiting for a decision (1)" }).click();
    await expect(names(page)).toHaveText([/R-07/]);
    await page.getByRole("button", { name: /^Build done/ }).click();
    await expect(names(page)).toHaveText([/R-07/, /R-01/]);
    await page.getByRole("button", { name: /^All \(/ }).click();
    await expect(names(page)).toHaveCount(10);
  });

  test("search, filters and sorting narrow the list, and Clear filters brings it back", async ({ page }) => {
    await open(page);
    await page.getByRole("searchbox", { name: "Search Needs attention" }).fill("hold");
    await expect(names(page)).toHaveText([/R-04/]);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(names(page)).toHaveCount(10);
    await page.getByRole("button", { name: /^Urgency/ }).click();
    await page.getByRole("checkbox", { name: /^Urgent/ }).check();
    await expect(names(page)).toHaveText([/R-03/, /R-05/]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("checkbox", { name: /One click away/ }).check();
    await expect(names(page)).toHaveText([/R-07/, /R-01/, /R-02/, /R-04/]); // Open Decisions, Move to Test, Request gate, Request the gate again, Open Decisions
    await page.getByRole("checkbox", { name: /One click away/ }).uncheck();
    await page.getByRole("columnheader", { name: "Initiative" }).click();
    await expect(names(page).first()).toContainText("R-01");
  });

  test("a view is saved by name and applied again; the slash key searches", async ({ page }) => {
    await open(page);
    await page.keyboard.press("/");
    await expect(page.getByRole("searchbox", { name: "Search Needs attention" })).toBeFocused();
    await page.keyboard.type("stalled");
    await expect(names(page)).toHaveText([/R-06/]);
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByLabel("Name for the view").fill("Stuck work");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(names(page)).toHaveCount(10);
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("button", { name: "Stuck work", exact: true }).click();
    await expect(names(page)).toHaveText([/R-06/]);
  });

  test("the next step is one click: Move to Test goes through the gate function and the row leaves the list", async ({ page }) => {
    await open(page);
    await action(page, "item-1").getByRole("button", { name: "Move to Test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "R-01 moved to Test." })).toBeVisible();
    expect(await calls(page)).toContain("move item-1 Test");
    await expect(page.getByRole("status").filter({ hasText: "9 need attention" })).toBeVisible();
    await expect(centre(page, "item-1")).toHaveCount(0);
  });

  test("Request gate opens the same dialog as the bulk bar; a failed move says why and changes nothing", async ({ page }) => {
    await open(page);
    await action(page, "item-2").getByRole("button", { name: "Request gate B" }).click();
    await expect(page.getByRole("dialog", { name: "Request a gate for 1 initiative" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.evaluate(() => { (window as unknown as { __pv: { gates: { failMove: string } } }).__pv.gates.failMove = "Only a Creator or an Admin can do this"; });
    await action(page, "item-1").getByRole("button", { name: "Move to Test" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "R-01 was not moved: Only a Creator or an Admin can do this" })).toBeVisible();
    await expect(centre(page, "item-1")).toHaveCount(1);
  });

  test("selecting several rows offers bulk steps: move to Test, request a gate, snooze, download", async ({ page }) => {
    await open(page);
    for (const id of ["item-1", "item-2", "item-5"]) await page.locator(`[row-id="${id}"] input[type="checkbox"]`).check();
    const bar = page.getByRole("region", { name: "Act on the selected initiatives" });
    await expect(bar).toContainText("3 selected");
    await expect(bar.getByRole("button", { name: "Request gate B (1)" })).toBeVisible();
    await bar.getByRole("button", { name: "Move 1 to Test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 moved to Test." })).toBeVisible();
    expect(await calls(page)).toContain("move item-1 Test");
    await expect(bar).toHaveCount(0); // the selection is cleared after the step
  });

  test("snoozing hides a reason for everyone, can be undone, and the row comes back when asked for", async ({ page }) => {
    await open(page);
    await action(page, "item-4").getByRole("button", { name: "Snooze R-04" }).click();
    const dialog = page.getByRole("dialog", { name: "Snooze R-04" });
    await expect(dialog).toContainText("changes nothing about the initiative");
    await dialog.getByRole("radio", { name: "For a week" }).check();
    await dialog.getByLabel(/Why/).fill("Waiting for legal");
    await dialog.getByRole("button", { name: /^Snooze until 2027-04-21$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "R-04 snoozed until 2027-04-21" })).toBeVisible();
    expect(await calls(page)).toContain("snooze item-4 hold-due 2027-04-21");
    await expect(centre(page, "item-4")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "9 need attention" })).toContainText("1 snoozed or dismissed");
    await page.getByRole("checkbox", { name: /Show snoozed/ }).check();
    await expect(action(page, "item-4")).toContainText("Snoozed to 2027-04-21");
    await action(page, "item-4").getByRole("button", { name: "Bring back" }).click();
    await expect(page.getByRole("status").filter({ hasText: "R-04 back on the list." })).toBeVisible();
    expect(await calls(page)).toContain("unsnooze item-4 hold-due");
    await page.getByRole("button", { name: "Undo" }).click(); // undoes the bring back: snoozed again
    await expect(page.getByRole("status").filter({ hasText: "Undone." })).toBeVisible();
    expect(await calls(page)).toContain("snooze item-4 hold-due 2027-04-21");
  });

  test("a dismissal has no date and a Viewer cannot snooze", async ({ page }) => {
    await page.goto("/dev/attention?role=viewer");
    await page.waitForSelector(".ag-row");
    await expect(page.getByRole("button", { name: "Snooze R-04" })).toHaveCount(0);
    await open(page);
    await action(page, "item-6").getByRole("button", { name: "Snooze R-06" }).click();
    await page.getByRole("dialog").getByRole("radio", { name: /Dismiss until someone brings it back/ }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "R-06 dismissed." })).toBeVisible();
    expect(await calls(page)).toContain("snooze item-6 stalled dismissed");
  });

  test("columns can be hidden and shown again, and a CSV of the rows shown can be downloaded", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("columnheader", { name: "Health" })).toBeVisible();
    await page.getByRole("button", { name: /^Columns/ }).click();
    await page.getByRole("checkbox", { name: "Health" }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: "Health" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Columns/ }).click();
    await page.getByRole("checkbox", { name: "Product manager" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: "Product manager" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search Needs attention" }).fill("blocked");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^needs-attention-.*\.csv$/);
    const text = (await (await download.createReadStream())!.toArray()).join("");
    expect(text.split("\n")[0]).toMatch(/^Code,Initiative,Urgency/);
    expect(text).toContain("R-05");
    expect(text).not.toContain("R-04");
  });

  test("J and K move through the list, Enter opens the initiative beside the list, Escape closes it", async ({ page }) => {
    await open(page);
    await page.keyboard.press("j");
    await expect(page.locator(".ag-row.lst-active .lst-name").first()).toContainText("R-03");
    await page.keyboard.press("j");
    await expect(page.locator(".ag-row.lst-active .lst-name").first()).toContainText("R-05");
    await page.keyboard.press("k");
    await expect(page.locator(".ag-row.lst-active .lst-name").first()).toContainText("R-03");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary").or(page.locator(".item-panel"))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".item-panel")).toHaveCount(0);
  });

  test("has no accessibility violations", async ({ page }) => {
    await open(page);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
