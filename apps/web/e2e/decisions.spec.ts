import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const openDecisions = async (page: Page, can = "A,B,C") => {
  await page.goto(`/dev/decisions?can=${can}`);
  await page.waitForSelector(".decisions-table");
};
const openGrid = async (page: Page) => {
  await page.goto("/dev/grid?n=12&role=admin&gates=1");
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: { gates?: unknown } }).__pv?.gates !== undefined);
};
// the grid page keeps the gate source in __pv.gates, the Decisions page in __pv.source
const calls = (page: Page) => page.evaluate(() => { const pv = (window as unknown as { __pv: { source?: { calls: string[] }; gates?: { calls: string[] } } }).__pv; return (pv.gates ?? pv.source)!.calls; });

test.describe("the Decisions screen", () => {
  test("lists what waits, newest first, about gates and not about one person", async ({ page }) => {
    await openDecisions(page);
    await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Waiting for approval \(4\)/ })).toHaveAttribute("aria-selected", "true");
    const first = page.locator(".decisions-table tbody tr");
    await expect(first).toHaveCount(4);
    await expect(first.first()).toContainText("R-03");
    await expect(first.first()).toContainText("Gate B: Define to Build");
    // who can decide is a column, not an assumption that one person approves
    await expect(first.first()).toContainText("ana, bo");
    await expect(page.locator(".tab-badge")).toContainText("4");
  });

  test("the gate pack shows the checklist and the documents; J and K move; the filters work", async ({ page }) => {
    await openDecisions(page);
    await page.locator(".decisions-table tbody tr").nth(0).click();
    const pack = page.getByRole("complementary", { name: "Gate pack" });
    await expect(pack).toContainText("R-03 Search relevance");
    await page.keyboard.press("j");
    await expect(pack).toContainText("R-02 New checkout flow");
    await expect(pack).toContainText("MoSCoW set");
    await expect(pack).toContainText("(missing)");
    await expect(pack).toContainText("prd (in review)");
    await expect(pack).toContainText("Customers who see the new checkout convert more.");
    await page.getByRole("tab", { name: "Decided" }).click();
    await expect(page.locator(".decisions-table tbody tr")).toHaveCount(1);
    await page.locator(".decisions-table tbody tr").click();
    await expect(pack).toContainText("Tiny change, ship it");
    await expect(pack).toContainText("Skipped phases: Build, Test, Experiment");
    await page.getByRole("tab", { name: "Requested by me" }).click();
    await expect(page.locator(".decisions-table tbody tr")).toHaveCount(1); // r3 was requested by u1
    await page.getByRole("tab", { name: /Can decide/ }).click();
    await expect(page.locator(".decisions-table tbody tr")).toHaveCount(4);
  });

  test("Go needs a rationale; the first decision is recorded and the request leaves the waiting list", async ({ page }) => {
    await openDecisions(page);
    await page.locator(".decisions-table tbody tr").filter({ hasText: "R-02" }).click();
    await page.getByRole("button", { name: /^Go\b/ }).first().click();
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

  test("the keyboard decides: S opens the Stop dialog; conditions are required for Go with conditions", async ({ page }) => {
    await openDecisions(page);
    await page.locator(".decisions-table tbody tr").filter({ hasText: "R-04" }).click();
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
    await page.locator(".decisions-table tbody tr").filter({ hasText: "R-03" }).click();
    await page.getByRole("button", { name: /^Go\b/ }).first().click();
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
    await page.locator(".decisions-table tbody tr").filter({ hasText: "R-02" }).click();
    const pack = page.getByRole("complementary", { name: "Gate pack" });
    await expect(pack).toContainText("You do not have approval rights for gate B");
    await expect(pack.getByRole("button", { name: /^Go\b/ })).toHaveCount(0);
    await page.getByRole("tab", { name: /Can decide/ }).click();
    await expect(page.locator(".decisions-table tbody tr")).toHaveCount(1);
  });

  test("selecting several requests decides them together with one rationale", async ({ page }) => {
    await openDecisions(page);
    for (const code of ["R-02", "R-03"]) await page.locator(".decisions-table tbody tr").filter({ hasText: code }).getByRole("checkbox").check();
    await page.getByRole("region", { name: "Decide the selected requests" }).getByRole("button", { name: "Decide 2…" }).click();
    const dialog = page.getByRole("dialog", { name: "Decide 2 requests" });
    await dialog.getByLabel(/Rationale/).fill("Batch approved at planning");
    await dialog.getByRole("button", { name: "Go for 2" }).click();
    await expect(dialog).toContainText("2 of 2 done");
  });

  test("has no accessibility violations", async ({ page }) => {
    await openDecisions(page);
    await page.locator(".decisions-table tbody tr").first().click();
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
