import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const csv = readFileSync(new URL("../../../docs/reference/default-views.csv", import.meta.url), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const fields = JSON.parse(readFileSync(new URL("../../../packages/domain/src/field-dictionary.json", import.meta.url), "utf8")) as { key: string; name: string; phase: number }[];
const nameOf = Object.fromEntries(fields.map((f) => [f.key, f.name]));
const shipped = (k: string) => (fields.find((f) => f.key === k)!.phase <= 1) || k === "project_rank";
const views = [...new Set(csv.map((r) => r[0]!))];
const live = (v: string) => csv.filter((r) => r[0] === v).map((r) => r[2]!).filter(shipped);

const open = async (page: Page, query = "n=20") => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const headers = async (page: Page) =>
  (await page.getByRole("columnheader").allInnerTexts()).map((h) => h.split("\n")[0]!.trim()).filter(Boolean);

test.describe("ordered default views (R-021, default-views.csv)", () => {
  test("each of the ten views shows the file's shipped columns in the file's order", async ({ page }) => {
    await open(page);
    const chips = page.getByRole("group", { name: "View" });
    for (const v of views) {
      await chips.getByRole("button", { name: v, exact: true }).click();
      await expect(chips.getByRole("button", { name: v, exact: true })).toHaveAttribute("aria-pressed", "true");
      // horizontally virtualised: scroll through the view and note each column's place (aria-colindex) in the row
      await page.locator(".ag-body-horizontal-scroll-viewport").first().evaluate((el) => { el.scrollLeft = 0; });
      await expect(page.locator(`.ag-header-cell[col-id="${live(v)[3]}"]`)).toBeAttached(); // the grid has switched to this view
      const at = new Map<string, number>();
      for (let x = 0; x <= 6000; x += 400) {
        await page.locator(".ag-body-horizontal-scroll-viewport").first().evaluate((el, left) => { el.scrollLeft = left; }, x);
        const found = await page.evaluate(() => [...document.querySelectorAll(".ag-header-cell[col-id]")].map((h) => [h.getAttribute("col-id")!, Number(h.getAttribute("aria-colindex"))] as const));
        for (const [id, pos] of found) at.set(id, pos);
      }
      const order = [...at.entries()].filter(([id]) => id in nameOf).sort((a, b) => a[1] - b[1]).map(([id]) => id);
      expect(order, v).toEqual(live(v));
    }
  });

  test("pinned columns stay visible while the view scrolls sideways", async ({ page }) => {
    await open(page);
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Discovery", exact: true }).click();
    await page.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    for (const n of ["Stack Rank", "Initiative ID", "Initiative Name"]) await expect(page.getByRole("columnheader", { name: n })).toBeVisible();
    expect(await page.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test("a view with columns from later phases says so in words; a complete view says nothing", async ({ page }) => {
    await open(page);
    const chips = page.getByRole("group", { name: "View" });
    await chips.getByRole("button", { name: "Delivery", exact: true }).click();
    await expect(page.getByRole("note")).toContainText(/more columns of this view arrive in later phases/);
    await expect(page.getByRole("note")).toContainText(/\(phase 3\)/);
    await chips.getByRole("button", { name: "All columns" }).click();
    await expect(page.getByRole("note")).toHaveCount(0);
  });

  test("the Cycle review view opens with the three pinned columns first", async ({ page }) => {
    await open(page);
    const chips = page.getByRole("group", { name: "View" });
    await chips.getByRole("button", { name: "Cycle review", exact: true }).click();
    await expect(chips.getByRole("button", { name: "Cycle review", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect((await headers(page)).slice(0, 3)).toEqual(["Stack Rank", "Initiative ID", "Initiative Name"]);
  });

  test("no accessibility violations on a default view", async ({ page }) => {
    await open(page);
    await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Delivery", exact: true }).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
  });
});
