import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chooseOption } from "./helpers";

const open = async (page: Page, query = "n=20&role=admin") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const row = (page: Page, id: string) => page.locator(`.ag-row[row-id="${id}"]`);
const filtersPanel = (page: Page) => page.getByRole("group", { name: "Filters", exact: true });
const addFilterRow = async (page: Page) => {
  await page.getByRole("button", { name: /^(Add filter|\d+ filters?)/ }).click();
  await filtersPanel(page).getByRole("button", { name: "+ Add rule" }).click();
};

test.describe("search in long drop-downs (R-018)", () => {
  test("Group by: the search is focused, filters as you type (any case, anywhere in the name), says No results, and Enter picks", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /^Group by/ }).click();
    const search = page.getByRole("searchbox", { name: "Search group by options" });
    await expect(search).toBeFocused();
    const items = page.getByRole("menuitemradio");
    expect(await items.count()).toBeGreaterThan(8);
    await search.fill("MOSCOW");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveText("MoSCoW");
    await search.fill("road"); // anywhere in the name: Roadmap Category
    await expect(items.filter({ hasText: "Roadmap Category" })).toHaveCount(1);
    await search.fill("zzzz");
    await expect(page.getByRole("status").filter({ hasText: "No results for “zzzz”" })).toBeVisible();
    await expect(items).toHaveCount(0);
    await search.fill("moscow");
    await page.keyboard.press("Enter");
    await expect(page.locator(".group-row", { hasText: "Must" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search group by options" })).toHaveCount(0); // the list closed
  });

  test("Group by: Down arrow moves into the list, Escape closes it and gives the focus back", async ({ page }) => {
    await open(page);
    const button = page.getByRole("button", { name: /^Group by/ });
    await button.click();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("searchbox", { name: "Search group by options" })).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("Filters: the field list of 165 fields is searchable by name, key and alias, and keys pick", async ({ page }) => {
    await open(page);
    await addFilterRow(page);
    const trigger = filtersPanel(page).getByRole("button", { name: /^Field of filter 1:/ });
    await trigger.click();
    const search = page.getByRole("combobox", { name: "Search Field of filter 1" });
    await expect(search).toBeFocused();
    const options = page.locator('.select-panel [role="option"]');
    expect(await options.count()).toBeGreaterThan(100);
    await expect(page.locator(".select-panel .sl-group").first()).toBeVisible(); // the full list has group headings
    await search.fill("owner"); // an alias of Product Manager
    await expect(options.filter({ hasText: "Product Manager" })).toHaveCount(1);
    await expect(page.locator(".select-panel .sl-group")).toHaveCount(0); // a ranked result list has none
    await search.fill("g2m_date_est"); // the field key
    await expect(options).toHaveCount(1);
    await search.fill("zzzz");
    await expect(page.locator(".select-panel").getByRole("status")).toContainText("No results");
    await search.fill("mosc");
    await page.keyboard.press("Enter");
    await expect(page.locator(".select-panel")).toHaveCount(0);
    await expect(trigger).toContainText("MoSCoW");
    await expect(trigger).toBeFocused();
  });

  test("Filters: Down and Up move the highlight, Escape closes without changing anything", async ({ page }) => {
    await open(page);
    await addFilterRow(page);
    const trigger = filtersPanel(page).getByRole("button", { name: /^Field of filter 1:/ });
    const before = await trigger.innerText();
    await trigger.click();
    const search = page.getByRole("combobox", { name: "Search Field of filter 1" });
    await search.fill("effort");
    await page.keyboard.press("ArrowDown");
    const active = page.locator(".select-panel .sl-active");
    await expect(active).toHaveCount(1);
    await expect(search).toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".select-panel")).toHaveCount(0);
    await expect(filtersPanel(page)).toBeVisible(); // Escape closed only the list, not the whole Filters panel
    expect(await trigger.innerText()).toBe(before);
  });

  test("Filters: a short list stays a plain select; a long list of people becomes searchable", async ({ page }) => {
    await open(page, "n=40&role=admin&biglists=1");
    await addFilterRow(page);
    await chooseOption(page, filtersPanel(page), "Field of filter 1:", "moscow");
    await expect(filtersPanel(page).locator('select[aria-label="Value for MoSCoW"]')).toHaveCount(1); // 4 options: native
    await chooseOption(page, filtersPanel(page), "Field of filter 1:", "product_manager");
    const value = filtersPanel(page).getByRole("button", { name: /^Value for Product Manager:/ });
    await value.click();
    await page.getByRole("combobox", { name: "Search Value for Product Manager" }).fill("fay");
    await expect(page.locator('.select-panel [role="option"]')).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator(".filter-chips")).toContainText("fay@example.test");
    await expect(row(page, "item-6")).toHaveCount(1); // item 6 belongs to the sixth person, fay
    await expect(row(page, "item-1")).toHaveCount(0);
  });

  test("Columns: the picker has a search for the 165 fields; Esc still closes it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /columns shown$/ }).click();
    const search = page.getByRole("searchbox", { name: "Search columns" });
    await expect(search).toBeFocused();
    const boxes = page.getByRole("group", { name: "Choose columns" }).getByRole("checkbox");
    const all = await boxes.count();
    expect(all).toBeGreaterThan(100);
    await search.fill("weighted");
    const some = await boxes.count();
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(10);
    await expect(page.getByRole("group", { name: "Choose columns" }).getByLabel(/weighted/i).first()).toBeVisible();
    await search.fill("zzzz");
    await expect(page.getByRole("group", { name: "Choose columns" }).getByRole("status")).toContainText("No results");
    await search.fill("");
    expect(await boxes.count()).toBe(all);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Choose columns" })).toHaveCount(0);
  });

  test("Scope switcher: a search appears once the menu lists more than 8 entries; Enter picks the first match", async ({ page }) => {
    await open(page);
    await page.getByRole("banner").locator(".scope-chip").click();
    const search = page.getByRole("searchbox", { name: "Search scopes and projects" });
    await expect(search).toBeFocused();
    await search.fill("customer");
    await expect(page.getByRole("menuitemradio")).toHaveCount(1);
    await search.fill("zzzz");
    await expect(page.locator(".scope-menu").getByRole("status")).toContainText("No results");
    await search.fill("gro"); // the Growth project
    await expect(page.getByRole("menuitemradio")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("banner").locator(".scope-chip")).toContainText("Growth");
  });

  test("More views: the 11 default views are more than 8, so the menu has a search box that filters them", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /more views$/ }).click();
    const search = page.getByRole("searchbox", { name: "Search views" });
    await expect(search).toBeVisible();
    await search.fill("time");
    await expect(page.locator(".vm-open")).toHaveCount(1);
    await expect(page.locator(".vm-open")).toContainText("Timeline");
  });

  test("Bulk bar, More fields: search the field list and set a value from the keyboard", async ({ page }) => {
    await open(page);
    await row(page, "item-1").locator('input[type="checkbox"]').first().check();
    const bar = page.getByRole("region", { name: /Bulk actions/ });
    await bar.getByRole("button", { name: /^More fields/ }).click();
    await bar.getByRole("button", { name: /^Field to set:/ }).click();
    const search = page.getByRole("combobox", { name: "Search Field to set" });
    await expect(search).toBeFocused();
    await search.fill("t-shirt"); // the name is "Effort (T-shirt)"
    await expect(page.locator('.select-panel [role="option"]')).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(bar.getByRole("button", { name: /^Field to set:/ })).toContainText("Effort");
    await bar.getByLabel("New value for Effort (T-shirt)").selectOption("XL");
    await bar.getByRole("button", { name: "Apply to 1 item" }).click();
    await expect(row(page, "item-1").locator('[col-id="effort"]')).toHaveText("XL");
  });

  test("Import: the column mapping lists can be searched by alias", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Paste table" }).click();
    const dialog = page.getByRole("dialog", { name: /Import rows/ });
    await dialog.getByLabel(/Paste the cells/).fill("Idea\tImportance\nA new idea\tshould");
    await dialog.getByLabel("The first row has column names").check();
    await dialog.getByRole("button", { name: "Field for Importance:" }).click();
    const search = page.getByRole("combobox", { name: "Search Field for Importance" });
    await expect(search).toBeFocused();
    await search.fill("owner"); // alias of Product Manager
    await expect(page.locator('.select-panel [role="option"]').filter({ hasText: "Product Manager" })).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Field for Importance:" })).toContainText("Product Manager");
  });

  test("Cell pickers: typing filters and an empty result says No results", async ({ page }) => {
    await open(page);
    await row(page, "item-1").locator('[col-id="moscow"]').click();
    await page.keyboard.press("Enter");
    const input = page.getByRole("combobox", { name: /Choose an option/ });
    await input.fill("zzzz");
    await expect(page.locator(".picker-empty")).toHaveText("No results");
    await input.fill("sho");
    await expect(page.getByRole("option", { name: "Should" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("an open searchable list has no accessibility violations", async ({ page }) => {
    await open(page);
    await addFilterRow(page);
    await filtersPanel(page).getByRole("button", { name: /^Field of filter 1:/ }).click();
    await expect(page.getByRole("combobox", { name: "Search Field of filter 1" })).toBeFocused();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
