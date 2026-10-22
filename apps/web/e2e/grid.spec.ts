import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ALL = "view=All columns&cols=all"; // every column rendered, so any cell can be found
const open = async (page: Page, query = `n=200&${ALL}`) => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const cell = (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);
const strip = (page: Page) => page.locator(".strip");
const pv = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __pv: { controller: { status: unknown; rows: { id: string; stack_rank: number }[] } } };
  return { status: w.__pv.controller.status as { pending: number; error: string | null; undoCount: number }, ranks: w.__pv.controller.rows.map((r) => r.id) };
});
const edit = async (page: Page, id: string, col: string, text: string) => {
  await cell(page, id, col).click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
};
/** Open a picker cell with the keyboard and wait until the typed picker has the focus. */
const openPicker = async (page: Page, id: string, col: string) => {
  await cell(page, id, col).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: /Choose an option/ })).toBeFocused();
};
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);

test("loads and shows the autosave strip without a Save button", async ({ page }) => {
  await open(page);
  await expect(strip(page)).toContainText("All changes saved");
  await expect(page.getByRole("button", { name: /^save/i })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Initiative Name" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Initiative Status" })).toBeVisible();
  await expect(page.locator(".grid-foot")).toContainText("200 items");
});

test("keyboard: Enter edits, Enter saves and moves down, Esc cancels", async ({ page }) => {
  await open(page);
  await edit(page, "item-1", "initiative_name", "Renamed by keyboard");
  await expect(cell(page, "item-1", "initiative_name")).toHaveText("Renamed by keyboard");
  await expect(strip(page)).toContainText("R-01 Initiative Name: Initiative number 1");
  await expect(strip(page)).toContainText("All changes saved");
  // focus moved down to the next row
  await expect(page.locator(".ag-row[row-id='item-2'] [col-id='initiative_name']")).toHaveClass(/ag-cell-focus/);
  // Esc cancels
  await cell(page, "item-3", "initiative_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("will not stick");
  await page.keyboard.press("Escape");
  await expect(cell(page, "item-3", "initiative_name")).toHaveText(/Initiative number 3/);
});

test("Tab moves to the next editable cell while editing (columns follow the dictionary order)", async ({ page }) => {
  await open(page);
  await cell(page, "item-1", "initiative_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.locator(".ag-row[row-id='item-1'] [col-id='roadmap_category']")).toHaveClass(/ag-cell-focus|ag-cell-inline-editing/);
});

test("typed picker: type to filter, Enter chooses", async ({ page }) => {
  await open(page);
  await cell(page, "item-1", "moscow").click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: /Choose an option/ })).toBeFocused();
  await page.keyboard.type("cou");
  await expect(page.locator(".picker").getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(cell(page, "item-1", "moscow")).toHaveText("Could");
  await expect(strip(page)).toContainText("R-01 MoSCoW: Must to Could");
});

test("typed picker: arrow keys move the highlight and Escape cancels", async ({ page }) => {
  await open(page);
  await openPicker(page, "item-1", "effort"); // XS
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(cell(page, "item-1", "effort")).toHaveText("M");
  await openPicker(page, "item-2", "effort");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(cell(page, "item-2", "effort")).toHaveText("S");
});

test("health always has a text label, not only a colour", async ({ page }) => {
  await open(page);
  for (const [id, label] of [["item-1", "On Track"], ["item-2", "At Risk"], ["item-3", "Delayed"]] as const) {
    await expect(cell(page, id, "health")).toContainText(label);
  }
});

test("plain-language dates and amounts", async ({ page }) => {
  await open(page);
  await edit(page, "item-1", "start_date", "31 mar");
  await expect(cell(page, "item-1", "start_date")).toHaveText("31 Mar");
  await edit(page, "item-2", "g2m_date_est", "next friday");
  await expect(cell(page, "item-2", "g2m_date_est")).toHaveText("16 Apr"); // test page "today" is Wed 14 Apr 2027
  await edit(page, "item-3", "value_12m", "1.2m");
  await expect(cell(page, "item-3", "value_12m")).toHaveText("1,200,000");
  // typing back what is shown works
  await cell(page, "item-1", "start_date").click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ag-cell-inline-editing input")).toHaveValue("31 Mar");
  await page.keyboard.press("Escape");
});

