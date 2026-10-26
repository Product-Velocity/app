import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
    for (const loc of [columnsBtn(page), page.getByRole("button", { name: /^Group by/ }), page.getByLabel("Search initiatives"), page.getByRole("button", { name: /^Export/ }), page.getByRole("button", { name: "Paste table" }), page.getByRole("button", { name: /^Sync GitHub/ }), page.getByRole("button", { name: /^Undo/ }), page.getByRole("button", { name: /^Redo/ })]) {
      expect(Math.abs((await mid(loc)) - ref)).toBeLessThan(6);
    }
    await expect(page.getByText("All changes saved")).toBeVisible();
  });

  test("when a label grows (Export 3, 2 filters) nothing wraps: search gives up width first", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await open(page);
    const before = (await page.locator(".gbar-search").boundingBox())!;
    const y0 = (await filterBtn(page).boundingBox())!.y;
    await select(page, "item-1", "item-2", "item-3");
    await filterBtn(page).click();
    await page.getByRole("button", { name: "High impact" }).click();
    await page.getByRole("button", { name: "In progress" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Export 3" })).toBeVisible();
    await expect(filterBtn(page)).toContainText("2 filters");
    const after = (await page.locator(".gbar-search").boundingBox())!;
    expect(after.width).toBeLessThanOrEqual(before.width);
    const undo = (await page.getByRole("button", { name: /^Undo/ }).boundingBox())!;
    expect(Math.abs(undo.y - y0)).toBeLessThan(12);
  });

  test("order: first line, the batch bar only while rows are selected, then Add an initiative; all above the grid and as wide as it", async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 });
    await open(page);
    await expect(page.locator(".bulk-bar")).toHaveCount(0);
    await select(page, "item-1");
    const s1 = await box(page, ".gbar-s1"), bulk = await box(page, ".bulk-bar"), quick = await box(page, ".quick-add"), grid = await box(page, ".grid-wrap");
    expect(s1.y).toBeLessThan(bulk.y);
    expect(bulk.y).toBeLessThan(quick.y);
    expect(quick.y + quick.height).toBeLessThanOrEqual(grid.y + 0.5);
    expect(Math.abs((await box(page, ".gbar")).width - grid.width)).toBeLessThan(40);
    await page.keyboard.press("Escape");
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

  test("Sync GitHub is on the bar (disabled when GitHub is not connected); the batch bar no longer has it", async ({ page }) => {
    await open(page);
    await select(page, "item-1");
    await expect(page.getByRole("button", { name: /^Sync GitHub/ })).toBeDisabled();
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

  test("the panel ends with Save to this view: a default view offers Save as new view…, a saved view offers Save to it", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    await page.getByRole("button", { name: "High impact" }).click();
    await filtersPanel(page).getByRole("button", { name: "Save as new view…" }).click();
    await page.getByRole("dialog", { name: "Save view" }).getByLabel("Name").fill("Must haves");
    await page.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Views/ })).toContainText("Must haves");
    await filterBtn(page).click();
    await expect(filtersPanel(page).getByRole("button", { name: "Save to “Must haves”" })).toBeDisabled(); // nothing changed since saving
    await page.getByRole("button", { name: "In progress" }).click();
    await expect(filtersPanel(page).getByRole("button", { name: "Save to “Must haves”" })).toBeEnabled();
  });
});

test.describe("column picker", () => {
  test("three panes: categories with counts, a checklist, and the selected columns in order", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation");
    await columnsBtn(page).click();
    const panel = columnsPanel(page);
    await expect(panel.getByRole("navigation", { name: "Column categories" })).toContainText("All columns");
    await expect(panel.getByRole("navigation", { name: "Column categories" })).toContainText("What");
    await expect(panel.getByRole("list", { name: "Selected columns in order" })).toContainText("Stack Rank");
    await panel.getByRole("button", { name: /^When/ }).click();
    await expect(panel.getByRole("checkbox", { name: /Planned Start/ })).toBeVisible();
  });

  test("changes are staged: Cancel discards them, Apply puts them in the grid, Reset goes back to the view", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation");
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
    await open(page, "n=30&role=admin&view=Prioritisation");
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

  test("a pinned column stays on the left", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation");
    await columnsBtn(page).click();
    const panel = columnsPanel(page);
    const fourth = (await panel.getByRole("list", { name: "Selected columns in order" }).getByRole("listitem").locator(".name").allInnerTexts())[3]!;
    await panel.getByRole("button", { name: `Pin ${fourth}` }).click();
    await panel.getByRole("button", { name: /^Apply columns/ }).click();
    await expect(page.locator(".ag-pinned-left-header").getByText(fourth, { exact: true })).toBeVisible();
  });

  test("Save as new view… at the bottom saves what you staged", async ({ page }) => {
    await open(page, "n=30&role=admin&view=Prioritisation");
    await columnsBtn(page).click();
    await columnsPanel(page).getByRole("button", { name: /^When/ }).click();
    await columnsPanel(page).getByRole("checkbox", { name: /Planned Start/ }).check();
    await columnsPanel(page).getByRole("button", { name: "Save as new view…" }).click();
    await page.getByRole("dialog", { name: "Save view" }).getByLabel("Name").fill("With start");
    await page.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Views/ })).toContainText("With start");
    await expect(page.getByRole("columnheader", { name: /Planned Start/ }).first()).toBeVisible();
  });

  test("accessibility: the bar and its two panels have no WCAG A/AA violations", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    let results = await new AxeBuilder({ page }).include(".gbar").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await page.keyboard.press("Escape");
    await columnsBtn(page).click();
    results = await new AxeBuilder({ page }).include(".gbar").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe("Add an initiative: type it in one line", () => {
  test("the most important words are shown in the bar, the rest are under Help", async ({ page }) => {
    await open(page);
    const legend = page.locator(".quick-add-legend");
    await expect(legend).toContainText("#platform");
    await expect(legend).toContainText("@anna");
    await expect(legend).toContainText("+growth");
    await page.goto("/dev/item/R-01");
    await page.getByRole("button", { name: "Help" }).click();
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
    await expect(row.locator('[col-id="g2m_date_est"]')).toContainText("2027");
  });

  test("a word it cannot read is explained before anything is added", async ({ page }) => {
    await open(page);
    await page.getByLabel("Add an initiative").fill("Idea #market !fine");
    await expect(page.locator(".quick-add-hints")).toContainText("Health is !ontrack");
  });
});
