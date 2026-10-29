import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { hasChanges, viewMenuAction, viewTab } from "./helpers";

const open = async (page: Page, query = "n=30&role=admin&view=All columns&cols=all") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
const filterBtn = (page: Page) => page.getByRole("button", { name: /^(Add filter|\d+ filters?)/ });
const columnsBtn = (page: Page) => page.getByRole("button", { name: /columns shown$/ });
const filtersPanel = (page: Page) => page.getByRole("group", { name: "Filters", exact: true });
const columnsPanel = (page: Page) => page.getByRole("group", { name: "Choose columns" });
const select = async (page: Page, ...ids: string[]) => { for (const id of ids) await page.locator(`.ag-row[row-id="${id}"] input[type="checkbox"]`).first().check(); };
const foot = (page: Page) => page.locator(".grid-foot");

test.describe("the bar above the grid (0.30.0)", () => {
  test("the first line holds filter, columns, group by, search, export, paste, sync, status and undo on ONE line", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await open(page);
    const mid = async (b: ReturnType<Page["locator"]>) => { const x = (await b.first().boundingBox())!; return x.y + x.height / 2; };
    const ref = await mid(filterBtn(page));
    for (const loc of [columnsBtn(page), page.getByRole("button", { name: /^Group by/ }), page.getByLabel("Search initiatives"), page.getByRole("button", { name: /^Export/ }), page.getByRole("button", { name: "Paste table" }), page.getByRole("button", { name: /^Sync with GitHub/ }), page.getByRole("button", { name: /^Undo/ }), page.getByRole("button", { name: /^Redo/ })]) {
      expect(Math.abs((await mid(loc)) - ref)).toBeLessThan(6);
    }
    await expect(page.getByText("All changes saved")).toBeVisible();
  });

  test("when a label grows (Export 3) nothing wraps: search gives up width first", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await open(page);
    const before = (await page.locator(".pvbar-search").boundingBox())!;
    const y0 = (await filterBtn(page).boundingBox())!.y;
    await select(page, "item-1", "item-2", "item-3");
    await expect(page.getByRole("button", { name: "Export 3" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync with GitHub" })).toBeVisible();
    const after = (await page.locator(".pvbar-search").boundingBox())!;
    expect(after.width).toBeLessThanOrEqual(before.width);
    const undo = (await page.getByRole("button", { name: /^Undo/ }).boundingBox())!;
    expect(Math.abs(undo.y - y0)).toBeLessThan(12);
  });

  test("order: first line, the batch bar only while rows are selected, then Add an initiative; all above the grid and as wide as it", async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 });
    await open(page);
    await expect(page.locator(".bulk-bar")).toHaveCount(0);
    await select(page, "item-1");
    const s1 = await box(page, ".pvbar-s1"), bulk = await box(page, ".bulk-bar"), quick = await box(page, ".quick-add"), grid = await box(page, ".grid-wrap");
    expect(s1.y).toBeLessThan(bulk.y);
    expect(bulk.y).toBeLessThan(quick.y);
    expect(quick.y + quick.height).toBeLessThanOrEqual(grid.y + 0.5);
    expect(Math.abs((await box(page, ".pvbar")).width - grid.width)).toBeLessThan(40);
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect(page.locator(".bulk-bar")).toHaveCount(0);
  });

  test("Export says how many (all shown rows, or the selected ones) and downloads exactly those", async ({ page }) => {
    await open(page, "n=12&role=admin");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /CSV file \(12 rows/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await select(page, "item-1", "item-2");
    await page.getByRole("button", { name: "Export 2" }).click();
    const dl = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /CSV file \(2 rows/ }).click();
    expect((await dl).suggestedFilename()).toMatch(/^roadmap-selection-/);
  });

  test("Sync with GitHub is on the bar (disabled when GitHub is not connected); the batch bar no longer has it", async ({ page }) => {
    await open(page);
    await select(page, "item-1");
    await expect(page.getByRole("button", { name: /^Sync with GitHub/ })).toBeDisabled();
    await expect(page.locator(".bulk-bar").getByRole("button", { name: /GitHub/ })).toHaveCount(0);
  });

  test("view-only: no Paste table, no Add an initiative, but Export works", async ({ page }) => {
    await open(page, "n=10&role=viewer&view=All columns&cols=all");
    await expect(page.getByRole("button", { name: "Paste table" })).toHaveCount(0);
    await expect(page.getByLabel("Add an initiative")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  });
});

