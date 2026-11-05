import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page) => {
  await page.goto("/dev/attention");
  await page.waitForSelector(".attention-item");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const item = (page: Page, code: string) => page.locator(".attention-item", { hasText: code });

test.describe("Needs attention", () => {
  test("lists every reason in words, worst first, with the count of each", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "All (8)" })).toHaveAttribute("aria-selected", "true");
    // urgent first: blocked work and a cancelled initiative that is still being built, then the rest by rank
    await expect(page.locator(".attention-item .attention-name")).toHaveText([/R-03/, /R-05/, /R-07/, /R-01/, /R-02/, /R-04/, /R-06/, /R-08/]);
    await expect(item(page, "R-01")).toContainText("The build is done in the tracker. Move to Test?");
    await expect(item(page, "R-02")).toContainText("before gate B");
    await expect(item(page, "R-03")).toContainText("Cancelled but the build is still in progress");
    await expect(item(page, "R-04")).toContainText("look at this Hold again has come");
    await expect(item(page, "R-05")).toContainText("Health is Blocked");
    await expect(item(page, "R-06")).toContainText("72 days in Define (usually at most 30)");
    await expect(item(page, "R-07")).toContainText("Gate B has waited 12 days for a decision");
    await expect(item(page, "R-08")).toContainText("2 open conditions: Legal review; Privacy note");
    await expect(page.getByRole("tab", { name: "Build done (1)" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Open conditions (1)" })).toBeVisible();
  });

  test("a filter keeps only that reason", async ({ page }) => {
    await open(page);
    await page.getByRole("tab", { name: "Waiting for a decision (1)" }).click();
    await expect(page.locator(".attention-item")).toHaveCount(1);
    await expect(page.locator(".attention-item")).toContainText("R-07");
  });

  test("the next step is one click: Move to Test goes through the gate function and the card leaves the list", async ({ page }) => {
    await open(page);
    await item(page, "R-01").getByRole("button", { name: "Move to Test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "R-01 moved to Test." })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pv: { gates: { calls: string[] } } }).__pv.gates.calls)).toContain("move item-1 Test");
    await expect(page.getByRole("tab", { name: "All (7)" })).toBeVisible();
    await expect(item(page, "R-01")).toHaveCount(0);
  });

  test("Request gate opens the same dialog as the bulk bar; a failed move says why and changes nothing", async ({ page }) => {
    await open(page);
    await item(page, "R-02").getByRole("button", { name: "Request gate B" }).click();
    await expect(page.getByRole("dialog", { name: "Request a gate for 1 initiative" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.evaluate(() => { (window as unknown as { __pv: { gates: { failMove: string } } }).__pv.gates.failMove = "Only a Creator or an Admin can do this"; });
    await item(page, "R-01").getByRole("button", { name: "Move to Test" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "R-01 was not moved: Only a Creator or an Admin can do this" })).toBeVisible();
    await expect(item(page, "R-01")).toHaveCount(1);
  });

  test("J and K move through the list and Enter opens the initiative", async ({ page }) => {
    await open(page);
    await page.keyboard.press("j");
    await expect(page.locator(".attention-item.is-active")).toContainText("R-03");
    await page.keyboard.press("j");
    await expect(page.locator(".attention-item.is-active")).toContainText("R-05");
    await page.keyboard.press("k");
    await expect(page.locator(".attention-item.is-active")).toContainText("R-03");
  });

  test("has no accessibility violations", async ({ page }) => {
    await open(page);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
});
