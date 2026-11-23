import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=40") => {
  await page.goto(`/dev/cards?${query}`);
  await page.waitForSelector("[data-card]");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
/** The Columns and Swimlanes controls are popover menus: open one and choose a value by its label. */
const pickAxis = async (page: Page, menu: "Columns" | "Swimlanes", label: string) => {
  await page.getByRole("button", { name: new RegExp(`^${menu}:`) }).click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
};
const axisIs = (page: Page, menu: "Columns" | "Swimlanes", label: string) =>
  expect(page.getByRole("button", { name: new RegExp(`^${menu}:`) })).toContainText(label);
const card = (page: Page, id: string) => page.locator(`[data-card="${id}"]`);
const cell = (page: Page, lane: string, col: string) => page.locator(`[data-lane="${lane}"][data-col="${col}"]`);
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);
const val = (page: Page, id: string, field: string) => page.evaluate(([i, f]) => (window as unknown as { __pv: { controller: { row: (id: string) => Record<string, unknown> } } }).__pv.controller.row(i!)[f!] ?? null, [id, field]);
const undoCount = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { controller: { status: { undoCount: number } } } }).__pv.controller.status.undoCount);

test.describe("the board", () => {
  test("columns are the Initiative Phases and swimlanes the Initiative Groups, with counts", async ({ page }) => {
    await open(page);
    await expect(page.locator(".kb-col-name")).toHaveText(["Discover", "Define", "Build", "Test", "Experiment", "Roll-out", "Completed", "Sunset", "No value"]);
    await expect(page.locator(".kb-lane-head strong")).toHaveText(["Onboarding", "Platform health", "Retention", "No value"]);
    await expect(page.locator(".kb-col-head", { hasText: "Discover" }).locator(".gl-count")).toHaveText("8");
    await expect(page.locator(".kb-lane-head", { hasText: "Onboarding" })).toContainText("items");
    await expect(page.locator(".page-meta")).toContainText("40 initiatives");
  });

  test("a card has four zones: rank, ID and health; name; the chosen fields; owner", async ({ page }) => {
    await open(page);
    const c = card(page, "item-1");
    await expect(c.locator(".kc-rank")).toHaveText("Stack rank 1");
    await expect(c.locator(".kc-id")).toHaveText("R-01");
    await expect(c.locator(".kc-top .pill")).toHaveText("On Track");
    await expect(c.locator(".kc-name")).toContainText("Initiative number 1");
    await expect(c.locator(".kc-size")).toContainText("XS");
    await expect(c.locator(".kc-moscow")).toContainText("Must");
    await expect(c.locator(".kc-moscow")).toHaveClass(/kc-moscow-must/);
    await expect(c.locator(".kc-owner")).toContainText("ana");
    await expect(c.locator(".kc-avatar").first()).toHaveText("AN");
    await expect(c.getByRole("button", { name: "Actions for R-01" })).toBeVisible();
    await expect(c).toHaveAttribute("data-stripe", "good");
  });

  test("the tracker IDs sit next to the ID and open the issue in a new tab; an unsafe link is not clickable", async ({ page }) => {
    await open(page);
    const gh = card(page, "item-1").locator(".kc-ext", { hasText: "#42" });
    await expect(gh).toHaveAttribute("href", "https://github.com/acme/app/issues/42");
    await expect(gh).toHaveAttribute("target", "_blank");
    await expect(gh).toHaveAttribute("rel", /noopener/);
    await expect(card(page, "item-1").locator("a.kc-ext", { hasText: "PLAT-1" })).toHaveCount(0); // javascript: is refused
    await expect(card(page, "item-1").locator(".kc-ext-plain", { hasText: "PLAT-1" })).toBeVisible();
    const jira = card(page, "item-2").locator("a.kc-ext");
    await expect(jira).toHaveText("PLAT-7");
    await expect(jira).toHaveAttribute("href", "https://acme.atlassian.net/browse/PLAT-7");
    await expect(card(page, "item-3").locator(".kc-ext")).toHaveCount(0);
  });

  test("the initiative ID opens the card panel, and the ⋯ menu offers Open, Move… and Copy link", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await card(page, "item-2").locator(".kc-id").click();
    await expect(page.getByTestId("item-panel")).toContainText("Initiative number 2");
    await page.keyboard.press("Escape");
    await card(page, "item-3").getByRole("button", { name: "Actions for R-03" }).click();
    const menu = page.getByRole("menu", { name: "Actions for R-03" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Open", "Move…", "Copy link"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("columns show their sizes and lanes their health, with words", async ({ page }) => {
    await open(page);
    await expect(page.locator(".kb-col-head", { hasText: "Discover" }).locator(".kb-col-sub")).toHaveText(/^(\d+(XL|L|M|S|XS) ?)+$/);
    const head = page.locator(".kb-lane-head", { hasText: "Onboarding" }).locator(".kb-health");
    await expect(head.getByRole("img")).toHaveAttribute("aria-label", /^Health: \d+ /);
  });

  test("an empty cell shows a drop zone while a card is dragged", async ({ page }) => {
    await open(page, "n=12&by=moscow");
    await page.evaluate(() => { (document.querySelector("[data-card]") as HTMLElement).dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })); });
    await expect(page.locator(".kb-dragging")).toHaveCount(1);
  });

  test("the column and swimlane fields can be changed; the read-only GitHub status is offered", async ({ page }) => {
    await open(page);
    await pickAxis(page, "Columns", "Health");
    await expect(page.locator(".kb-col-name")).toHaveText(["On Track", "At Risk", "Delayed", "Blocked", "No value"]);
    expect(page.url()).toContain("by=health");
    await pickAxis(page, "Swimlanes", "No swimlanes");
    await expect(page.locator(".kb-lane-head")).toHaveCount(0);
    expect(page.url()).toContain("lane=none");
    await pickAxis(page, "Columns", "Build Status");
    await expect(page.getByRole("note")).toContainText("Build Status comes from GitHub");
  });

  test("lanes collapse and expand; a lane with no cards starts collapsed", async ({ page }) => {
    await open(page, "n=40");
    await pickAxis(page, "Swimlanes", "Horizon");
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
    await expect(page.locator(".page-meta")).toContainText("filters of “Must haves”");
    expect(await page.locator("[data-card]").count()).toBeLessThan(all);
    await page.locator(".more-views-btn").click();
    await page.getByRole("dialog", { name: "Views" }).getByRole("group", { name: "With dates" }).locator(".vm-open").click();
    await expect(card(page, "item-1")).toContainText("G2M Date (est)");
    await expect(card(page, "item-1")).toContainText("Confidence");
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Prioritisation", exact: true }).click();
    await page.locator(".scope-chip").click();
    await page.getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(page.locator(".page-meta")).toContainText("scope: Customer-facing work");
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
    await axisIs(page, "Swimlanes", "Planned Quarter");
    // every quarter of the planning window is a lane (it lists more than the three with cards): look for the ones that have cards
    const lanes = await page.locator(".kb-lane-head strong").allTextContents();
    expect(lanes).toEqual(expect.arrayContaining(["Q1 2027", "Q2 2027", "Q3 2027", "No value"]));
    await expect(page.locator(".filter-chips")).toContainText("Initiative Phase");
    await expect(card(page, "item-1")).toContainText("G2M Date (est)");

    // Delivery: filters to Build/Test/Experiment, groups swimlanes by Project, shows Build Status and Delivery Progress
    await viewGroup.getByRole("button", { name: "Delivery", exact: true }).click();
    expect(page.url()).toContain("view=Delivery");
    await axisIs(page, "Swimlanes", "Project");
    await expect(card(page, "item-3")).toContainText("Build Status");
    await expect(card(page, "item-3").getByRole("progressbar", { name: "Delivery Progress" })).toBeVisible();

    // Go-to-market: filters to Test/Experiment/Roll-out, groups swimlanes by Audience
    await viewGroup.getByRole("button", { name: "Go-to-market", exact: true }).click();
    expect(page.url()).toContain("view=Go-to-market");
    await axisIs(page, "Swimlanes", "Audience");
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
    await expect(page.locator(".page-meta")).toContainText("40 initiatives");

    // FilterPanel quick filter narrows cards and adds a removable filter chip
    await page.getByRole("button", { name: /^Filter/ }).click();
    await page.getByRole("group", { name: "Filters", exact: true }).getByRole("button", { name: "High impact" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".filter-chips")).toContainText("MoSCoW is Must");
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
    await axisIs(page, "Swimlanes", "Planned Quarter");
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
    await pickAxis(page, "Columns", "Build Status");
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
    await page.getByRole("button", { name: "Actions for R-03" }).click();
    await page.getByRole("menuitem", { name: "Move R-03…" }).click();
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
    await card(page, "item-1").getByRole("button", { name: "Actions for R-01" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Open", "Copy link"]);
    await page.keyboard.press("Escape");
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
    await page.getByRole("button", { name: "Actions for R-01" }).click();
    r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
    await page.getByRole("menuitem", { name: "Move R-01…" }).click();
    r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
  });
});

