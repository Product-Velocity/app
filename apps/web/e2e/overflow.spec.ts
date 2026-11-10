import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, width: number) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/dev/grid?n=30&role=admin");
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const bar = (page: Page) => page.getByRole("region", { name: "Roadmap tools" });

test.describe("the action bar moves what does not fit into More (issue #403)", () => {
  test("wide: every tool is in the bar and there is no More button", async ({ page }) => {
    await open(page, 1600);
    for (const n of [/^Export/, "Paste table", /^Sync with GitHub/]) await expect(bar(page).getByRole("button", { name: n })).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "More tools" })).toHaveCount(0);
  });

  for (const width of [1000, 800, 600, 400]) {
    test(`at ${width}px nothing runs off the screen and every tool stays reachable`, async ({ page }) => {
      await open(page, width);
      expect(await noSideScroll(page)).toBe(true);
      const box = (await bar(page).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      await expect(page.getByLabel("Search initiatives")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Undo/ })).toBeVisible();
      for (const n of ["Paste table", "Export", "Sync with GitHub"]) {
        const inBar = bar(page).getByRole("button", { name: new RegExp(`^${n}`) });
        if (await inBar.isVisible().catch(() => false)) continue;
        await bar(page).getByRole("button", { name: "More tools" }).click();
        await expect(page.getByRole("menuitem", { name: new RegExp(`^${n}`) })).toBeVisible();
        await page.keyboard.press("Escape");
      }
    });
  }

  test("a tool in the menu works from the keyboard", async ({ page }) => {
    await open(page, 700);
    const more = bar(page).getByRole("button", { name: "More tools" });
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[role^="menuitem"]:focus')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "More tools" })).toHaveCount(0);
  });

  test("Paste table from the menu opens the import", async ({ page }) => {
    await open(page, 500);
    await bar(page).getByRole("button", { name: "More tools" }).click();
    await page.getByRole("menuitem", { name: "Paste table" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("the header tabs: the open tab stays, the rest move into More tabs, in order, from the right", async ({ page }) => {
    await open(page, 1600);
    const tabs = page.getByRole("navigation", { name: "Main", exact: true });
    await expect(tabs.getByRole("button", { name: "More tabs" })).toHaveCount(0);
    await open(page, 900);
    await expect(tabs.getByRole("link", { name: "Grid" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Reports" })).toBeHidden();
    await tabs.getByRole("button", { name: "More tabs" }).click();
    await expect(page.getByRole("menuitem", { name: "Reports" })).toBeVisible();
    // the tabs that arrive in a later phase are listed but cannot be opened
    await expect(page.getByRole("menuitem", { name: /^Planning/ })).toHaveAttribute("aria-disabled", "true");
  });
});