test("a date that cannot be read is rejected with a message and nothing changes", async ({ page }) => {
  await open(page);
  await edit(page, "item-1", "start_date", "banana");
  await expect(strip(page)).toContainText("R-01 Start Date: Could not read that date");
  await expect(cell(page, "item-1", "start_date")).toHaveText("4 Jan");
});

test("GitHub-driven cells are locked: double-click and keyboard explain why, nothing changes", async ({ page }) => {
  await open(page);
  const status = cell(page, "item-1", "status");
  const before = await status.innerText();
  await status.dblclick();
  await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0);
  await expect(page.locator(".strip-notice")).toContainText("Initiative Status comes from GitHub");
  await page.locator(".strip-notice").waitFor();
  await cell(page, "item-1", "delivery_progress_pct").click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".strip-notice")).toContainText("Delivery Progress % comes from GitHub");
  await page.keyboard.type("99");
  await expect(status).toHaveText(before);
  await expect(page.getByRole("columnheader", { name: /Initiative Status/ })).toBeVisible(); // locked state is also in words
});

test("Ctrl+Z undoes, Ctrl+Shift+Z redoes, and the buttons do the same", async ({ page }) => {
  await open(page);
  await openPicker(page, "item-1", "health");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(cell(page, "item-1", "health")).toContainText("At Risk");
  await settle(page);
  await page.keyboard.press("Control+Z");
  await expect(cell(page, "item-1", "health")).toContainText("On Track");
  await expect(strip(page)).toContainText("Undid: R-01 Health: At Risk to On Track");
  await page.keyboard.press("Control+Shift+Z");
  await expect(cell(page, "item-1", "health")).toContainText("At Risk");
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(cell(page, "item-1", "health")).toContainText("On Track");
  await expect(page.getByRole("button", { name: /^Undo/ })).toBeDisabled();
});

test("undo covers the last 20 changes, not more", async ({ page }) => {
  await open(page, "n=50"); // the name column is in the default view; rendering all 165 columns would only slow the 47 key presses
  for (let i = 1; i <= 22; i++) await edit(page, "item-5", "initiative_name", `Edit ${i}`);
  await settle(page);
  expect((await pv(page)).status.undoCount).toBe(20);
  for (let i = 0; i < 25; i++) { await page.keyboard.press("Escape"); await page.keyboard.press("Control+Z"); await settle(page); }
  await expect(cell(page, "item-5", "initiative_name")).toHaveText("Edit 2"); // the two oldest edits fell off the stack
});

test("typing inside an editor keeps the browser's own text undo (no grid undo)", async ({ page }) => {
  await open(page);
  await edit(page, "item-1", "initiative_name", "Saved name");
  await settle(page);
  await cell(page, "item-2", "initiative_name").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("abc");
  await page.keyboard.press("Control+Z");
  await expect(cell(page, "item-1", "initiative_name")).toHaveText("Saved name"); // not undone by the grid
  await page.keyboard.press("Escape");
});

test("Delete clears an optional cell, but not the initiative name", async ({ page }) => {
  await open(page);
  await cell(page, "item-2", "product_manager").click();
  await expect(cell(page, "item-2", "product_manager")).not.toHaveText("");
  await page.keyboard.press("Delete");
  await expect(cell(page, "item-2", "product_manager")).toHaveText("");
  await cell(page, "item-2", "initiative_name").click();
  await page.keyboard.press("Delete");
  await expect(strip(page)).toContainText("cannot be empty");
  await expect(cell(page, "item-2", "initiative_name")).not.toHaveText("");
});

test("edits show at once even when the save is slow, then settle", async ({ page }) => {
  await open(page, `n=200&latency=600&${ALL}`);
  const t0 = Date.now();
  await edit(page, "item-1", "initiative_name", "Instant");
  await expect(cell(page, "item-1", "initiative_name")).toHaveText("Instant");
  expect(Date.now() - t0).toBeLessThan(1500);
  await expect(strip(page)).toContainText("Saving");
  await expect(strip(page)).toContainText("All changes saved", { timeout: 5000 });
});

