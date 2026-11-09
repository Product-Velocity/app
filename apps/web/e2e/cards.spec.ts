import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=40") => {
  await page.goto(`/dev/cards?${query}`);
  await page.waitForSelector("[data-card]");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);
const cell = (page: Page, lane: string, col: string) => page.locator(`[data-lane="${lane}"][data-col="${col}"]`);
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);
const val = (page: Page, id: string, field: string) => page.evaluate(([i, f]) => (window as unknown as { __pv: { controller: { row: (id: string) => Record<string, unknown> } } }).__pv.controller.row(i!)[f!] ?? null, [id, field]);
const undoCount = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { controller: { status: { undoCount: number } } } }).__pv.controller.status.undoCount);

test.describe("the board", () => {
  test("columns are the Initiative Phases and swimlanes the Initiative Groups, with counts", async ({ page }) => {
    await open(page);
    await expect(page.locator(".kb-col-name")).toHaveText(["Discover", "Define", "Build", "Test", "Experiment", "Roll-out", "Completed", "No value"]);
    await expect(page.locator(".kb-lane-head strong")).toHaveText(["Onboarding", "Platform health", "Retention", "No value"]);
    await expect(page.locator(".kb-col-head", { hasText: "Discover" }).locator(".gl-count")).toHaveText("8");
    await expect(page.locator(".kb-lane-head", { hasText: "Onboarding" })).toContainText("items");
    await expect(page.locator(".gantt-count")).toContainText("40 initiatives");
  });

  test("a card shows rank, code, name, health as a word, owner, size and team chips", async ({ page }) => {
    await open(page);
    const c = card(page, "item-1");
    await expect(c).toContainText("#1 R-01");
    await expect(c).toContainText("Initiative number 1");
    await expect(c.locator(".pill")).toHaveText("On Track");
    await expect(card(page, "item-6").locator(".kc-team")).toHaveText(["Core", "Mobile"]);
    await expect(c.locator(".kc-meta .token-chip").first()).toHaveText("XS");
  });

  test("the column and swimlane fields can be changed; the read-only GitHub status is offered", async ({ page }) => {
    await open(page);
    const columns = page.getByLabel("Columns");
    await columns.selectOption("health");
    await expect(page.locator(".kb-col-name")).toHaveText(["On Track", "At Risk", "Delayed", "Blocked", "No value"]);
    expect(page.url()).toContain("by=health");
    await page.getByLabel("Swimlanes").selectOption("");
    await expect(page.locator(".kb-lane-head")).toHaveCount(0);
    expect(page.url()).toContain("lane=none");
    await columns.selectOption("status");
    await expect(page.getByRole("note")).toContainText("Build Status comes from GitHub");
  });

  test("lanes collapse and expand; a lane with no cards starts collapsed", async ({ page }) => {
    await open(page, "n=40");
    await page.getByLabel("Swimlanes").selectOption("horizon");
    await expect(page.getByRole("button", { name: "Expand Now" })).toBeVisible(); // empty, so collapsed
    await expect(page.getByRole("button", { name: "Collapse No value" })).toBeVisible();
    const before = await page.locator("[data-card]").count();
    await page.getByRole("button", { name: "Collapse No value" }).click();
    expect(await page.locator("[data-card]").count()).toBeLessThan(before);
    await page.getByRole("button", { name: "Expand No value" }).click();
    expect(await page.locator("[data-card]").count()).toBe(before);
  });

  test("respects the scope, the filters of a saved view, and shows the saved view's extra columns on the cards", async ({ page }) => {
    await open(page);
    const all = await page.locator("[data-card]").count();
    await page.locator(".more-views-btn").click();
    await page.getByRole("dialog", { name: "Views" }).getByRole("group", { name: "Must haves" }).locator(".vm-open").click();
    await expect(page.locator(".gantt-count")).toContainText("filters of “Must haves”");
    expect(await page.locator("[data-card]").count()).toBeLessThan(all);
    await page.locator(".more-views-btn").click();
    await page.getByRole("dialog", { name: "Views" }).getByRole("group", { name: "With dates" }).locator(".vm-open").click();
    await expect(card(page, "item-1")).toContainText("G2M Date (est):");
    await expect(card(page, "item-1")).toContainText("Confidence:");
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Prioritisation", exact: true }).click();
    await page.locator(".scope-chip").click();
    await page.getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(page.locator(".gantt-count")).toContainText("scope: Customer-facing work");
    const projects = await page.evaluate(() => [...document.querySelectorAll("[data-card]")].map((c) => (window as unknown as { __pv: { controller: { row: (id: string) => { home_project: string } } } }).__pv.controller.row(c.getAttribute("data-card")!).home_project));
    expect(new Set(projects)).toEqual(new Set(["p3"]));
  });

  test("shows the 4 default views (Prioritisation, Planning, Delivery, Go-to-market) and applies their filters, swimlanes and card fields", async ({ page }) => {
    await open(page);
    const viewGroup = page.getByRole("group", { name: "View" });
    await expect(viewGroup.locator(".view-chip")).toHaveText(["Prioritisation", "Planning", "Delivery", "Go-to-market"]);

    // Planning: filters to Discover/Define/Build, groups swimlanes by Planned Quarter, shows G2M Date (est)
    await viewGroup.getByRole("button", { name: "Planning", exact: true }).click();
    expect(page.url()).toContain("view=Planning");
    await expect(page.getByLabel("Swimlanes")).toHaveValue("g2m_quarter");
    await expect(page.locator(".kb-lane-head strong")).toHaveText(["Q1 2027", "Q2 2027", "Q3 2027", "No value"]);
    await expect(page.locator(".filter-chips")).toContainText("Initiative Phase");
    await expect(card(page, "item-1")).toContainText("G2M Date (est):");

    // Delivery: filters to Build/Test/Experiment, groups swimlanes by Project, shows Build Status and Delivery Progress
    await viewGroup.getByRole("button", { name: "Delivery", exact: true }).click();
    expect(page.url()).toContain("view=Delivery");
    await expect(page.getByLabel("Swimlanes")).toHaveValue("home_project");
    await expect(card(page, "item-3")).toContainText("Build Status:");
    await expect(card(page, "item-3")).toContainText("Delivery Progress:");

    // Go-to-market: filters to Test/Experiment/Roll-out, groups swimlanes by Audience
    await viewGroup.getByRole("button", { name: "Go-to-market", exact: true }).click();
    expect(page.url()).toContain("view=Go-to-market");
    await expect(page.getByLabel("Swimlanes")).toHaveValue("audience");
    await expect(page.locator(".kb-lane-head strong")).toHaveText(["Demand partners", "Internal", "Publishers", "No value"]);
  });

  test("filters cards with the FilterPanel and search box, and saves and persists a custom view across navigation", async ({ page }) => {
    await open(page);
    // Search input filters cards immediately and Escape clears it
    const search = page.getByRole("searchbox", { name: "Search initiatives" });
    await search.fill("R-01");
    await expect(page.locator("[data-card]")).toHaveCount(1);
    await expect(card(page, "item-1")).toBeVisible();
    await search.press("Escape");
    await expect(page.locator(".gantt-count")).toContainText("40 initiatives");

    // FilterPanel quick filter narrows cards and adds a removable filter chip
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: "Must-haves" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".filter-chips")).toContainText("MoSCoW: Must");
    const filteredCount = await page.locator("[data-card]").count();
    expect(filteredCount).toBeLessThan(40);

    // Save as a custom view and verify persistence across navigation back to /dev/cards
    await page.locator(".more-views-btn").click();
    await page.getByRole("dialog", { name: "Views" }).getByRole("button", { name: "Save as new view…" }).click();
    const saveDialog = page.getByRole("dialog", { name: "Save as new view" });
    await saveDialog.getByLabel("Name").fill("Card Musts");
    await saveDialog.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("group", { name: "View" }).getByRole("button", { name: "Card Musts", exact: true })).toHaveAttribute("aria-pressed", "true");

    // Switch to Planning and navigate back to /dev/cards without ?view= to verify session persistence
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Planning", exact: true }).click();
    await page.goto("/dev/cards?n=40");
    await page.waitForSelector("[data-card]");
    await expect(page.getByRole("group", { name: "View" }).getByRole("button", { name: "Planning", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Swimlanes")).toHaveValue("g2m_quarter");
  });
});

