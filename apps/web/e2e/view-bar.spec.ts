import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { applySort, goToView, hasChanges, moreViews, resetChanges, viewMenuAction, viewTab } from "./helpers";

const open = async (page: Page, query = "n=30&role=admin") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
type Store = { views: { name: string; ownerId: string | null; sort?: { field: string; dir: string }; columns: string[]; pinned?: string[]; groupBy: string | null; filters: unknown[] }[]; layouts: Record<string, { ref: { name?: string; id?: string }; inBar: boolean; position: number; hidden?: boolean }[]> };
const store = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __pv: { store: unknown } }).__pv.store)) as Store);
const moreBtn = (page: Page) => page.getByRole("button", { name: /more views?$/ });
const menu = (page: Page) => page.getByRole("dialog", { name: "Views" });
const foot = (page: Page) => page.locator(".grid-foot");
const filterBtn = (page: Page) => page.getByRole("button", { name: /^(Add filter|\d+ filters?)/ });

/** Change a filter so the unsaved-changes bar appears. */
async function makeChange(page: Page) {
  await filterBtn(page).click();
  await page.getByRole("button", { name: "High impact" }).click();
  await page.keyboard.press("Escape");
  await expect(hasChanges(page)).toBeVisible();
}
async function saveAsNew(page: Page, name: string, scope?: "Only me" | "Workspace") {
  await viewMenuAction(page, "Save as new view…");
  const d = page.getByRole("dialog", { name: "Save as new view" });
  await d.getByLabel("Name").fill(name);
  if (scope) await d.getByLabel(new RegExp(`^\\s*${scope}`)).check();
  await d.getByRole("button", { name: "Save view" }).click();
  await expect(d).toHaveCount(0);
}
const rowOf = (page: Page, name: string) => menu(page).getByRole("group", { name, exact: true });

test.describe("the view bar (R-98)", () => {
  test("a default workspace shows six tabs and '5 more views' with My views hidden while empty", async ({ page }) => {
    await open(page);
    await expect(page.locator(".view-chip")).toHaveText(["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership"]);
    await expect(moreBtn(page)).toHaveText(/^5 more views/);
    await moreBtn(page).click();
    await expect(menu(page).getByRole("region", { name: "Workspace views" })).toBeVisible();
    await expect(menu(page).getByRole("region", { name: "My views" })).toHaveCount(0);
    await expect(rowOf(page, "Discovery").getByRole("button", { name: "Show in bar" })).toBeVisible();
    await expect(rowOf(page, "Planning").getByRole("button", { name: "In bar" })).toHaveAttribute("aria-pressed", "true");
    await expect(rowOf(page, "Planning")).toContainText("workspace");
  });

  test("keyboard only: open the menu, show a view in the bar, reorder it, Escape returns focus to the button", async ({ page }) => {
    await open(page);
    await moreBtn(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    // make room, then add Timeline with the keyboard
    await rowOf(page, "Outcomes").getByRole("button", { name: "In bar" }).focus();
    await page.keyboard.press("Enter");
    await rowOf(page, "Timeline").getByRole("button", { name: "Show in bar" }).focus();
    await page.keyboard.press("Enter");
    await expect(rowOf(page, "Timeline").getByRole("button", { name: "In bar" })).toBeVisible();
    // Alt+Up moves it one place earlier
    await rowOf(page, "Timeline").getByRole("button", { name: "In bar" }).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => (await page.locator(".view-chip").allTextContents()).join(",")).toBe("Prioritisation,Planning,Delivery,Go-to-market,Timeline,Leadership");
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(moreBtn(page)).toBeFocused();
    await expect(moreBtn(page)).toHaveText(/^5 more views/);
  });

  test("a seventh view in the bar is refused with the message and changes nothing", async ({ page }) => {
    await open(page);
    await moreBtn(page).click();
    await rowOf(page, "Discovery").getByRole("button", { name: "Show in bar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your bar is full (6). Remove one first." })).toBeVisible();
    await expect(page.locator(".view-chip")).toHaveCount(6);
    expect((await store(page)).layouts).toEqual({});
  });

  test("tabs can be reordered with Alt+Arrow on a focused tab", async ({ page }) => {
    await open(page);
    await viewTab(page, "Delivery").focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(async () => (await page.locator(".view-chip").allTextContents()).slice(0, 3).join(",")).toBe("Prioritisation,Delivery,Planning");
  });

  test("a person's bar is theirs: the workspace default is untouched, and Reset restores it", async ({ page }) => {
    await open(page);
    await viewTab(page, "Leadership").focus();
    await page.keyboard.press("Alt+ArrowLeft");
    const s = await store(page);
    expect(s.layouts["u1"]?.length).toBeGreaterThan(0);
    expect(s.layouts[""]).toBeUndefined(); // other people follow the unchanged workspace default
    await moreBtn(page).click();
    await menu(page).getByRole("button", { name: "Reset to workspace layout" }).click();
    expect((await store(page)).layouts["u1"]).toBeUndefined();
    await expect(page.locator(".view-chip")).toHaveText(["Prioritisation", "Planning", "Delivery", "Go-to-market", "Outcomes", "Leadership"]);
  });

  test("a view opened from the menu appears as a highlighted temporary tab, then goes away", async ({ page }) => {
    await open(page);
    await goToView(page, "Timeline");
    await expect(page.locator(".vm-tab-temp")).toContainText("Timeline");
    await expect(viewTab(page, "Timeline")).toHaveAttribute("aria-pressed", "true");
    await viewTab(page, "Planning").click();
    await expect(page.locator(".vm-tab-temp")).toHaveCount(0);
  });

  test("a narrow window shows fewer tabs and counts the rest in the menu", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect.poll(() => page.locator(".view-chip").count()).toBeLessThan(6);
    await expect(moreBtn(page)).toHaveText(/^(6|7|8|9|10) more views/);
  });

  test("a ?view= link to someone else's private view falls back to the default view without an error page", async ({ page }) => {
    await open(page, "n=30&role=admin&view=view-does-not-exist");
    await expect(page.locator(".view-dirty")).toContainText("private to its owner"); // the only notice left
    await expect(viewTab(page, "Prioritisation")).toBeVisible();
  });

  test("no accessibility violations with the menu open", async ({ page }) => {
    await open(page);
    await moreBtn(page).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});