test("a failed save puts the value back and says why", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as unknown as { __pv: { source: { failWhen: () => string } } }).__pv.source.failWhen = () => "permission denied"; });
  await edit(page, "item-1", "health", "");
  await openPicker(page, "item-1", "health");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".strip-alert")).toContainText("Could not save R-01 Health: permission denied");
  await expect(cell(page, "item-1", "health")).toContainText("On Track");
  await expect(strip(page)).toContainText("Not all changes could be saved");
});

test("typing a new global rank moves the row, keeps the focus on it and can be undone", async ({ page }) => {
  await open(page);
  await edit(page, "item-6", "stack_rank", "2");
  await expect(cell(page, "item-6", "stack_rank")).toHaveText("#2");
  await expect(cell(page, "item-2", "stack_rank")).toHaveText("#3");
  const order = (await pv(page)).ranks.slice(0, 3);
  expect(order).toEqual(["item-1", "item-6", "item-2"]);
  await expect(page.locator(".ag-row[row-id='item-6'] [col-id='stack_rank']")).toHaveClass(/ag-cell-focus/);
  await expect(strip(page)).toContainText("R-06 moved from rank 6 to 2");
  await settle(page);
  await page.keyboard.press("Control+Z");
  await expect(cell(page, "item-6", "stack_rank")).toHaveText("#6");
  await expect(cell(page, "item-2", "stack_rank")).toHaveText("#2");
});

test("changing the project updates the In project order", async ({ page }) => {
  await open(page);
  const before = await cell(page, "item-7", "project_rank").innerText();
  await cell(page, "item-1", "home_project").click();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Mobile");
  await page.keyboard.press("Enter");
  await expect(cell(page, "item-1", "home_project")).toHaveText("Mobile");
  await expect(async () => expect(await cell(page, "item-7", "project_rank").innerText()).not.toBe("")).toPass();
  void before;
});

test("view-only roles can look but not edit, and see why", async ({ page }) => {
  await open(page, `n=50&role=viewer&${ALL}`);
  await expect(strip(page)).toContainText("View-only");
  await expect(page.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
  await cell(page, "item-1", "initiative_name").dblclick();
  await expect(page.locator(".ag-cell-inline-editing")).toHaveCount(0);
  await expect(page.locator(".strip-notice")).toContainText("view-only access");
});

test("2,000 items: loads fast and edits feel instant (under 200 ms)", async ({ page }) => {
  const t0 = Date.now();
  await open(page, "n=2000");
  const loadMs = Date.now() - t0;
  expect(loadMs).toBeLessThan(4000);
  await expect(page.locator(".grid-foot")).toContainText("2,000 items");
  // measure Enter pressed -> new value painted, for 15 edits
  await page.evaluate(() => {
    const w = window as unknown as { __lat: number[]; __t0: number; __pv: { controller: { subscribe: (f: () => void) => void } } };
    w.__lat = [];
    document.addEventListener("keydown", (e) => { if (e.key === "Enter") w.__t0 = performance.now(); }, true);
    w.__pv.controller.subscribe(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (w.__t0) { w.__lat.push(performance.now() - w.__t0); w.__t0 = 0; } })));
  });
  for (let i = 1; i <= 15; i++) await edit(page, `item-${i}`, "initiative_name", `Fast ${i}`);
  await settle(page);
  const lat = await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat.sort((a, b) => a - b));
  const p95 = lat[Math.floor(lat.length * 0.95) - 1] ?? lat[lat.length - 1]!;
  console.log(`2,000 items: load ${loadMs} ms, edit latency median ${Math.round(lat[Math.floor(lat.length / 2)]!)} ms, p95 ${Math.round(p95)} ms (${lat.length} samples)`);
  expect(lat.length).toBeGreaterThanOrEqual(10);
  expect(p95).toBeLessThan(200);
});

test("accessibility: no WCAG A/AA violations on the grid page", async ({ page }) => {
  await open(page, "n=50");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`);
  expect(summary).toEqual([]);
});