test.describe("moving cards", () => {
  // a tall window so the whole board is on screen: a drag across an inner scroll area is not what is tested here
  test.use({ viewport: { width: 2600, height: 2600 } });
  test("dragging to another column changes the field, saves, and one Ctrl+Z puts it back", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    expect(await val(page, "item-1", "moscow")).toBe("Must");
    await card(page, "item-1").dragTo(cell(page, "Onboarding", "Could"));
    expect(await val(page, "item-1", "moscow")).toBe("Could");
    expect(await val(page, "item-1", "theme")).toBe("Onboarding");
    await expect(cell(page, "Onboarding", "Could").locator('[data-card="item-1"]')).toBeVisible();
    await settle(page);
    await expect(page.locator(".strip")).toContainText("R-01 MoSCoW: Must to Could");
    await page.keyboard.press("Control+Z");
    await expect.poll(() => val(page, "item-1", "moscow")).toBe("Must");
    await expect(cell(page, "Onboarding", "Must").locator('[data-card="item-1"]')).toBeVisible();
    await settle(page);
  });

  test("dragging to another column and lane changes both fields as one undo step", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await card(page, "item-1").dragTo(cell(page, "Retention", "Should"));
    expect(await val(page, "item-1", "moscow")).toBe("Should");
    expect(await val(page, "item-1", "theme")).toBe("Retention");
    expect(await undoCount(page)).toBe(1);
    await settle(page);
    await page.keyboard.press("Control+Z");
    await expect.poll(() => val(page, "item-1", "theme")).toBe("Onboarding");
    expect(await val(page, "item-1", "moscow")).toBe("Must");
  });

  test("dropping on a lane header changes the lane and keeps the column; 'No value' clears the field", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await card(page, "item-1").dragTo(page.locator('[data-lane-head="Retention"]'));
    expect(await val(page, "item-1", "theme")).toBe("Retention");
    expect(await val(page, "item-1", "moscow")).toBe("Must");
    await card(page, "item-1").dragTo(cell(page, "Retention", "none"));
    expect(await val(page, "item-1", "moscow")).toBeNull();
    await settle(page);
  });

  test("a read-only axis is refused with the reason, and the other axis still works", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await page.getByLabel("Columns").selectOption("status");
    const col = await page.evaluate(() => (window as unknown as { __pv: { controller: { row: (id: string) => { status: string | null } } } }).__pv.controller.row("item-1").status);
    const other = col === "In progress" ? "Done" : "In progress";
    await card(page, "item-1").dragTo(cell(page, "Onboarding", other));
    await expect(page.locator(".strip")).toContainText("comes from GitHub");
    expect(await val(page, "item-1", "status")).toBe(col);
    await card(page, "item-1").dragTo(page.locator('[data-lane-head="Retention"]'));
    expect(await val(page, "item-1", "theme")).toBe("Retention"); // only the lane changed
    await settle(page);
  });

  test("keyboard: Shift+arrows move the focused card to the next column or lane, keep the focus, and stop at the edge", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await card(page, "item-1").focus();
    await page.keyboard.press("Shift+ArrowRight");
    expect(await val(page, "item-1", "moscow")).toBe("Should");
    await expect(card(page, "item-1")).toBeFocused();
    await page.keyboard.press("Shift+ArrowDown");
    expect(await val(page, "item-1", "theme")).toBe("Platform health");
    await expect(card(page, "item-1")).toBeFocused();
    await page.keyboard.press("Shift+ArrowUp");
    expect(await val(page, "item-1", "theme")).toBe("Onboarding");
    await expect(card(page, "item-1")).toBeFocused();
    await page.keyboard.press("Shift+ArrowUp");
    await expect(page.getByRole("status").filter({ hasText: "already at the edge" })).toHaveCount(1);
    await settle(page);
    expect(await undoCount(page)).toBe(3);
  });

  test("keyboard: M opens the Move menu with a column and a lane list", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await card(page, "item-1").focus();
    await page.keyboard.press("m");
    const menu = page.getByRole("dialog", { name: "Move R-01" });
    await expect(menu).toBeVisible();
    await menu.getByLabel("MoSCoW").selectOption("Won't");
    await menu.getByLabel("Initiative Group").selectOption("Retention");
    await menu.getByRole("button", { name: "Move" }).click();
    expect(await val(page, "item-1", "moscow")).toBe("Won't");
    expect(await val(page, "item-1", "theme")).toBe("Retention");
    await expect(card(page, "item-1")).toBeFocused();
    await card(page, "item-1").press("m");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await settle(page);
  });

  test("the Move… button does the same with the mouse", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await page.getByRole("button", { name: "Move R-03…" }).click();
    await page.getByRole("dialog", { name: "Move R-03" }).getByLabel("MoSCoW").selectOption("Must");
    await page.getByRole("dialog", { name: "Move R-03" }).getByRole("button", { name: "Move" }).click();
    expect(await val(page, "item-3", "moscow")).toBe("Must");
    await settle(page);
  });

  test("a failed save puts the card back and the strip says why", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await page.evaluate(() => { (window as unknown as { __pv: { source: { failWhen: () => string } } }).__pv.source.failWhen = () => "no permission"; });
    await card(page, "item-1").dragTo(cell(page, "Onboarding", "Could"));
    await expect(page.locator(".strip")).toContainText("no permission");
    expect(await val(page, "item-1", "moscow")).toBe("Must");
    await expect(cell(page, "Onboarding", "Must").locator('[data-card="item-1"]')).toBeVisible();
  });

  test("view-only roles can look but not move cards, and are told why", async ({ page }) => {
    await open(page, "n=40&role=viewer");
    await expect(card(page, "item-1")).toHaveAttribute("draggable", "false");
    await expect(page.getByRole("button", { name: /^Move R-/ })).toHaveCount(0);
    await card(page, "item-1").focus();
    await page.keyboard.press("Shift+ArrowRight");
    expect(await val(page, "item-1", "initiative_phase")).toBe("Discover");
    await expect(page.locator(".gantt-foot")).toContainText("view-only access");
  });
});

