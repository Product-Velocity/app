import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const openDecisions = async (page: Page, can = "A,B,C") => {
  await page.goto(`/dev/decisions?can=${can}`);
  await page.waitForSelector(".ag-row");
};
const openGrid = async (page: Page) => {
  await page.goto("/dev/grid?n=12&role=admin&gates=1");
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: { gates?: unknown } }).__pv?.gates !== undefined);
};
// the grid page keeps the gate source in __pv.gates, the Decisions page in __pv.source
const calls = (page: Page) => page.evaluate(() => { const pv = (window as unknown as { __pv: { source?: { calls: string[] }; gates?: { calls: string[] } } }).__pv; return (pv.gates ?? pv.source)!.calls; });

/** One row element holds the pinned name, the middle cells and the pinned buttons. */
/** The initiatives in the order they are shown: AG Grid positions rows by their row index, so the order of the elements in the page is not the order on screen. */
const shownCodes = (page: Page) => page.evaluate(() => [...document.querySelectorAll(".ag-row")].sort((a, b) => Number(a.getAttribute("row-index")) - Number(b.getAttribute("row-index"))).map((r) => (r.querySelector(".lst-name")?.textContent ?? "").split(" ")[0]));
const expectCodes = async (page: Page, codes: string[], firstOnly = false) => { await expect.poll(async () => { const s = await shownCodes(page); return firstOnly ? s.slice(0, codes.length) : s; }).toEqual(codes); };
const names = (page: Page) => page.locator(".ag-row .lst-name");
const centre = (page: Page, id: string) => page.locator(`[row-id="${id}"]`);
const decide = (page: Page, id: string) => page.locator(`[row-id="${id}"] [col-id="action"]`);
const pick = (page: Page, code: string) => names(page).filter({ hasText: code }).click();