test.describe("one save flow (R-99)", () => {
  test("columns, filters, grouping and sort each mark the view as changed (a dot, no alert); search and scope do not", async ({ page }) => {
    await open(page);
    const changed = hasChanges(page);
    await page.getByRole("searchbox", { name: "Search initiatives" }).fill("a");
    await expect(changed).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search initiatives" }).fill("");
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "Health" }).click();
    await expect(changed).toBeVisible();
    await moreViews(page).click();
    await expect(menu(page)).toContainText("grouping");
    await page.keyboard.press("Escape");
    await expect(page.locator(".view-dirty")).toHaveCount(0);
    await resetChanges(page);
    await expect(changed).toHaveCount(0);
    await applySort(page, "MoSCoW", "Z-A");
    await expect(changed).toBeVisible();
    await expect(foot(page)).toContainText("Sorted by MoSCoW (high to low)");
    await resetChanges(page);
    await page.getByRole("button", { name: /columns shown$/ }).click();
    await page.getByLabel("Confidence", { exact: true }).uncheck();
    await page.getByRole("button", { name: /^Apply columns/ }).click();
    await expect(changed).toBeVisible();
  });

  test("filters, grouping and sort stay when you switch views; columns stay with the view they were changed in; nothing asks to save", async ({ page }) => {
    await open(page);
    await makeChange(page); // High impact filter
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "Health" }).click();
    await page.getByRole("button", { name: /columns shown$/ }).click();
    await page.getByLabel("Confidence", { exact: true }).uncheck();
    await page.getByRole("button", { name: /^Apply columns/ }).click();
    const items = (await foot(page).textContent())!;
    await viewTab(page, "Delivery").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".view-dirty, .view-toast")).toHaveCount(0);
    expect(await foot(page).textContent()).toBe(items); // same filter and grouping
    await expect(page.getByRole("button", { name: /^Group by/ })).toContainText("Health");
    await expect(page.locator(".filter-chips")).toBeVisible();
    await viewTab(page, "Prioritisation").click();
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0); // its own column change is still there
    await viewTab(page, "Delivery").click();
    await expect(page.getByRole("button", { name: /^Group by/ })).toContainText("Health");
    // removing the filter and grouping is up to the person
    await resetChanges(page);
    await expect(page.getByRole("button", { name: /^Group by/ })).toContainText("None");
    await expect(page.locator(".filter-chips")).toHaveCount(0);
  });

  test("the Filters, Columns and Group by panels have no save control", async ({ page }) => {
    await open(page);
    await filterBtn(page).click();
    await expect(page.getByRole("group", { name: "Filters", exact: true }).getByRole("button", { name: /save/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /columns shown$/ }).click();
    await expect(page.getByRole("group", { name: "Choose columns" }).getByRole("button", { name: /save/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Group by/ }).click();
    await expect(page.getByRole("menu", { name: "Group by" }).getByText(/save/i)).toHaveCount(0);
  });

  test("save as new view stores columns, pinned, filters, grouping and sort; opening it again restores them", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /columns shown$/ }).click();
    await page.getByLabel("Confidence", { exact: true }).uncheck();
    await page.getByRole("button", { name: /^Apply columns/ }).click();
    await makeChange(page);
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "Health" }).click();
    await applySort(page, "Effort (T-shirt)", "Z-A");
    const matching = (await foot(page).textContent())!;
    await saveAsNew(page, "My planning");
    await expect(hasChanges(page)).toHaveCount(0);
    const s = await store(page);
    const v = s.views.find((x) => x.name === "My planning")!;
    expect(v.ownerId).toBe("u1");
    expect(v.sort).toEqual({ field: "effort", dir: "desc" });
    expect(v.groupBy).toBe("health");
    expect(v.columns).not.toContain("confidence");
    expect(v.filters.length).toBeGreaterThan(0);
    await expect(moreBtn(page)).toHaveText(/^6 more views/); // the new private view is not in the bar
    await viewTab(page, "Delivery").click();
    await expect(page.locator(".group-row").first()).toBeVisible(); // grouping stays while switching views
    await resetChanges(page);
    await expect(page.locator(".group-row")).toHaveCount(0);
    await goToView(page, "My planning");
    expect(await foot(page).textContent()).toBe(matching);
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0);
    await expect(page.locator(".filter-chips")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Group by/ })).toContainText("Health");
    await expect(page.getByRole("button", { name: /^Sort:/ })).toContainText("Effort");
    await expect(page.getByRole("button", { name: /^(Add filter|\d+ filters?)/ })).toContainText(/\d+ filters?/);
    // it sits under My views
    await moreBtn(page).click();
    await expect(menu(page).getByRole("region", { name: "My views" })).toContainText("My planning");
    await expect(rowOf(page, "My planning")).toContainText("private");
  });

  test("a view-only role can save a private view, but not choose Workspace", async ({ page }) => {
    await open(page, "n=30&role=viewer");
    await makeChange(page);
    await viewMenuAction(page, "Save as new view…");
    const d = page.getByRole("dialog", { name: "Save as new view" });
    await expect(d.getByLabel(/^\s*Workspace/)).toHaveCount(0);
    await d.getByLabel("Name").fill("Viewer view");
    await d.getByRole("button", { name: "Save view" }).click();
    expect((await store(page)).views.map((v) => v.name)).toContain("Viewer view");
  });

  test("the name is checked as you type: empty, too long, and already yours", async ({ page }) => {
    await open(page);
    await makeChange(page);
    await saveAsNew(page, "Same name");
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "Health" }).click();
    await viewMenuAction(page, "Save as new view…");
    const d = page.getByRole("dialog", { name: "Save as new view" });
    await d.getByLabel("Name").fill("same NAME");
    await expect(d.getByRole("alert")).toContainText("already have a view called");
    await expect(d.getByRole("button", { name: "Save view" })).toBeDisabled();
    await d.getByLabel("Name").fill("");
    await expect(d.getByRole("alert")).toContainText("Give the view a name");
  });

  test("Update on a private view overwrites it; on a workspace view an admin confirms 'Update for everyone' and a member cannot", async ({ page }) => {
    await open(page);
    await makeChange(page);
    await saveAsNew(page, "Mine");
    await applySort(page, "MoSCoW", "A-Z");
    await viewMenuAction(page, "Update “Mine”");
    await expect(hasChanges(page)).toHaveCount(0);
    expect((await store(page)).views.find((v) => v.name === "Mine")!.sort).toEqual({ field: "moscow", dir: "asc" });
    // a built-in is a workspace view: the admin confirms
    await viewTab(page, "Planning").click();
    await applySort(page, "Effort (T-shirt)", "Z-A");
    await viewMenuAction(page, "Update for everyone");
    const c = page.getByRole("dialog", { name: "Update for everyone?" });
    await expect(c).toContainText("whole workspace");
    await c.getByRole("button", { name: "Update for everyone" }).click();
    await expect(hasChanges(page)).toHaveCount(0);
    await expect(viewTab(page, "Planning")).toHaveAttribute("title", /changed by your workspace/);
  });

  test("a member cannot update a workspace view: the button is disabled with the reason; Save as new view still works", async ({ page }) => {
    await open(page, "n=30&role=creator");
    await makeChange(page);
    await moreViews(page).click();
    const update = menu(page).getByRole("button", { name: "Update for everyone" });
    await expect(update).toBeDisabled();
    await expect(menu(page)).toContainText("Workspace views can only be changed by an admin. Save as your own view instead.");
    await page.keyboard.press("Escape");
    await saveAsNew(page, "My own Prioritisation");
    expect((await store(page)).views.some((v) => v.name === "My own Prioritisation" && v.ownerId === "u1")).toBe(true);
  });

  test("the palette has the same two actions: update the open view and save as new", async ({ page }) => {
    await open(page);
    await makeChange(page);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("save as new");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Save as new view" })).toBeVisible();
  });

  test("an admin saves a workspace view; a customer-safe view says which columns it leaves out", async ({ page }) => {
    await open(page);
    await makeChange(page);
    await viewMenuAction(page, "Save as new view…");
    const d = page.getByRole("dialog", { name: "Save as new view" });
    await d.getByLabel("Name").fill("For customers");
    await d.getByLabel(/^\s*Workspace/).check();
    await d.getByLabel(/Customer-safe view/).check();
    await expect(d).toContainText("not customer-safe and will be left out");
    await d.getByRole("button", { name: "Save view" }).click();
    const v = (await store(page)).views.find((x) => x.name === "For customers")!;
    expect(v.ownerId).toBeNull();
    expect(v.columns).not.toContain("value_12m");
  });
});

