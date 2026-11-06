import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "") => {
  await page.goto(`/dev/notifications${query}`);
  await page.getByRole("button", { name: /^Notifications,/ }).waitFor();
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const bell = (page: Page) => page.getByRole("button", { name: /^Notifications,/ });
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { source: { calls: string[] } } }).__pv.source.calls);

test.describe("the notifications bell", () => {
  test("says how many are unread in words and lists them newest first, with the unread ones marked as New", async ({ page }) => {
    await open(page);
    await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread");
    await bell(page).click();
    const panel = page.getByRole("region", { name: "Notifications" });
    await expect(panel.getByText("2 unread")).toBeVisible();
    const items = panel.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("New. R-12 New checkout flow asks for a decision on gate B (Define to Build).");
    await expect(items.nth(1)).toContainText("R-03 Faster onboarding: gate A (Discover to Define) was decided: Go (fast lane).");
    await expect(items.nth(2)).not.toContainText("New.");
    await expect(items.nth(2)).toContainText("was withdrawn because the initiative moved");
  });

  test("a click marks that notice read and leads to Decisions for a request and to the initiative for a decision", async ({ page }) => {
    await open(page);
    await bell(page).click();
    await page.getByRole("button", { name: /R-12 New checkout flow asks for a decision/ }).click();
    await expect(page.getByTestId("opened")).toHaveText("Opened: decisions");
    expect(await calls(page)).toContain("read 1");
    await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
    await bell(page).click();
    await page.getByRole("button", { name: /R-03 Faster onboarding/ }).click();
    await expect(page.getByTestId("opened")).toHaveText("Opened: item R-03");
    await expect(bell(page)).toHaveAccessibleName("Notifications, none unread");
  });

  test("Mark all as read clears the count without opening anything", async ({ page }) => {
    await open(page);
    await bell(page).click();
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(bell(page)).toHaveAccessibleName("Notifications, none unread");
    expect(await calls(page)).toContain("read all");
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("All read")).toBeVisible();
    await expect(page.getByTestId("opened")).toHaveText("Opened: nothing");
  });

  test("an empty inbox says so; Escape closes the panel", async ({ page }) => {
    await open(page, "?empty=1");
    await bell(page).click();
    await expect(page.getByRole("status").filter({ hasText: "No notifications." })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
  });

  test("has no accessibility violations, open", async ({ page }) => {
    await open(page);
    await bell(page).click();
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