test.describe("panels that expand from the bar", () => {
  test("Filters and Columns both expand under their button (not a modal), close on Escape and on a click outside", async ({ page }) => {
    await open(page);
    for (const [btn, panel] of [[filterBtn(page), filtersPanel(page)], [columnsBtn(page), columnsPanel(page)]] as const) {
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      await expect(panel).toBeVisible();
      await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
      const b = (await btn.boundingBox())!, p = (await panel.boundingBox())!;
      expect(p.y).toBeGreaterThan(b.y + b.height - 2);
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(btn).toBeFocused();
      await btn.click();
      await page.getByRole("heading", { name: "Roadmap (test page)" }).click();
      await expect(panel).toHaveCount(0);
    }
  });

  test("Group by looks the same: a button with an arrow that expands a panel", async ({ page }) => {
    await open(page);
    const g = page.getByRole("button", { name: /^Group by/ });
    await expect(g).toContainText("None");
    await g.click();
    await expect(g).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("menuitemradio", { name: "MoSCoW" }).click();
    await expect(g).toContainText("MoSCoW");
  });
});

test.describe("filter panel", () => {
  test("quick filters toggle on and off, count as filters, and are combined with AND", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    const high = page.getByRole("button", { name: "High impact" });
    await high.click();
    await expect(high).toHaveAttribute("aria-pressed", "true");
    await expect(filterBtn(page)).toContainText("1 filter");
    await page.getByRole("button", { name: "Needs attention" }).click();
    await expect(filterBtn(page)).toContainText("2 filters");
    await high.click();
    await expect(high).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Needs attention" }).click();
    await expect(filterBtn(page)).toContainText("Add filter");
    await expect(foot(page)).toContainText("30 items");
  });

  test("a rule can match any of several values; the panel shows how many initiatives match", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    const panel = filtersPanel(page);
    await panel.getByRole("button", { name: "+ Add rule" }).click();
    await panel.getByLabel("Operator of filter 1").selectOption("any_of");
    await panel.getByLabel("Add a value to filter 1").selectOption({ label: "Must" });
    await panel.getByLabel("Add a value to filter 1").selectOption({ label: "Should" });
    await expect(panel.getByRole("group", { name: "Values of filter 1" })).toContainText("Must");
    await expect(panel).toContainText(/\d+ of 30 initiatives match/);
    await panel.getByRole("button", { name: "Remove Must" }).click();
    await panel.getByRole("button", { name: "Clear all" }).click();
    await expect(foot(page)).toContainText("30 items");
  });

  test("Created today, this week and this month are filters on Created At", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    await page.getByRole("button", { name: "Created this month" }).click();
    await expect(filtersPanel(page)).toContainText(/\d+ of 30 initiatives match/);
  });

  test("the Filters panel has no save controls: saving is done from the view bar", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    await page.getByRole("button", { name: "High impact" }).click();
    await expect(filtersPanel(page).getByRole("button", { name: /Save/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(hasChanges(page)).toBeVisible();
    await expect(page.locator(".view-dirty")).toHaveCount(0); // no alert bar
  });

  test("three panes: categories with counts, a checklist, and the selected columns in order", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation&cols=all");
    await columnsBtn(page).click();
    const panel = columnsPanel(page);
    await expect(panel.getByRole("navigation", { name: "Column categories" })).toContainText("All columns");
    await expect(panel.getByRole("navigation", { name: "Column categories" })).toContainText("What");
    await expect(panel.getByRole("list", { name: "Selected columns in order" })).toContainText("Stack Rank");
    await panel.getByRole("button", { name: /^When/ }).click();
    await expect(panel.getByRole("checkbox", { name: /Planned Start/ })).toBeVisible();
  });

  test("changes are staged: Cancel discards them, Apply puts them in the grid, Reset goes back to the view", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation&cols=all");
    const header = (name: RegExp) => page.getByRole("columnheader", { name });
    await columnsBtn(page).click();
    await columnsPanel(page).getByRole("button", { name: /^When/ }).click();
    await columnsPanel(page).getByRole("checkbox", { name: /Planned Start/ }).check();
    await columnsPanel(page).getByRole("button", { name: "Cancel" }).click();
    await expect(header(/Planned Start/)).toHaveCount(0);
    await columnsBtn(page).click();
    await columnsPanel(page).getByRole("button", { name: /^When/ }).click();
    await columnsPanel(page).getByRole("checkbox", { name: /Planned Start/ }).check();
    await columnsPanel(page).getByRole("button", { name: /^Apply columns/ }).click();
    await expect(header(/Planned Start/).first()).toBeVisible();
    await columnsBtn(page).click();
    await columnsPanel(page).getByRole("button", { name: "Reset to view default" }).click();
    await columnsPanel(page).getByRole("button", { name: /^Apply columns/ }).click();
    await expect(header(/Planned Start/)).toHaveCount(0);
  });

  test("a fifth column cannot be pinned and says why; moving the pinned column out of the first four drops its pin", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation&cols=all");
    await columnsBtn(page).click();
    const panel = columnsPanel(page);
    const list = panel.getByRole("list", { name: "Selected columns in order" });
    const names = async () => list.getByRole("listitem").locator(".name").allInnerTexts();
    const before = await names();
    const fourth = before[3]!, fifth = before[4]!;
    await panel.getByRole("button", { name: `Pin ${fourth}` }).click();
    await expect(panel.getByRole("button", { name: `Unpin ${fourth}` })).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: `Pin ${fifth}` }).click();
    await expect(panel.getByRole("status")).toContainText("Only the first 4 columns can be pinned to the left.");
    await panel.getByRole("button", { name: `Move ${fifth} up` }).click();
    expect((await names())[3]).toBe(fifth);
    await expect(panel.getByRole("button", { name: `Pin ${fourth}` })).toBeVisible(); // pushed to the fifth place: no longer pinned
  });

  test("Refresh data sits after Redo, reads the roadmap again, and an initiative created elsewhere appears", async ({ page }) => {
    await open(page, "n=12&role=admin");
    const redo = page.getByRole("button", { name: /^Redo/ });
    const refresh = page.getByRole("button", { name: "Refresh data" });
    await expect(refresh).toBeVisible();
    expect((await refresh.boundingBox())!.x).toBeGreaterThan((await redo.boundingBox())!.x);
    // an initiative that was pulled in from the Sync window (another route into the same database)
    await page.evaluate(() => {
      const pv = (window as unknown as { __pv: { source: { items: Record<string, unknown>[] } } }).__pv;
      pv.source.items.push({ ...pv.source.items[0]!, id: "item-pulled", item_code: "R-77", initiative_name: "Pulled in from GitHub", stack_rank: 13 });
    });
    await expect(page.locator('.ag-row[row-id="item-pulled"]')).toHaveCount(0);
    await refresh.click();
    await expect(page.getByRole("status").filter({ hasText: "Data refreshed." })).toBeAttached();
    await expect(page.locator('.ag-row[row-id="item-pulled"]')).toContainText("Pulled in from GitHub");
  });

  test("moving a column keeps the panel open and the focus on that column's arrow, so the arrow can be pressed again", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation&cols=all");
    await columnsBtn(page).click();
    const panel = columnsPanel(page);
    const list = panel.getByRole("list", { name: "Selected columns in order" });
    const names = async () => list.getByRole("listitem").locator(".name").allInnerTexts();
    const before = await names();
    const moving = before[6]!;
    await panel.getByRole("button", { name: `Move ${moving} up` }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // the same arrow again, with no click in between
    await expect(panel).toBeVisible();
    expect(await names()).toEqual([...before.slice(0, 4), moving, ...before.slice(4, 6), ...before.slice(7)]);
    await expect(panel.getByRole("button", { name: `Move ${moving} up` })).toBeFocused();
    // at the top of the movable part the up arrow is switched off and the focus goes to the down arrow
    await page.keyboard.press("Enter");
    await expect(panel.getByRole("button", { name: `Move ${moving} up` })).toBeDisabled();
    await expect(panel.getByRole("button", { name: `Move ${moving} down` })).toBeFocused();
    await expect(panel).toBeVisible();
  });

  test("a pinned column stays on the left", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation&cols=all");
    await columnsBtn(page).click();
    const panel = columnsPanel(page);
    const fourth = (await panel.getByRole("list", { name: "Selected columns in order" }).getByRole("listitem").locator(".name").allInnerTexts())[3]!;
    await panel.getByRole("button", { name: `Pin ${fourth}` }).click();
    await panel.getByRole("button", { name: /^Apply columns/ }).click();
    // scroll the grid sideways as far as it goes: the pinned column is still there, and the horizontal scroll really moved
    await page.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    expect(await page.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(page.getByRole("columnheader", { name: new RegExp(fourth) }).first()).toBeVisible();
  });

  test("the Columns panel has no save controls; the views menu saves what you applied", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation&cols=all");
    await columnsBtn(page).click();
    await columnsPanel(page).getByRole("button", { name: /^When/ }).click();
    await columnsPanel(page).getByRole("checkbox", { name: /Planned Start/ }).check();
    await expect(columnsPanel(page).getByRole("button", { name: /Save/ })).toHaveCount(0);
    await columnsPanel(page).getByRole("button", { name: /^Apply columns/ }).click();
    await viewMenuAction(page, "Save as new view…");
    await page.getByRole("dialog", { name: "Save as new view" }).getByLabel("Name").fill("With start");
    await page.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(viewTab(page, "With start")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("columnheader", { name: /Planned Start/ }).first()).toBeVisible();
  });

  test("accessibility: the bar and its two panels have no WCAG A/AA violations", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    let results = await new AxeBuilder({ page }).include(".pvbar").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await page.keyboard.press("Escape");
    await columnsBtn(page).click();
    results = await new AxeBuilder({ page }).include(".pvbar").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe("Add an initiative: type it in one line", () => {
  test("the most important words are shown in the bar, the rest are under Shortcuts", async ({ page }) => {
    await open(page);
    const box = await page.getByPlaceholder(/^Enter adds/).getAttribute("placeholder");
    for (const w of ["Paste a list to add many", "#platform", "@anna", "+growth", "more under Shortcuts"]) expect(box).toContain(w);
    await page.goto("/dev/item/R-01");
    await page.getByRole("button", { name: "Shortcuts" }).click();
    const dialog = page.getByRole("dialog", { name: /keyboard shortcuts/i });
    await expect(dialog).toContainText("Add an initiative: type it in one line");
    for (const word of ["~now", "!atrisk", "start:mon", "by:31/03", "Paste a list"]) await expect(dialog).toContainText(word);
  });

  test("~horizon, !health and start:/by: dates fill their fields in one go", async ({ page }) => {
    await open(page);
    await page.getByLabel("Add an initiative").click();
    await page.keyboard.type("Smart idea #market ~next !atrisk by:31/12/2027 M must");
    await expect(page.locator(".quick-add .token-chip")).toContainText(["Project: Marketplace", "Effort: M", "MoSCoW: Must", "Horizon: Next", "Health: At Risk"]);
    await expect(page.locator(".quick-add .token-chip").filter({ hasText: "G2M Date (est)" })).toHaveCount(1);
    await page.keyboard.press("Enter");
    const row = page.locator(".ag-row", { has: page.locator('[col-id="initiative_name"]', { hasText: "Smart idea" }) });
    await expect(row.locator('[col-id="horizon"]')).toHaveText("Next");
    await expect(row.locator('[col-id="health"]')).toHaveText("At Risk");
    await expect(row.locator('[col-id="g2m_date_est"]')).toHaveText("31 Dec");
  });

  test("a word it cannot read is explained before anything is added", async ({ page }) => {
    await open(page);
    await page.getByLabel("Add an initiative").fill("Idea #market !fine");
    await expect(page.locator(".quick-add-hints")).toContainText("Health is !ontrack");
  });
});

test.describe("Shortcuts, Help and text size in the top bar", () => {
  test("Shortcuts opens the keyboard list and Help opens the guide with its three tables", async ({ page }) => {
    await page.goto("/dev/item/R-01");
    await page.getByRole("button", { name: "Shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Help", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "Help" });
    await expect(guide.getByRole("table", { name: /Columns, and how each one relates/ })).toContainText("Read-only (tracker)");
    await expect(guide.getByRole("status")).toContainText("170 of 170 columns");
    await guide.getByPlaceholder(/Filter columns/).fill("sponsor");
    await expect(guide.getByRole("status")).toContainText("1 of 170 columns");
    await guide.getByRole("tab", { name: "How content flows" }).click();
    await expect(guide.getByRole("table")).toHaveCount(3);
    await guide.getByRole("tab", { name: "Using Claude" }).click();
    await expect(guide).toContainText("write_prd");
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("A+ and A− scale the workspace and stop at the ends", async ({ page }) => {
    await page.goto("/dev/item/R-01");
    const zoom = () => page.locator(".shell").evaluate((el) => (el as HTMLElement).style.zoom || "1");
    await page.getByRole("button", { name: "Larger text" }).click();
    expect(await zoom()).toBe("1.1");
    await page.getByRole("button", { name: "Smaller text" }).click();
    await page.getByRole("button", { name: "Smaller text" }).click();
    expect(await zoom()).toBe("0.9");
    await expect(page.getByRole("button", { name: "Smaller text" })).toBeDisabled();
  });
});
