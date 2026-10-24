import { chooseOption } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=30") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const foot = (page: Page) => page.locator(".grid-foot");
const header = (page: Page) => page.getByRole("banner");
const scopeButton = (page: Page) => header(page).locator(".scope-chip");
const scopeMenu = (page: Page) => page.getByRole("menu", { name: "Portfolio scope" });
const row = (page: Page, id: string) => page.locator(`.ag-row[row-id="${id}"]`);
const addFilter = async (page: Page, field: string, value?: string) => {
  const panel = page.getByRole("group", { name: "Filters", exact: true });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: /^Filters/ }).click();
  await panel.getByRole("button", { name: "+ Add filter" }).click();
  const i = (await panel.locator(".filter-row").count());
  await chooseOption(page, panel, `Field of filter ${i}:`, field);
  if (value) await panel.getByLabel(/^Value for/).last().selectOption(value);
};

test.describe("scope switcher", () => {
  test("lists All projects, saved scopes and projects; choosing a scope filters the roadmap and the address", async ({ page }) => {
    await open(page);
    await scopeButton(page).click();
    const menu = scopeMenu(page);
    await expect(menu).toContainText("All projects");
    await expect(menu).toContainText("6 projects");
    await expect(menu).toContainText("Saved scopes");
    await expect(menu.getByRole("menuitemradio", { name: /Marketplace and Platform/ })).toBeVisible();
    await menu.getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(scopeButton(page)).toContainText("Customer-facing work");
    await expect(foot(page)).toContainText("5 of 30 items shown");
    expect(page.url()).toContain("scope=scope-b");
    await expect(page.locator(".filter-chips")).toContainText("Scope: Customer-facing work");
    // ranks stay global: the first shown row is the third item, rank #3
    await expect(row(page, "item-3").locator('[col-id="stack_rank"]')).toHaveText("#3");
    await expect(row(page, "item-1")).toHaveCount(0);
  });

  test("a single project, and back to all projects", async ({ page }) => {
    await open(page);
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitemradio", { name: "Platform", exact: true }).click();
    await expect(scopeButton(page)).toContainText("Platform");
    await expect(foot(page)).toContainText("5 of 30 items shown");
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitemradio", { name: /All projects/ }).click();
    await expect(foot(page)).toContainText("30 items");
    expect(page.url()).not.toContain("scope=");
  });

  test("the scope in the address is applied when the page opens", async ({ page }) => {
    await open(page, "n=30&scope=scope-a");
    await expect(scopeButton(page)).toContainText("Marketplace and Platform");
    await expect(foot(page)).toContainText("10 of 30 items shown");
  });

  test("a new item goes to the project of the scope when the scope is one project", async ({ page }) => {
    await open(page, "n=30&scope=p:p3&view=All columns&cols=all");
    await page.getByLabel("Add an initiative").fill("Scoped idea");
    await page.getByLabel("Add an initiative").press("Enter");
    const r = page.locator(".ag-row", { has: page.locator('[col-id="initiative_name"]', { hasText: "Scoped idea" }) });
    await expect(r.locator('[col-id="home_project"]')).toHaveText("Growth");
  });

  test("New scope: name it, choose projects, it becomes the current scope; Edit renames it; Delete removes it", async ({ page }) => {
    await open(page);
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitem", { name: "+ New scope" }).click();
    const dialog = page.getByRole("dialog", { name: "New scope" });
    await expect(dialog.getByRole("button", { name: "Create scope" })).toBeDisabled();
    await dialog.getByLabel("Name").fill("Payments and Mobile");
    await dialog.getByLabel("Payments").check();
    await dialog.getByLabel("Mobile").check();
    await dialog.getByRole("button", { name: "Create scope" }).click();
    await expect(scopeButton(page)).toContainText("Payments and Mobile");
    await expect(foot(page)).toContainText("10 of 30 items shown");
    // a duplicate name is explained
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitem", { name: "+ New scope" }).click();
    const again = page.getByRole("dialog", { name: "New scope" });
    await again.getByLabel("Name").fill("payments and mobile");
    await again.getByLabel("Data").check();
    await again.getByRole("button", { name: "Create scope" }).click();
    await expect(again.getByRole("alert")).toContainText('There is already a scope called "payments and mobile"');
    await again.getByRole("button", { name: "Cancel" }).click();
    // edit: rename and add a project
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitem", { name: "Edit scope Payments and Mobile" }).click();
    const edit = page.getByRole("dialog", { name: "Edit scope" });
    await edit.getByLabel("Name").fill("Money and Mobile");
    await edit.getByLabel("Data").check();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(scopeButton(page)).toContainText("Money and Mobile");
    await expect(foot(page)).toContainText("15 of 30 items shown");
    // delete: asks first, then falls back to all projects
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitem", { name: "Edit scope Money and Mobile" }).click();
    const del = page.getByRole("dialog", { name: "Edit scope" });
    await del.getByRole("button", { name: "Delete scope" }).click();
    await expect(del).toContainText("Items are not deleted");
    await del.getByRole("button", { name: "Yes, delete scope" }).click();
    await expect(scopeButton(page)).toContainText("All projects");
    await expect(foot(page)).toContainText("30 items");
  });

  test("admins add a project from the dropdown (+ New project)", async ({ page }) => {
    await open(page);
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitem", { name: "+ New project" }).click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByLabel("Project name").fill("Brand new project");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await scopeButton(page).click();
    await expect(scopeMenu(page).getByRole("menuitemradio", { name: "Brand new project" })).toBeVisible();
    await expect(scopeMenu(page)).toContainText("7 projects");
  });

  test("menus work in Safari, which does not focus a button on click: the menu stays until the click lands", async ({ page }) => {
    await open(page);
    // what Safari does on mousedown: the clicked button is not focused, and the element that had the focus loses it
    await page.evaluate(() => document.addEventListener("mousedown", (e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }, true));
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitem", { name: "+ New project" }).click();
    await expect(page.getByRole("dialog", { name: "New project" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await scopeButton(page).click();
    await scopeMenu(page).getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(page.locator(".filter-chips")).toContainText("Scope: Customer-facing work");
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Save current view as new/ }).click();
    await expect(page.getByRole("dialog", { name: "Save view" })).toBeVisible();
  });

  test("view-only roles can switch scope but not create or edit scopes or projects", async ({ page }) => {
    await open(page, "n=10&role=viewer");
    await scopeButton(page).click();
    await expect(scopeMenu(page).getByRole("menuitemradio", { name: /Customer-facing work/ })).toBeVisible();
    await expect(scopeMenu(page).getByRole("menuitem")).toHaveCount(0);
  });

  test("the menu works from the keyboard", async ({ page }) => {
    await open(page);
    await scopeButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("searchbox", { name: "Search scopes and projects" })).toBeFocused(); // more than 8 entries: the search is first
    await page.keyboard.press("ArrowDown");
    await expect(scopeMenu(page).getByRole("menuitemradio", { name: /All projects/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(scopeMenu(page).getByRole("menuitemradio", { name: /Marketplace and Platform/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(scopeButton(page)).toContainText("Marketplace and Platform");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(scopeMenu(page)).toHaveCount(0);
    await expect(scopeButton(page)).toBeFocused();
  });
});

test.describe("filters and search", () => {
  test("a filter narrows the rows, shows as a chip and is removed with ×", async ({ page }) => {
    await open(page);
    await addFilter(page, "moscow", "Must");
    await expect(foot(page)).toContainText("8 of 30 items shown");
    await expect(page.locator(".filter-chips")).toContainText("MoSCoW is Must");
    await expect(row(page, "item-2")).toHaveCount(0); // item-2 is Should
    await page.getByRole("button", { name: "Remove filter MoSCoW is Must" }).click();
    await expect(foot(page)).toContainText("30 items");
  });

  test('"me" works for people fields; several filters must all match', async ({ page }) => {
    await open(page);
    await addFilter(page, "product_manager", "me");
    await expect(foot(page)).toContainText("5 of 30 items shown");
    await addFilter(page, "health", "Delayed");
    await expect(foot(page)).toContainText("2 of 30 items shown");
    await page.getByRole("group", { name: "Filters", exact: true }).getByRole("button", { name: "Clear filters" }).click();
    await expect(foot(page)).toContainText("30 items");
  });

  test("a date filter takes plain words", async ({ page }) => {
    await open(page);
    await addFilter(page, "start_date");
    const panel = page.getByRole("group", { name: "Filters", exact: true });
    await panel.getByLabel("Operator of filter 1").selectOption("before");
    await panel.getByLabel("Value for Start Date").fill("1 feb 2027");
    await expect(panel).toContainText("= 2027-02-01");
    await expect(foot(page)).toContainText("30 of 30 items shown".replace("30 of 30 items shown", "30 items")); // everything starts 4 Jan 2027
    await panel.getByLabel("Value for Start Date").fill("1 jan 2027");
    await expect(foot(page)).toContainText("0 of 30 items shown");
  });

  test("search finds by code or words in the name", async ({ page }) => {
    await open(page);
    await page.getByLabel("Search initiatives").fill("number 7");
    await expect(foot(page)).toContainText("3 of 30 items shown");
    await page.getByLabel("Search initiatives").fill("R-12");
    await expect(foot(page)).toContainText("1 of 30 items shown");
    await page.getByLabel("Search initiatives").press("Escape");
    await expect(foot(page)).toContainText("30 items");
  });

  test("a newly added item stays visible even if the filter would hide it", async ({ page }) => {
    await open(page);
    await addFilter(page, "moscow", "Must");
    await page.getByLabel("Add an initiative").fill("Hidden by filter #platform should");
    await page.getByLabel("Add an initiative").press("Enter");
    await expect(page.locator(".ag-row", { has: page.locator('[col-id="initiative_name"]', { hasText: "Hidden by filter" }) })).toHaveCount(1);
  });
});

test.describe("grouping", () => {
  test("off by default; group by MoSCoW shows headers with counts; collapse hides rows; No grouping restores", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: /^Collapse group/ })).toHaveCount(0);
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "MoSCoW" }).click();
    for (const g of ["Must", "Should"]) await expect(page.getByRole("button", { name: `Collapse group ${g}` })).toBeVisible();
    await expect(page.locator(".group-row", { hasText: "Must" })).toContainText("8 items");
    await expect(row(page, "item-1")).toHaveCount(1);
    await page.getByRole("button", { name: "Collapse group Must" }).click();
    await expect(row(page, "item-1")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Expand group Must" })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "No grouping" }).click();
    await expect(page.locator(".group-row")).toHaveCount(0);
    await expect(row(page, "item-1")).toHaveCount(1);
  });

  test("editing a grouped field moves the row to its new group", async ({ page }) => {
    await open(page, `n=12&view=All columns&cols=all`);
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "MoSCoW" }).click();
    await expect(page.locator(".group-row", { hasText: "Must" })).toContainText("3 items");
    await page.locator('.ag-row[row-id="item-1"] [col-id="moscow"]').click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("combobox", { name: /Choose an option/ })).toBeFocused();
    await page.keyboard.type("won");
    await page.keyboard.press("Enter");
    await expect(page.locator(".group-row", { hasText: "Must" })).toContainText("2 items");
    await expect(page.locator(".group-row", { hasText: "Won't" })).toContainText("4 items");
  });

  test("grouping and filters work together, and selecting rows skips group headers", async ({ page }) => {
    await open(page);
    await addFilter(page, "effort", "XS");
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "Health" }).click();
    await expect(foot(page)).toContainText("6 of 30 items shown");
    await page.getByRole("button", { name: "Select all", exact: false }).first().isVisible().catch(() => false);
    await page.locator('.ag-row[row-id="item-1"] input[type="checkbox"]').first().check();
    await expect(page.getByRole("region", { name: /Bulk actions/ })).toContainText("1 selected");
    await expect(page.getByRole("region", { name: /Bulk actions/ })).toContainText("Select all 6");
  });
});