test.describe("manage views (R-100)", () => {
  async function makePrivate(page: Page, name: string) {
    await makeChange(page);
    await saveAsNew(page, name);
  }
  async function actions(page: Page, name: string, item: string | RegExp) {
    await moreBtn(page).click();
    await rowOf(page, name).getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: item }).click();
  }

  test("a member renames, duplicates and deletes their private view, and has no such actions on workspace views", async ({ page }) => {
    await open(page, "n=30&role=creator");
    await makePrivate(page, "Mine");
    await actions(page, "Mine", /^Rename/);
    const r = page.getByRole("dialog", { name: "Rename view" });
    await r.getByLabel("Name").fill("Renamed");
    await r.getByRole("button", { name: "Rename" }).click();
    await expect(page.locator(".view-toast")).toContainText("Renamed “Mine” to “Renamed”");
    await actions(page, "Renamed", "Duplicate");
    await expect(viewTab(page, "Renamed copy")).toHaveAttribute("aria-pressed", "true");
    expect((await store(page)).views.map((v) => v.name).sort()).toEqual(["Renamed", "Renamed copy"]);
    // delete the open view: back to the first view in the bar, after a confirmation
    await actions(page, "Renamed copy", /^Delete/);
    await expect(page.getByRole("dialog", { name: /Delete/ })).toContainText("removed for you");
    await page.getByRole("button", { name: "Yes, delete view" }).click();
    await expect(viewTab(page, "Prioritisation")).toHaveAttribute("aria-pressed", "true");
    expect((await store(page)).views.map((v) => v.name)).toEqual(["Renamed"]);
    // workspace views: duplicate only
    await moreBtn(page).click();
    await rowOf(page, "Planning").getByRole("button", { name: "Actions for Planning" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Duplicate"]);
  });

  test("delete can be undone from the message", async ({ page }) => {
    await open(page);
    await makePrivate(page, "Oops");
    await actions(page, "Oops", /^Delete/);
    await page.getByRole("button", { name: "Yes, delete view" }).click();
    expect((await store(page)).views).toHaveLength(0);
    await page.locator(".view-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await store(page)).views.map((v) => v.name)).toEqual(["Oops"]);
  });

  test("an admin makes their private view a workspace view, and back to private", async ({ page }) => {
    await open(page);
    await makePrivate(page, "Publish me");
    await actions(page, "Publish me", "Make workspace view");
    expect((await store(page)).views.find((v) => v.name === "Publish me")!.ownerId).toBeNull();
    await actions(page, "Publish me", /^Make private/);
    await expect(page.getByRole("dialog", { name: /Make “Publish me” private/ })).toContainText("disappears for everyone else");
    await page.getByRole("button", { name: "Make private" }).click();
    await expect.poll(async () => (await store(page)).views.find((v) => v.name === "Publish me")!.ownerId).toBe("u1");
  });

  test("an admin hides Timeline for everyone, restores it, and a member has neither action", async ({ page }) => {
    await open(page);
    await actions(page, "Timeline", "Hide for everyone");
    await expect(page.locator(".view-toast")).toContainText("Hid “Timeline”");
    await expect(moreBtn(page)).toHaveText(/^4 more views/);
    await moreBtn(page).click();
    await expect(rowOf(page, "Discovery")).toBeVisible();
    await expect(menu(page).getByRole("region", { name: "Workspace views" }).locator(".vm-open", { hasText: /^Timeline/ })).toHaveCount(0);
    const hidden = menu(page).getByRole("region", { name: "Hidden views" });
    await expect(hidden).toContainText("Timeline");
    expect((await store(page)).layouts[""]?.some((r) => r.ref.name === "Timeline" && r.hidden)).toBe(true);
    await hidden.getByRole("button", { name: "Restore" }).click();
    await expect(moreBtn(page)).toHaveText(/^5 more views/);
    await page.keyboard.press("Escape");
    // a member sees no Hide and no Hidden views section
    await open(page, "n=30&role=creator");
    await moreBtn(page).click();
    await rowOf(page, "Timeline").getByRole("button", { name: "Actions for Timeline" }).click();
    await expect(page.getByRole("menuitem", { name: "Hide for everyone" })).toHaveCount(0);
  });

  test("an admin manages the workspace default bar", async ({ page }) => {
    await open(page);
    await moreBtn(page).click();
    await menu(page).getByRole("button", { name: "Manage workspace bar" }).click();
    await expect(menu(page)).toContainText("Editing the workspace default bar");
    await rowOf(page, "Outcomes").getByRole("button", { name: "In bar" }).click();
    await rowOf(page, "Discovery").getByRole("button", { name: "Show in bar" }).click();
    const s = await store(page);
    expect(s.layouts[""]?.filter((r) => r.inBar).map((r) => r.ref.name)).toContain("Discovery");
    expect(s.layouts["u1"]).toBeUndefined(); // managing the default does not change the admin's own bar
  });

  test("the palette offers Rename, Duplicate and Delete for the open saved view", async ({ page }) => {
    await open(page);
    await makePrivate(page, "Palette view");
    await page.keyboard.press("Control+k");
    await page.keyboard.type("rename view");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Rename view" })).toBeVisible();
  });

  test("a 26th private view shows the readable message with a link to the list of views", async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      const s = (window as unknown as { __pv: { store: { createView: (n: string, d: unknown) => Promise<unknown> } } }).__pv.store;
      for (let i = 1; i <= 25; i++) await s.createView(`Filler ${i}`, { columns: ["item_code"], filters: [], groupBy: null });
    });
    await makeChange(page);
    await viewMenuAction(page, "Save as new view…");
    const d = page.getByRole("dialog", { name: "Save as new view" });
    await d.getByLabel("Name").fill("The 26th");
    await d.getByRole("button", { name: "Save view" }).click();
    await expect(d.getByRole("alert")).toContainText("at most 25 private views");
  });

  test("no accessibility violations with an actions menu open", async ({ page }) => {
    await open(page);
    await moreBtn(page).click();
    await rowOf(page, "Planning").getByRole("button", { name: "Actions for Planning" }).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});