test.describe("card fields", () => {
  test("the picker says how many of five are used, fills up, greys the rest and shows a live preview", async ({ page }) => {
    await open(page);
    const button = page.getByRole("button", { name: /Card fields:/ });
    await expect(button).toContainText("2 of 5");
    await button.click();
    const panel = page.getByRole("group", { name: "Choose card fields" });
    await expect(panel.locator(".kf-count")).toHaveText("2 of 5");
    for (const f of ["Audience", "Horizon", "Focus Area"]) await panel.getByRole("checkbox", { name: new RegExp(`^${f}`) }).check();
    await expect(panel).toContainText("5 of 5");
    await expect(panel).toContainText("The card is full");
    await expect(panel.getByRole("checkbox", { name: /^Planned Quarter/ })).toBeDisabled();
    await expect(panel.getByRole("list", { name: "Card fields in order" }).getByRole("listitem")).toHaveCount(5);
    await expect(panel.locator(".kf-preview .kc-pill").first()).toBeVisible();
    await panel.getByRole("checkbox", { name: /^Focus Area/ }).uncheck();
    await expect(panel).toContainText("4 of 5");
    await panel.getByRole("button", { name: "Apply card fields (4 of 5)" }).click();
    await expect(page.getByRole("button", { name: /Card fields:/ })).toContainText("4 of 5");
  });

  test("fields too long for a card are not offered, but a search says why", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /Card fields:/ }).click();
    const panel = page.getByRole("group", { name: "Choose card fields" });
    await expect(panel.getByRole("checkbox", { name: /^Description/ })).toHaveCount(0);
    await panel.getByRole("searchbox", { name: "Search card fields" }).fill("description");
    await expect(panel.getByRole("checkbox", { name: /^Description/ }).first()).toBeDisabled();
    await expect(panel).toContainText("too long for a card");
  });

  test("a chosen field shows on the cards in the chosen order, drawn by its type", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /Card fields:/ }).click();
    const panel = page.getByRole("group", { name: "Choose card fields" });
    await panel.getByRole("checkbox", { name: /^Contributing Teams/ }).check();
    await panel.getByRole("button", { name: "Move Contributing Teams up" }).click();
    await panel.getByRole("button", { name: "Move Contributing Teams up" }).click();
    await panel.getByRole("button", { name: /Apply card fields/ }).click();
    await expect(card(page, "item-6").locator(".kc-chips .pill").first()).toContainText("Core");
    await expect(card(page, "item-6").locator(".kc-chips .pill").nth(1)).toContainText("Mobile");
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
