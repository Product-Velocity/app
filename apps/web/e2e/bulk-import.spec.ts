import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { chooseOption } from "./helpers";

const fieldNames = Object.fromEntries((JSON.parse(readFileSync(new URL("../../../packages/domain/src/field-dictionary.json", import.meta.url), "utf8")) as { key: string; name: string }[]).map((f) => [f.key, f.name])) as Record<string, string> as Record<string, string>;

const ALL = "view=All columns&cols=all";
const open = async (page: Page, query = `n=30&${ALL}`) => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const cell = (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);
const select = async (page: Page, ...ids: string[]) => {
  for (const id of ids) await page.locator(`.ag-row[row-id="${id}"] input[type="checkbox"]`).first().check();
};
const bar = (page: Page) => page.getByRole("region", { name: /Bulk actions/ });
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);

test.describe("bulk bar", () => {
  test("select 3 rows, set a field once, undo it as one step", async ({ page }) => {
    await open(page);
    await select(page, "item-1", "item-2", "item-3");
    await expect(bar(page)).toContainText("3 selected");
    await bar(page).getByRole("button", { name: /^Set MoSCoW/ }).click();
    await expect(page.getByRole("menu", { name: "Set MoSCoW" })).toContainText("Set MoSCoW on 3 items to");
    await expect(page.getByRole("menu", { name: "Set MoSCoW" })).toContainText("Currently: Must, Should, Could");
    await page.getByRole("menuitem", { name: "Won't" }).click();
    for (const id of ["item-1", "item-2", "item-3"]) await expect(cell(page, id, "moscow")).toHaveText("Won't");
    await expect(page.locator(".strip")).toContainText("Set MoSCoW to Won't on 3 items");
    await expect(bar(page)).toContainText("Done: Set MoSCoW to Won't on 3 items");
    await settle(page);
    expect((await page.evaluate(() => (window as unknown as { __pv: { controller: { status: { undoCount: number } } } }).__pv.controller.status.undoCount))).toBe(1);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(cell(page, "item-1", "moscow")).toHaveText("Must");
    await expect(cell(page, "item-2", "moscow")).toHaveText("Should");
    await expect(cell(page, "item-3", "moscow")).toHaveText("Could");
    await expect(page.locator(".strip")).toContainText("Undid: Set MoSCoW on 3 items");
  });

  test("GitHub-driven and other read-only fields are rejected with a clear message", async ({ page }) => {
    await open(page);
    await select(page, "item-1", "item-2");
    await bar(page).getByRole("button", { name: /^More fields/ }).click();
    await chooseOption(page, bar(page), "Field to set", "status");
    await expect(bar(page)).toContainText("Initiative Status comes from GitHub and cannot be edited here");
    await expect(bar(page).getByRole("button", { name: /^Apply/ })).toBeDisabled();
    await chooseOption(page, bar(page), "Field to set", "item_code");
    await expect(bar(page)).toContainText("set by the system");
    await chooseOption(page, bar(page), "Field to set", "stack_rank");
    await expect(bar(page)).toContainText("one item at a time");
    await expect(cell(page, "item-1", "status")).toHaveText("Backlog");
  });

  test("the controller refuses a GitHub field even if the bar were bypassed", async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => (window as unknown as { __pv: { controller: { bulkEdit: (ids: string[], f: string, v: string) => unknown } } }).__pv.controller.bulkEdit(["item-1"], "status", "Completed"));
    expect(r).toMatchObject({ ok: false });
    await expect(cell(page, "item-1", "status")).toHaveText("Backlog");
  });

  test("has an Update GitHub button (arrives in phase 3) and Export selection to file", async ({ page }) => {
    await open(page);
    await select(page, "item-1", "item-2");
    await expect(bar(page).getByRole("button", { name: /^Update GitHub/ })).toBeDisabled();
    await expect(bar(page).getByRole("button", { name: /^Update GitHub/ })).toContainText("arrives in phase 3");
    const download = page.waitForEvent("download");
    await bar(page).getByRole("button", { name: "Export selection to file" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^roadmap-selection-\d{4}-\d\d-\d\d\.csv$/);
    const csv = readFileSync(await file.path(), "utf8");
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 selected rows
    expect(lines[0]).toContain("Initiative Name");
    expect(lines[1]).toContain("Initiative number 1 with a reasonably long title");
    expect(lines[2]).toContain("Initiative number 2 with a reasonably long title");
  });

  test("a field outside the quick buttons can be set through More fields", async ({ page }) => {
    await open(page);
    await select(page, "item-1", "item-2");
    await bar(page).getByRole("button", { name: /^More fields/ }).click();
    await chooseOption(page, bar(page), "Field to set", "effort");
    await bar(page).getByLabel("New value for Effort (T-shirt)").selectOption("XL");
    await bar(page).getByRole("button", { name: "Apply to 2 items" }).click();
    await expect(cell(page, "item-1", "effort")).toHaveText("XL");
    await expect(cell(page, "item-2", "effort")).toHaveText("XL");
  });

  test("the menu works from the keyboard and Escape closes it", async ({ page }) => {
    await open(page);
    await select(page, "item-4", "item-5");
    await bar(page).getByRole("button", { name: /^Set Health/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "(empty)" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "On Track" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(bar(page).getByRole("button", { name: /^Set Health/ })).toBeFocused();
  });

  test("Select all N and Esc clears the selection", async ({ page }) => {
    await open(page);
    await select(page, "item-1");
    await bar(page).getByRole("button", { name: "Select all 30" }).click();
    await expect(bar(page)).toContainText("30 selected");
    await expect(bar(page)).toContainText("Esc clears");
    await cell(page, "item-2", "item_code").click();
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
  });

  test("clearing the selection hides the bar", async ({ page }) => {
    await open(page);
    await select(page, "item-1");
    await bar(page).getByRole("button", { name: "Clear selection" }).click();
    await expect(bar(page)).toHaveCount(0);
  });

  test("view-only roles can select and export but not edit", async ({ page }) => {
    await open(page, `n=10&role=viewer&${ALL}`);
    await select(page, "item-1");
    await expect(bar(page).getByRole("button", { name: "Export selection to file" })).toBeVisible();
    await expect(bar(page).getByRole("button", { name: /^Set / })).toHaveCount(0);
    await expect(bar(page).getByRole("button", { name: /^More fields/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import from spreadsheet" })).toHaveCount(0);
  });
});

const sheet = (rows: number, bad: number[] = []) => {
  const head = "Initiative Name\tProject\tOwner\tSize\tMoSCoW\tValue\tStart";
  const lines = Array.from({ length: rows }, (_, i) => {
    const size = bad.includes(i) ? "XXL" : ["XS", "S", "M", "L", "XL"][i % 5];
    return `Excel item ${i + 1}\t${["Platform", "Marketplace"][i % 2]}\tana\t${size}\t${["must", "should", "could"][i % 3]}\t€${(i + 1) * 1000}\t31/3/2027`;
  });
  return [head, ...lines].join("\n");
};

test.describe("paste-import from a spreadsheet", () => {
  test("paste 50 rows: columns are mapped, a preview is shown, then import in one undoable step", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Import from spreadsheet" }).click();
    const dialog = page.getByRole("dialog", { name: /Import rows/ });
    await dialog.getByLabel(/Paste the cells/).fill(sheet(50));
    await expect(dialog.getByRole("button", { name: "Field for Initiative Name:" })).toContainText(fieldNames.initiative_name!);
    await expect(dialog.getByRole("button", { name: "Field for Project:" })).toContainText(fieldNames.home_project!);
    await expect(dialog.getByRole("button", { name: "Field for Owner:" })).toContainText(fieldNames.product_manager!);
    await expect(dialog.getByRole("button", { name: "Field for Size:" })).toContainText(fieldNames.effort!);
    await expect(dialog.getByRole("button", { name: "Field for MoSCoW:" })).toContainText(fieldNames.moscow!);
    await expect(dialog.getByRole("button", { name: "Field for Value:" })).toContainText(fieldNames.value_12m!);
    await expect(dialog.getByRole("button", { name: "Field for Start:" })).toContainText(fieldNames.start_date!);
    await expect(dialog.getByRole("status")).toContainText("50 rows read: 50 ready");
    await expect(dialog.locator(".import-preview tbody tr")).toHaveCount(10);
    await expect(dialog.locator(".import-preview tbody tr").first()).toContainText("Excel item 1");
    await expect(dialog.locator(".import-preview tbody tr").first()).toContainText("ana@example.test");
    await dialog.getByRole("button", { name: "Import 50 rows" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".grid-foot")).toContainText("80 items");
    await expect(page.locator(".strip")).toContainText("Imported 50 items");
    await settle(page);
    const calls = await page.evaluate(() => (window as unknown as { __pv: { source: { createCalls: unknown[] } } }).__pv.source.createCalls);
    expect(calls).toEqual([{ count: 50, via: "import" }]); // one request, labelled as an import
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(page.locator(".grid-foot")).toContainText("30 items");
  });

  test("rows with problems are shown with the reason and are skipped", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Import from spreadsheet" }).click();
    const dialog = page.getByRole("dialog", { name: /Import rows/ });
    await dialog.getByLabel(/Paste the cells/).fill(sheet(10, [2]));
    await expect(dialog.getByRole("status")).toContainText("10 rows read: 9 ready, 1 with problems");
    await expect(dialog.locator(".import-preview")).toContainText("Effort (T-shirt): Choose one of the listed options.");
    await dialog.getByRole("button", { name: "Import 9 rows" }).click();
    await expect(page.locator(".grid-foot")).toContainText("39 items");
  });

  test("the mapping can be changed before importing", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Import from spreadsheet" }).click();
    const dialog = page.getByRole("dialog", { name: /Import rows/ });
    await dialog.getByLabel(/Paste the cells/).fill("Idea\tImportance\nA new idea\tshould\nAnother\tmust");
    // none of these headers is a known field name, so the first row is not assumed to be a header
    await expect(dialog.getByLabel("The first row has column names")).not.toBeChecked();
    await dialog.getByLabel("The first row has column names").check();
    await expect(dialog.getByRole("button", { name: "Field for Idea:" })).toContainText("Do not import");
    await chooseOption(page, dialog, "Field for Idea:", "initiative_name");
    await chooseOption(page, dialog, "Field for Importance:", "moscow");
    await dialog.getByLabel(/Project for rows that have none/).selectOption({ label: "Growth" });
    await expect(dialog.getByRole("status")).toContainText("2 rows read: 2 ready");
    await dialog.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(page.locator(".grid-foot")).toContainText("32 items");
    const row = page.locator(".ag-row", { has: page.locator('[col-id="initiative_name"]', { hasText: "A new idea" }) });
    await expect(row.locator('[col-id="home_project"]')).toHaveText("Growth");
    await expect(row.locator('[col-id="moscow"]')).toHaveText("Should");
  });

  test("pasting copied cells onto the grid opens the import", async ({ page }) => {
    await open(page);
    await cell(page, "item-1", "initiative_name").click();
    await page.evaluate((text) => {
      const el = document.querySelector('.ag-row[row-id="item-1"] [col-id="initiative_name"]')!;
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, sheet(3));
    const dialog = page.getByRole("dialog", { name: /Import rows/ });
    await expect(dialog.getByRole("status")).toContainText("3 rows read: 3 ready");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("accessibility: the bulk bar and the import dialog have no WCAG A/AA violations", async ({ page }) => {
    await open(page, "n=30");
    await select(page, "item-1", "item-2");
    let results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
    await page.getByRole("button", { name: "Import from spreadsheet" }).click();
    await page.getByLabel(/Paste the cells/).fill(sheet(5, [1]));
    await expect(page.getByRole("status").filter({ hasText: "rows read" })).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
  });
});

test.describe("header and page head follow the prototype", () => {
  test("logo, workspace, scope, tabs (Grid, Gantt and Cards built, unbuilt ones muted), account menu", async ({ page }) => {
    await open(page);
    const header = page.getByRole("banner");
    await expect(header.locator("img.brand-logo")).toBeVisible();
    await expect(header).toContainText("Product Velocity");
    await expect(header).toContainText("Meridian Media");
    await expect(header.getByText("All projects")).toBeVisible();
    await expect(header.getByRole("link", { name: "Grid" })).toHaveAttribute("aria-current", "page");
    await expect(header.getByRole("link", { name: "Gantt" })).toHaveAttribute("href", "/gantt");
    await expect(header.getByRole("link", { name: "Cards" })).toHaveAttribute("href", "/cards");
    await expect(header.getByRole("link", { name: "Leadership" })).toHaveAttribute("href", "/leadership");
    for (const t of ["Planning", "Capacity", "Alignment", "Reports"]) {
      await expect(header.locator(".tab-later", { hasText: t })).toHaveAttribute("aria-disabled", "true");
    }
    await expect(header.locator(".tab-later", { hasText: "Planning" })).toContainText("arrives in phase 5");
    await header.locator("summary").click();
    await expect(header.getByRole("link", { name: "Members" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Security" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(header.locator(".avatar")).toHaveText("AM");
    await expect(header.locator("summary")).toContainText("account menu for ashu.mathura@example.test");
  });

  test("the eight default views are chips; choosing one changes the columns", async ({ page }) => {
    await open(page, "n=20");
    const chips = page.getByRole("group", { name: "View" });
    await expect(chips.getByRole("button")).toHaveCount(9);
    await expect(chips.getByRole("button", { name: "Prioritisation" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("columnheader", { name: /Realized KR/ })).toHaveCount(0);
    await chips.getByRole("button", { name: "Outcomes" }).click();
    await expect(chips.getByRole("button", { name: "Outcomes" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("columnheader", { name: /Realized KR/ }).first()).toBeVisible();
  });

  test("Export in the page head downloads every row with the shown columns", async ({ page }) => {
    await open(page, "n=12");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^roadmap-\d{4}-\d\d-\d\d\.csv$/);
    const lines = readFileSync(await file.path(), "utf8").replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines).toHaveLength(13);
  });

  test("the checkbox column comes first, then global rank, rank in project, ID, initiative", async ({ page }) => {
    await open(page, "n=10");
    const heads = await page.getByRole("columnheader").allInnerTexts();
    const names = heads.map((h) => h.split("\n")[0]!.trim()).filter(Boolean);
    expect(names.slice(0, 4)).toEqual(["Stack Rank", "Rank in Project", "Initiative ID", "Initiative Name"]);
    const box = await page.locator(`.ag-row[row-id="item-1"] input[type="checkbox"]`).first().boundingBox();
    const rank = await page.locator(`.ag-row[row-id="item-1"] [col-id="stack_rank"]`).boundingBox();
    expect(box!.x).toBeLessThan(rank!.x);
  });
});

test.describe("grid height follows the page", () => {
  test("a taller window gives a taller grid, and resizing grows and shrinks it", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 600 });
    await open(page, "n=200");
    const height = async () => (await page.locator(".grid-wrap").boundingBox())!.height;
    const small = await height();
    await page.setViewportSize({ width: 1400, height: 1000 });
    await expect.poll(height).toBeGreaterThan(small + 250);
    const big = await height();
    await page.setViewportSize({ width: 1400, height: 700 });
    await expect.poll(height).toBeLessThan(big - 200);
    // the grid fills the window without making the page itself scroll (below ~360px the grid keeps a minimum height)
    await page.setViewportSize({ width: 1400, height: 800 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