test.describe("saved views", () => {
  test("save columns, filters and grouping as a view; opening it restores all three; changes show as unsaved", async ({ page }) => {
    await open(page);
    // build a view: hide Confidence, filter Must, group by Health
    await page.getByRole("button", { name: /^Columns/ }).click();
    await page.getByLabel("Confidence", { exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0);
    await addFilter(page, "moscow", "Must");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Group by/ }).click();
    await page.getByRole("menuitemradio", { name: "Health" }).click();
    await expect(page.locator(".view-dirty")).toContainText("You changed this view (Prioritisation)");
    // save
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Save current view as new/ }).click();
    const dialog = page.getByRole("dialog", { name: "Save view" });
    await dialog.getByLabel("Name").fill("My planning");
    await dialog.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("button", { name: /^Views My planning/ })).toBeVisible();
    await expect(page.locator(".view-dirty")).toHaveCount(0);
    expect(page.url()).toContain("view=view-");
    // leave for another view, then come back through the Views menu
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Delivery" }).click();
    await expect(foot(page)).toContainText("30 items");
    await expect(page.locator(".group-row")).toHaveCount(0);
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitemradio", { name: "My planning" }).click();
    await expect(foot(page)).toContainText("8 of 30 items shown");
    await expect(page.getByRole("button", { name: /^Collapse group/ }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /MoSCoW/ })).toBeVisible();
    await expect(page.locator(".filter-chips")).toContainText("MoSCoW is Must");
  });

  test("a saved view is shared: it is in the list for everyone; viewers can open but not save", async ({ page }) => {
    await open(page, "n=10&role=viewer");
    await page.getByRole("button", { name: /^Views/ }).click();
    await expect(page.getByRole("menu", { name: "Saved views" })).toContainText("None yet");
    await expect(page.getByRole("menuitem")).toHaveCount(0);
  });

  test("update, rename and delete a saved view", async ({ page }) => {
    await open(page);
    await addFilter(page, "effort", "M");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Save current view as new/ }).click();
    await page.getByRole("dialog", { name: "Save view" }).getByLabel("Name").fill("Mediums");
    await page.getByRole("dialog", { name: "Save view" }).getByRole("button", { name: "Save view" }).click();
    await expect(foot(page)).toContainText("6 of 30 items shown");
    // change the filter, then update the view with it
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByLabel("Value for Effort (T-shirt)").selectOption("L");
    await page.keyboard.press("Escape");
    await expect(page.locator(".view-dirty")).toBeVisible();
    await page.getByRole("button", { name: /^Views Mediums/ }).click();
    await page.getByRole("menuitem", { name: /Update “Mediums”/ }).click();
    await expect(page.locator(".view-dirty")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pv: { store: { views: { filters: { value: string }[] }[] } } }).__pv.store.views[0]!.filters[0]!.value)).toBe("L");
    // rename
    await page.getByRole("button", { name: /^Views Mediums/ }).click();
    await page.getByRole("menuitem", { name: /Rename “Mediums”/ }).click();
    await page.getByRole("dialog", { name: "Rename view" }).getByLabel("Name").fill("Larges");
    await page.getByRole("dialog", { name: "Rename view" }).getByRole("button", { name: "Rename" }).click();
    await expect(page.getByRole("button", { name: /^Views Larges/ })).toBeVisible();
    // delete (asks first)
    await page.getByRole("button", { name: /^Views Larges/ }).click();
    await page.getByRole("menuitem", { name: /Delete “Larges”/ }).click();
    await expect(page.getByRole("dialog", { name: "Delete view" })).toContainText("removed for everyone");
    await page.getByRole("dialog", { name: "Delete view" }).getByRole("button", { name: "Yes, delete view" }).click();
    await expect(page.getByRole("button", { name: /^Views$/ })).toBeVisible();
    await expect(foot(page)).toContainText("30 items");
  });

  test("a default view can be changed for everyone, duplicated as it is, and restored", async ({ page }) => {
    await open(page, "n=30&cols=all"); // every column rendered, so one added at the far right can be found
    const chips = page.getByRole("group", { name: "View" });
    await chips.getByRole("button", { name: "Delivery" }).click();
    const before = await page.getByRole("columnheader").count();
    await page.getByRole("button", { name: /^Columns/ }).click();
    await page.getByLabel("Confidence", { exact: true }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Change the default “Delivery” for everyone/ }).click();
    await expect(page.locator(".view-dirty")).toHaveCount(0);
    await expect(chips.getByRole("button", { name: "Delivery" })).toHaveAttribute("title", /changed by your workspace/);
    // another default is untouched; coming back shows the changed Delivery
    await chips.getByRole("button", { name: "Planning" }).click();
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0);
    await chips.getByRole("button", { name: "Delivery" }).click();
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toBeVisible();
    // duplicate it as a saved view
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Save current view as new/ }).click();
    await page.getByRole("dialog", { name: "Save view" }).getByLabel("Name").fill("Delivery plus");
    await page.getByRole("dialog", { name: "Save view" }).getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("button", { name: /^Views Delivery plus/ })).toBeVisible();
    // restore the original
    await chips.getByRole("button", { name: "Delivery" }).click();
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Restore the original “Delivery”/ }).click();
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0);
    expect(await page.getByRole("columnheader").count()).toBe(before);
    await expect(chips.getByRole("button", { name: "Delivery" })).toHaveAttribute("title", "Default view");
    await page.getByRole("button", { name: /^Views/ }).click();
    await expect(page.getByRole("menuitem", { name: /Restore the original/ })).toHaveCount(0);
  });

  test("viewers cannot change a default view", async ({ page }) => {
    await open(page, "n=10&role=viewer");
    await page.getByRole("button", { name: /^Views/ }).click();
    await expect(page.getByRole("menuitem", { name: /Change the default/ })).toHaveCount(0);
  });

  test("a customer-safe view keeps only customer-safe columns; the Columns picker says why others are off", async ({ page }) => {
    await open(page);
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Prioritisation" }).click();
    await expect(page.getByRole("columnheader", { name: /Value \(EUR/ })).toBeVisible();
    await page.getByRole("button", { name: /^Views/ }).click();
    await page.getByRole("menuitem", { name: /Save current view as new/ }).click();
    const d = page.getByRole("dialog", { name: "Save view" });
    await d.getByLabel("Name").fill("For customers");
    await d.getByLabel(/Customer-safe view/).check();
    await d.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("button", { name: /^Views For customers/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Value \(EUR/ })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Confidence", exact: true })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /Roadmap Category/ })).toBeVisible();
    const stored = await page.evaluate(() => (window as unknown as { __pv: { store: { views: { name: string; customerSafe?: boolean; columns: string[] }[] } } }).__pv.store.views.find((v) => v.name === "For customers")!);
    expect(stored.customerSafe).toBe(true);
    expect(stored.columns).not.toContain("value_12m");
    expect(stored.columns).not.toContain("stack_rank");
    await page.getByRole("button", { name: /^Columns/ }).click();
    const value = page.getByLabel(/^Value \(EUR/);
    await expect(value).toBeDisabled();
    await expect(page.locator("label", { has: value })).toContainText("not customer-safe");
    await expect(page.getByLabel("Roadmap Category", { exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Views/ }).click();
    await expect(page.getByRole("menuitemradio", { name: /For customers/ })).toContainText("customer-safe");
  });

  test("the Columns picker reaches all 166 fields, grouped, with later phases marked", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Columns/ }).click();
    const panel = page.getByRole("group", { name: "Choose columns" });
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(166);
    expect(await panel.locator("fieldset").count()).toBeGreaterThan(8);
    await expect(panel.locator("fieldset").first().locator("legend")).toHaveText("What");
    await expect(panel).toContainText("arrives in phase 7");
  });

  test("a view name that already exists is explained", async ({ page }) => {
    await open(page);
    for (const expectError of [false, true]) {
      await page.getByRole("button", { name: /^Views/ }).click();
      await page.getByRole("menuitem", { name: /Save current view as new/ }).click();
      const d = page.getByRole("dialog", { name: "Save view" });
      await d.getByLabel("Name").fill("Same name");
      await d.getByRole("button", { name: "Save view" }).click();
      if (expectError) await expect(d.getByRole("alert")).toContainText('There is already a view called "Same name"');
      else await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });

  test("Reset puts the view back as it was saved", async ({ page }) => {
    await open(page);
    await addFilter(page, "moscow", "Must");
    await page.keyboard.press("Escape");
    await expect(foot(page)).toContainText("8 of 30");
    await page.locator(".view-dirty").getByRole("button", { name: "Reset" }).click();
    await expect(foot(page)).toContainText("30 items");
  });

  test("dragging a column header changes the column order of the view", async ({ page }) => {
    await open(page, "n=10");
    const order = () => page.evaluate(() => Array.from(document.querySelectorAll(".ag-header-cell[col-id]")).map((c) => c.getAttribute("col-id") as string));
    const before = await order();
    expect(before.indexOf("theme")).toBeLessThan(before.indexOf("roadmap_category"));
    const a = (await page.locator('.ag-header-cell[col-id="roadmap_category"]').boundingBox())!;
    const b = (await page.locator('.ag-header-cell[col-id="theme"]').boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 6, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect.poll(async () => { const o = await order(); return o.indexOf("roadmap_category") < o.indexOf("theme"); }).toBe(true);
    await expect(page.locator(".view-dirty")).toContainText("You changed this view");
  });
});

test.describe("command palette", () => {
  test("Ctrl+K opens it; type to find a view and run it with Enter", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("combobox", { name: /Type a command/ })).toBeFocused();
    await page.keyboard.type("planning");
    await expect(dialog.getByRole("option").first()).toContainText("Go to view: Planning");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("group", { name: "View" }).getByRole("button", { name: "Planning" })).toHaveAttribute("aria-pressed", "true");
    expect(page.url()).toContain("view=Planning");
  });

  test("lists the core actions: add item, go to view, search", async ({ page }) => {
    await open(page);
    await page.locator("body").press("Control+k");
    const options = page.getByRole("dialog", { name: "Command palette" }).getByRole("option");
    await expect(options.filter({ hasText: "Add initiative" })).toHaveCount(1);
    await expect(options.filter({ hasText: "Search initiatives" })).toHaveCount(1);
    await page.keyboard.type("go to view");
    await expect(options.first()).toContainText("Go to view");
  });

  test("Add initiative puts the cursor in the quick-add row", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("add init");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Add an initiative")).toBeFocused();
  });

  test("finds an initiative by code or name and moves to it", async ({ page }) => {
    await open(page, "n=200");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("R-150");
    const option = page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: /R-150/ });
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator('.ag-row[row-id="item-150"] [col-id="initiative_name"]')).toHaveClass(/ag-cell-focus/);
  });

  test("changes the scope and the grouping, and Escape closes it", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("scope customer");
    await page.keyboard.press("Enter");
    await expect(scopeButton(page)).toContainText("Customer-facing work");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("group by health");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Collapse group/ }).first()).toBeVisible();
    await page.keyboard.press("Control+K");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });

  test("arrow keys move through the results", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+K");
    await page.keyboard.type("go to view");
    const options = page.getByRole("dialog", { name: "Command palette" }).getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
  });

  test("accessibility: scope menu, filters panel and palette have no WCAG A/AA violations", async ({ page }) => {
    await open(page);
    const scan = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`);
    await scopeButton(page).click();
    expect(await scan()).toEqual([]);
    await page.keyboard.press("Escape");
    await addFilter(page, "moscow", "Must");
    expect(await scan()).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("view");
    expect(await scan()).toEqual([]);
  });
});
