import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page) => {
  await page.goto("/dev/grid?n=40");
  await page.waitForSelector(".ag-row");
};
// a click on empty page space: the heading of the test page
const clickElsewhere = (page: Page) => page.getByRole("heading", { name: "Roadmap (test page)" }).click();

test.describe("menus close when you click somewhere else", () => {
  test("Filters, Group by and Views panels", async ({ page }) => {
    await open(page);
    for (const name of [/^Filters/, /^Group by/, /^Views/]) {
      const button = page.getByRole("button", { name });
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await clickElsewhere(page);
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
  });

  test("the Columns panel", async ({ page }) => {
    await open(page);
    const button = page.getByRole("button", { name: /^Columns/ });
    await button.click();
    await expect(page.getByRole("group", { name: "Choose columns" })).toBeVisible();
    await clickElsewhere(page);
    await expect(page.getByRole("group", { name: "Choose columns" })).toHaveCount(0);
  });

  test("the account menu closes on an outside click and on Escape", async ({ page }) => {
    await page.goto("/dev/item/R-01");
    const menu = page.locator("details.account");
    await menu.locator("summary").click();
    await expect(menu).toHaveJSProperty("open", true);
    await page.mouse.click(400, 600);
    await expect(menu).toHaveJSProperty("open", false);
    await menu.locator("summary").click();
    await expect(menu).toHaveJSProperty("open", true);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveJSProperty("open", false);
  });

  test("the bulk bar's Set menu", async ({ page }) => {
    await open(page);
    await page.locator('.ag-row[row-id] .ag-checkbox-input').first().check();
    const button = page.getByRole("button", { name: /^Set MoSCoW/ });
    await button.click();
    await expect(page.getByRole("menu", { name: "Set MoSCoW" })).toBeVisible();
    await page.mouse.click(700, 200);
    await expect(page.getByRole("menu", { name: "Set MoSCoW" })).toHaveCount(0);
  });
});

test("grouped rows show the health in words, and health pills have no icon", async ({ page }) => {
  await page.goto("/dev/grid?n=40&view=Prioritisation&cols=all");
  await page.waitForSelector(".ag-row");
  await page.getByRole("button", { name: /^Group by/ }).click();
  await page.getByRole("searchbox", { name: "Search group by options" }).fill("moscow");
  await page.keyboard.press("Enter");
  const group = page.locator(".group-row").first();
  await expect(group).toBeVisible();
  await expect(group.locator(".group-health")).toHaveText(/^\d+ (On Track|At Risk|Delayed|Blocked)( · \d+ (On Track|At Risk|Delayed|Blocked))*$/);
  const pill = page.locator(".pill[class*=health-]").first();
  await expect(pill).toHaveText(/^(On Track|At Risk|Delayed|Blocked)$/);
  expect((await pill.boundingBox())!.height).toBeLessThanOrEqual(20.5);
});