test.describe("moving cards between phases (decision gates)", () => {
  test.use({ viewport: { width: 2600, height: 2600 } });
  test("a drop on a phase column is a Move when no gate is crossed: it goes through the gate source, not the undo stack", async ({ page }) => {
    await open(page);
    expect(await val(page, "item-3", "initiative_phase")).toBe("Build");
    await card(page, "item-3").dragTo(cell(page, "Retention", "Test"));
    await expect.poll(() => val(page, "item-3", "initiative_phase")).toBe("Test");
    expect(await page.evaluate(() => (window as unknown as { __pv: { gates: { calls: string[] } } }).__pv.gates.calls)).toContain("move item-3 Test");
    expect(await undoCount(page)).toBe(0);
  });

  test("a drop that passes a gate is refused and names the gate", async ({ page }) => {
    await open(page);
    await card(page, "item-1").dragTo(cell(page, "Onboarding", "Define"));
    await expect(page.locator(".strip")).toContainText("passes decision gate A");
    expect(await val(page, "item-1", "initiative_phase")).toBe("Discover");
    await card(page, "item-3").dragTo(cell(page, "Retention", "Roll-out"));
    await expect(page.locator(".strip")).toContainText("passes decision gate C");
    expect(await val(page, "item-3", "initiative_phase")).toBe("Build");
    expect(await page.evaluate(() => (window as unknown as { __pv: { gates: { calls: string[] } } }).__pv.gates.calls)).toEqual([]);
  });

  test("a failed move puts the card back and says why; a phase is never cleared or set to Completed by a drop", async ({ page }) => {
    await open(page);
    await page.evaluate(() => { (window as unknown as { __pv: { gates: { failMove: string } } }).__pv.gates.failMove = "Only a Creator or an Admin can do this"; });
    await card(page, "item-3").dragTo(cell(page, "Retention", "Test"));
    await expect(page.locator(".strip")).toContainText("Only a Creator or an Admin");
    expect(await val(page, "item-3", "initiative_phase")).toBe("Build");
    await card(page, "item-3").dragTo(cell(page, "Retention", "Completed"));
    await expect(page.locator(".strip")).toContainText("Set Initiative Status to Completed");
  });
});

test.describe("item panel and accessibility", () => {
  test("clicking a card opens the item panel; Esc closes it", async ({ page }) => {
    await open(page);
    await card(page, "item-2").locator(".kc-name").click();
    await expect(page.getByTestId("item-panel")).toContainText("Initiative number 2");
    expect(page.url()).toContain("item=R-02");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
    await card(page, "item-3").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("item-panel")).toContainText("Initiative number 3");
  });

  test("the board passes the WCAG A/AA check, also with the Move menu open", async ({ page }) => {
    await open(page);
    let r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
    await page.getByRole("button", { name: "Move R-01…" }).click();
    r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
  });
});

test.describe("many cards", () => {
  test("600 initiatives draw in a few seconds and a move still registers quickly", async ({ page }) => {
    const t0 = Date.now();
    await open(page, "n=600&by=moscow");
    const first = Date.now() - t0;
    const t1 = Date.now();
    await card(page, "item-1").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(cell(page, "Onboarding", "Should").locator('[data-card="item-1"]')).toBeVisible();
    const move = Date.now() - t1;
    console.log(`600 cards: first view ${first} ms, a move shows in ${move} ms`);
    expect(first).toBeLessThan(8000);
    expect(move).toBeLessThan(2000);
  });
});
