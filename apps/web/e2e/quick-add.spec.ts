import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=30&view=All columns&cols=all") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const input = (page: Page) => page.getByLabel("Add an initiative");
const rowByName = (page: Page, name: string) => page.locator(".ag-row", { has: page.locator(`[col-id="initiative_name"]`, { hasText: name }) });
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);

test("keyboard only: Alt+N, type the name and tokens, Enter adds it at the end, in under 10 seconds", async ({ page }) => {
  await open(page);
  await page.locator(`.ag-row[row-id="item-1"] [col-id="initiative_name"]`).click();
  const t0 = Date.now();
  await page.keyboard.press("Alt+N");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("Brand new idea #market @bo M should");
  await expect(page.locator(".quick-add-summary")).toContainText("Project: Marketplace · Product Manager: bo@example.test · Effort: M · MoSCoW: Should");
  await page.keyboard.press("Enter");
  const row = rowByName(page, "Brand new idea");
  await expect(row).toHaveCount(1);
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect(row.locator(`[col-id="home_project"]`)).toHaveText("Marketplace");
  await expect(row.locator(`[col-id="effort"]`)).toHaveText("M");
  await expect(row.locator(`[col-id="moscow"]`)).toHaveText("Should");
  await expect(row.locator(`[col-id="stack_rank"]`)).toHaveText("#31");
  await expect(input(page)).toHaveValue("");
  await expect(input(page)).toBeFocused(); // ready for the next one
  await settle(page);
  await expect(page.locator(".strip")).toContainText("All changes saved");
  await expect(row.locator(`[col-id="item_code"]`)).toHaveText("R-31"); // assigned by the (test) database
  await expect(page.locator(".grid-foot")).toContainText("31 items");
});

test("Alt+N works from anywhere on the page, not only inside the grid", async ({ page }) => {
  await open(page);
  await page.getByRole("heading", { name: "Roadmap (test page)" }).click();
  await page.keyboard.press("Alt+N");
  await expect(input(page)).toBeFocused();
});

test("only the name is required; the project comes from the row you are on", async ({ page }) => {
  await open(page);
  await page.locator(`.ag-row[row-id="item-3"] [col-id="initiative_name"]`).click(); // item-3 is in Growth
  await page.keyboard.press("Alt+N");
  await page.keyboard.type("Just a name");
  await expect(page.locator(".quick-add-summary")).toContainText("Project: Growth (from the row you are on)");
  await page.keyboard.press("Enter");
  await expect(rowByName(page, "Just a name").locator(`[col-id="home_project"]`)).toHaveText("Growth");
});

test("a token that matches nothing explains itself and adds nothing", async ({ page }) => {
  await open(page);
  await input(page).fill("Oops #nowhere");
  await input(page).press("Enter");
  await expect(page.locator(".quick-add-error")).toContainText('No project named "nowhere"');
  await expect(rowByName(page, "Oops")).toHaveCount(0);
  await expect(page.locator(".grid-foot")).toContainText("30 items");
});

test("a similar existing item is shown while typing, and can still be added", async ({ page }) => {
  await open(page);
  await input(page).fill("Initiative number 7 with a reasonably long title #platform");
  await expect(page.locator(".quick-add-similar")).toContainText("R-07 Initiative number 7");
  await input(page).press("Enter");
  await expect(page.locator(".grid-foot")).toContainText("31 items");
});

test("pasting a list adds many items as one undo step; bad lines are reported", async ({ page }) => {
  await open(page);
  await input(page).focus();
  await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(".quick-add-input")!;
    const dt = new DataTransfer();
    dt.setData("text/plain", "- First pasted #platform\n- Second pasted #growth M\n\n3. Third pasted #nowhere\n* Fourth pasted #mobile could");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".grid-foot")).toContainText("33 items");
  await expect(page.locator(".quick-add-error")).toContainText("Added 3 items. Skipped 1: line 4");
  await expect(rowByName(page, "Second pasted").locator(`[col-id="effort"]`)).toHaveText("M");
  await settle(page);
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(page.locator(".grid-foot")).toContainText("30 items");
  await expect(rowByName(page, "First pasted")).toHaveCount(0);
  await page.getByRole("button", { name: /^Redo/ }).click();
  await expect(page.locator(".grid-foot")).toContainText("33 items");
});

test("undo takes a quick-added item away again", async ({ page }) => {
  await open(page);
  await input(page).fill("Temporary #platform");
  await input(page).press("Enter");
  await expect(rowByName(page, "Temporary")).toHaveCount(1);
  await settle(page);
  await page.getByRole("button", { name: /^Undo/ }).click();
  await expect(rowByName(page, "Temporary")).toHaveCount(0);
  await expect(page.locator(".strip")).toContainText('Undid: Added');
});

test("view-only roles do not get the quick-add row", async ({ page }) => {
  await open(page, "n=20&role=viewer");
  await expect(input(page)).toHaveCount(0);
});

test("accessibility: the quick-add row has no WCAG A/AA violations", async ({ page }) => {
  await open(page, "n=30");
  await input(page).fill("Something similar #platform");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.help})`)).toEqual([]);
});