test.describe("the Decisions screen", () => {
  test("lists what waits, newest first, about gates and not about one person", async ({ page }) => {
    await openDecisions(page);
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Waiting for approval \(4\)/ })).toHaveAttribute("aria-selected", "true");
    await expectCodes(page, ["R-03", "R-02", "R-04", "R-01"]);
    await expect(centre(page, "r3")).toContainText("Gate B: Define to Build");
    // how long it has waited is about the request; a long wait is a word as well as a colour
    await expect(centre(page, "r1")).toContainText("4 days");
    await expect(centre(page, "r3")).toContainText("1 day");
    await expect(centre(page, "r2")).toContainText("2 of 3 · incomplete");
    await expect(centre(page, "r1")).toContainText("2 of 2 · complete");
    await expect(page.locator(".tab-badge").first()).toContainText("4");
    // no column or sort ranks the people who decide
    await expect(page.getByRole("columnheader", { name: /decided by|approver/i })).toHaveCount(0);
  });

  test("the gate pack shows the checklist and the documents; J and K move; the tabs work", async ({ page }) => {
    await openDecisions(page);
    await pick(page, "R-03");
    const pack = page.getByRole("complementary", { name: "Gate pack" });
    await expect(pack).toContainText("R-03 Search relevance");
    await expect(pack).toContainText("Who can decide: ana, bo");
    await page.keyboard.press("j");
    await expect(pack).toContainText("R-02 New checkout flow");
    await expect(pack).toContainText("MoSCoW set");
    await expect(pack).toContainText("(missing)");
    await expect(pack).toContainText("prd (in review)");
    await expect(pack).toContainText("Customers who see the new checkout convert more.");
    await page.getByRole("tab", { name: "Decided" }).click();
    await expect(names(page)).toHaveCount(1);
    await expect(centre(page, "r5")).toContainText("Go");
    await pick(page, "R-05");
    await expect(pack).toContainText("Tiny change, ship it");
    await expect(pack).toContainText("Skipped phases: Build, Test, Experiment");
    await page.getByRole("tab", { name: "Requested by me" }).click();
    await expect(names(page)).toHaveCount(1); // r3 was requested by u1
    await page.getByRole("tab", { name: /Can decide/ }).click();
    await expect(names(page)).toHaveCount(4);
  });

  test("search, gate filter and the quick filters narrow the list", async ({ page }) => {
    await openDecisions(page);
    await page.getByRole("searchbox", { name: "Search Decisions" }).fill("referral");
    await expectCodes(page, ["R-04"]);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("button", { name: /^Gate/ }).click();
    await page.getByRole("checkbox", { name: /Gate A/ }).check();
    await expectCodes(page, ["R-01"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("checkbox", { name: /Incomplete checklist/ }).check();
    await expectCodes(page, ["R-03", "R-02", "R-04"]);
    await page.getByRole("checkbox", { name: /Incomplete checklist/ }).uncheck();
    await page.getByRole("columnheader", { name: "Initiative" }).click();
    await expectCodes(page, ["R-01"], true);
  });

  test("Go needs a rationale; the first decision is recorded and the request leaves the waiting list", async ({ page }) => {
    await openDecisions(page);
    await pick(page, "R-02");
    await page.getByRole("complementary", { name: "Gate pack" }).getByRole("button", { name: /^Go\b/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Decide 1 request" });
    const go = dialog.getByRole("button", { name: "Go for 1" });
    await expect(go).toBeDisabled();
    await dialog.getByLabel(/Rationale/).fill("Engineering reviewed the PRD");
    await expect(go).toBeEnabled();
    await go.click();
    await expect(dialog).toContainText("1 of 1 done");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("tab", { name: /Waiting for approval \(3\)/ })).toBeVisible();
    expect(await calls(page)).toContain("decide go 1");
  });

  test("a row has its own quick buttons: Go opens the dialog already on Go", async ({ page }) => {
    await openDecisions(page);
    await decide(page, "r4").getByRole("button", { name: "Hold" }).click();
    const dialog = page.getByRole("dialog", { name: "Decide 1 request" });
    await expect(dialog.getByRole("radio", { name: /Hold/ })).toBeChecked();
    await page.keyboard.press("Escape");
    await decide(page, "r4").getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Decide 1 request" }).getByRole("radio", { name: /^Go Move on\. The phase/ })).toBeChecked();
  });

  test("the keyboard decides: S opens the Stop dialog; conditions are required for Go with conditions", async ({ page }) => {
    await openDecisions(page);
    await pick(page, "R-04");
    await page.keyboard.press("s");
    const dialog = page.getByRole("dialog", { name: "Decide 1 request" });
    await expect(dialog.getByRole("radio", { name: /Stop/ })).toBeChecked();
    await dialog.getByRole("radio", { name: /Go with conditions/ }).check();
    await dialog.getByLabel(/Rationale/).fill("Fine if legal agrees");
    await expect(dialog.getByRole("button", { name: "Go with conditions for 1" })).toBeDisabled();
    await dialog.getByLabel(/Conditions/).fill("Legal review");
    await expect(dialog.getByRole("button", { name: "Go with conditions for 1" })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("fast lane is a recorded choice with no check: pick a later phase and say so", async ({ page }) => {
    await openDecisions(page);
    await pick(page, "R-03");
    await page.getByRole("complementary", { name: "Gate pack" }).getByRole("button", { name: /^Go\b/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Rationale/).fill("Tiny, ship it");
    await dialog.getByLabel(/Fast lane/).check();
    await dialog.getByLabel("Target phase").selectOption("Roll-out");
    await expect(dialog).toContainText("There are no checks; it is your call.");
    await dialog.getByRole("button", { name: "Go for 1" }).click();
    await expect(dialog).toContainText("1 of 1 done");
  });

  test("someone without rights for a gate sees who can decide and no decision buttons", async ({ page }) => {
    await openDecisions(page, "A");
    await pick(page, "R-02");
    const pack = page.getByRole("complementary", { name: "Gate pack" });
    await expect(pack).toContainText("You do not have approval rights for gate B");
    await expect(pack.getByRole("button", { name: /^Go\b/ })).toHaveCount(0);
    await expect(decide(page, "r2")).toContainText("Not yours to decide");
    await expect(page.locator('[row-id="r2"] input[type="checkbox"]')).toBeDisabled();
    await page.getByRole("tab", { name: /Can decide/ }).click();
    await expect(names(page)).toHaveCount(1);
  });

  test("selecting several requests decides them together with one rationale, and warns about an incomplete checklist", async ({ page }) => {
    await openDecisions(page);
    for (const id of ["r2", "r3"]) await page.locator(`[row-id="${id}"] input[type="checkbox"]`).check();
    const bar = page.getByRole("region", { name: "Decide the selected requests" });
    await expect(bar).toContainText("2 selected");
    await expect(bar).toContainText("2 of the selected have an incomplete checklist");
    await bar.getByRole("button", { name: "Decide 2…" }).click();
    const dialog = page.getByRole("dialog", { name: "Decide 2 requests" });
    await dialog.getByLabel(/Rationale/).fill("Batch approved at planning");
    await dialog.getByRole("button", { name: "Go for 2" }).click();
    await expect(dialog).toContainText("2 of 2 done");
  });

  test("a bulk Hold opens the dialog on Hold, and a CSV of the rows can be downloaded", async ({ page }) => {
    await openDecisions(page);
    for (const id of ["r1", "r4"]) await page.locator(`[row-id="${id}"] input[type="checkbox"]`).check();
    await page.getByRole("region", { name: "Decide the selected requests" }).getByRole("button", { name: "Hold…" }).click();
    await expect(page.getByRole("dialog", { name: "Decide 2 requests" }).getByRole("radio", { name: /Hold/ })).toBeChecked();
    await page.keyboard.press("Escape");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^decisions-.*\.csv$/);
    const text = (await (await download.createReadStream())!.toArray()).join("");
    expect(text.split("\n")).toHaveLength(3); // the header and the two selected rows
    expect(text).toContain("R-01");
  });

  test("a request with no recorded requester says so instead of 'unknown'", async ({ page }) => {
    await openDecisions(page);
    await page.getByRole("button", { name: /^Columns/ }).click();
    await page.getByRole("checkbox", { name: "Requested by" }).check();
    await page.keyboard.press("Escape");
    await expect(page.locator("body")).not.toContainText("unknown");
  });

  test("has no accessibility violations", async ({ page }) => {
    await openDecisions(page);
    await pick(page, "R-03");
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});

test.describe("gate actions in the grid", () => {
  test("the bulk bar requests a gate for the ready items and says which are skipped", async ({ page }) => {
    await openGrid(page);
    for (const id of ["item-1", "item-2", "item-3"]) await page.locator(`.ag-row[row-id="${id}"] input[type="checkbox"]`).first().check(); // Discover, Define, Build
    const bar = page.getByRole("region", { name: /Bulk actions/ });
    await bar.getByRole("button", { name: "Request gate…" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a gate for 3 initiatives" });
    await expect(dialog.getByLabel("Gate")).toHaveValue("A");
    await expect(dialog).toContainText("1 initiative is ready to ask");
    await expect(dialog).toContainText("2 skipped");
    await expect(dialog).toContainText("already past gate A (Define)");
    await dialog.getByRole("button", { name: "Request gate A for 1" }).click();
    await expect(dialog).toContainText("1 of 1 done");
    expect(await calls(page)).toContain("request A 1");
  });

  test("the request dialog lets the requester name who to ask: people who can decide, not themselves or people who cannot", async ({ page }) => {
    await openGrid(page);
    await page.locator('.ag-row[row-id="item-1"] input[type="checkbox"]').first().check();
    await page.getByRole("region", { name: /Bulk actions/ }).getByRole("button", { name: "Request gate…" }).click();
    const dialog = page.getByRole("dialog", { name: "Request a gate for 1 initiative" });
    const group = dialog.getByRole("group", { name: "Ask these people (optional)" });
    await expect(group.getByRole("checkbox")).toHaveCount(1); // bo is an Approver; ana is the signed-in person; cy cannot decide
    await expect(group).toContainText("bo@example.test");
    await group.getByRole("checkbox", { name: "bo@example.test" }).check();
    await dialog.getByRole("button", { name: /Request gate A for 1/ }).click();
    await expect(dialog).toContainText("1 of 1 done");
    expect(await page.evaluate(() => (window as unknown as { __pv: { gates: { lastPreferred: string[] } } }).__pv.gates.lastPreferred)).toEqual(["u2"]);
  });

  test("Decide in the bulk bar says when nothing is waiting; Move offers only moves without a gate", async ({ page }) => {
    await openGrid(page);
    await page.locator('.ag-row[row-id="item-3"] input[type="checkbox"]').first().check(); // Build
    const bar = page.getByRole("region", { name: /Bulk actions/ });
    await bar.getByRole("button", { name: "Decide…" }).click();
    await expect(bar).toContainText("None of the selected initiatives has a gate request waiting.");
    await bar.getByRole("button", { name: "Move to next phase…" }).click();
    const dialog = page.getByRole("dialog", { name: "Move 1 initiative to another phase" });
    const options = await dialog.locator("select option").allTextContents();
    expect(options).toEqual(["Discover", "Define", "Test", "Experiment"]); // not Roll-out: that passes gate C
    await dialog.getByLabel("Move to").selectOption("Test");
    await dialog.getByRole("button", { name: "Move 1 to Test" }).click();
    await expect(dialog).toContainText("1 of 1 done");
    expect(await calls(page)).toContain("move item-3 Test");
  });

  test("the command palette offers the gate actions for the selected rows and opens the same dialogs", async ({ page }) => {
    await openGrid(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("request gate");
    await expect(page.getByRole("option", { name: /Request gate for/ })).toHaveCount(0); // nothing selected: the actions are not offered
    await page.keyboard.press("Escape");
    for (const id of ["item-1", "item-2"]) await page.locator(`.ag-row[row-id="${id}"] input[type="checkbox"]`).first().check();
    await page.keyboard.press("Control+K");
    await page.keyboard.type("request gate");
    await page.getByRole("option", { name: /Request gate for 2 selected initiatives/ }).click();
    await expect(page.getByRole("dialog", { name: "Request a gate for 2 initiatives" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("move");
    await page.getByRole("option", { name: /Move 2 selected initiatives to another phase/ }).click();
    await expect(page.getByRole("dialog", { name: /Move 2 initiatives/ })).toBeVisible();
  });

  test("the Initiative Phase cell is read-only and says where to go instead", async ({ page }) => {
    await openGrid(page);
    await page.evaluate(() => (window as unknown as { __pv: { controller: { editFields: (id: string, f: Record<string, unknown>) => unknown } } }).__pv.controller.editFields("item-1", { initiative_phase: "Build" }));
    expect(await page.evaluate(() => (window as unknown as { __pv: { controller: { row: (id: string) => Record<string, unknown> } } }).__pv.controller.row("item-1").initiative_phase)).toBe("Discover");
  });
});