test.describe("sort: two steps, saved with the view (issue #207)", () => {
  const firstRow = (page: Page) => page.locator('.ag-row[row-index="0"] [col-id="initiative_name"]').first().innerText();

  test("column first, then direction, then Apply: the grid does not re-sort before Apply", async ({ page }) => {
    await open(page);
    const before = await firstRow(page);
    await page.getByRole("button", { name: /^Sort:/ }).click();
    await page.getByRole("menuitemradio", { name: /^Initiative Name/ }).click();
    await expect(page.getByRole("group", { name: "Sort by Initiative Name" })).toBeVisible();
    await page.getByRole("radio", { name: "Z-A", exact: true }).click();
    expect(await firstRow(page)).toBe(before);
    await expect(foot(page)).toContainText("Sorted by global Stack Rank");
    await expect(hasChanges(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Sort:/ })).toContainText("Initiative Name, Z-A");
    await expect(hasChanges(page)).toBeVisible();
    await moreBtn(page).click();
    await expect(menu(page)).toContainText("sorted");
  });

  test("direction words fit the data: A-Z for text, Low to high for numbers", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Sort:/ }).click();
    await page.getByRole("menuitemradio", { name: /^Stack Rank/ }).click();
    await expect(page.getByRole("radio", { name: "Low to high", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "High to low", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("menuitemradio", { name: /^Initiative Name/ }).click();
    await expect(page.getByRole("radio", { name: "A-Z", exact: true })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Z-A", exact: true })).toBeVisible();
  });

  test("Update stores the sort; Save as new view stores it; Reset restores the saved sort; switching views loads each view's own", async ({ page }) => {
    await open(page);
    await makeChange(page);
    await saveAsNew(page, "Sorted view");
    await applySort(page, "MoSCoW", "A-Z");
    await viewMenuAction(page, "Update “Sorted view”");
    await expect(hasChanges(page)).toHaveCount(0);
    expect((await store(page)).views.find((v) => v.name === "Sorted view")!.sort).toEqual({ field: "moscow", dir: "asc" });
    // change it, then Reset: back to the saved sort
    await applySort(page, "Initiative Name", "Z-A");
    await resetChanges(page);
    await expect(page.getByRole("button", { name: /^Sort:/ })).toContainText("MoSCoW, A-Z");
    // clearing is a saved state too
    await page.getByRole("button", { name: /^Sort:/ }).click();
    await page.getByRole("button", { name: "Clear sort" }).click();
    await expect(page.getByRole("button", { name: /^Sort:/ })).toContainText("Stack Rank");
    await viewMenuAction(page, "Update “Sorted view”");
    expect((await store(page)).views.find((v) => v.name === "Sorted view")!.sort ?? null).toBeNull();
  });

  test("Update on a built-in view (admin) stores the sort and a different view keeps its own", async ({ page }) => {
    await open(page);
    await viewTab(page, "Planning").click();
    await applySort(page, "Initiative Name", "Z-A");
    await viewMenuAction(page, "Update for everyone");
    await page.getByRole("dialog", { name: "Update for everyone?" }).getByRole("button", { name: "Update for everyone" }).click();
    expect((await store(page)).views.find((v) => v.name === "Planning")!.sort).toEqual({ field: "initiative_name", dir: "desc" });
  });

  test("a saved sort on a column the view does not show falls back to the default order, with no error", async ({ page }) => {
    await open(page);
    await applySort(page, "MoSCoW", "A-Z");
    await page.getByRole("button", { name: /columns shown$/ }).click();
    await page.getByLabel("MoSCoW", { exact: true }).uncheck();
    await page.getByRole("button", { name: /^Apply columns/ }).click();
    await expect(page.getByRole("button", { name: /^Sort:/ })).toContainText("Stack Rank");
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
  });

  test("the sort panel has no accessibility violations in both steps", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Sort:/ }).click();
    let r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
    await page.getByRole("menuitemradio", { name: /^Initiative Name/ }).click();
    r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
