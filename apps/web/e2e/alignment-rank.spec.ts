import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #394: the suggested order on the results page of a closed alignment session (in-memory test page, fictional data).
const open = async (page: Page) => { await page.goto("/dev/rank"); await page.getByRole("table", { name: "Suggested order for the Stack Rank" }).waitFor(); };
const rowOf = (page: Page, code: string) => page.getByRole("row").filter({ hasText: code });
const applied = (page: Page) => page.evaluate(() => (window as unknown as { __applied: { session: string; items: string[]; seen: string }[] }).__applied);

test("shows where each initiative moves, in words, and keeps ties in their current order", async ({ page }) => {
  await open(page);
  // the voted initiatives hold #1, #2, #6, #9 and #12; the crowd put R-04 first, R-02 fourth. The tie (R-11 at #2, R-07 at #9) keeps its current order.
  await expect(rowOf(page, "R-04")).toContainText("#6");
  await expect(rowOf(page, "R-04")).toContainText("#1");
  await expect(rowOf(page, "R-04")).toContainText("up 5");
  await expect(rowOf(page, "R-02")).toContainText("down 8");
  await expect(rowOf(page, "R-11")).toContainText("#2");
  await expect(rowOf(page, "R-11")).toContainText("stays");
  await expect(rowOf(page, "R-07")).toContainText("up 3"); // #9 to #6, the next position after R-11's
  await expect(page.getByText("1 initiative was left out")).toBeVisible();
  await expect(page.getByText(/Effect on the fit line: not shown yet/)).toBeVisible();
  await expect(rowOf(page, "R-11")).toContainText("=2");
  await page.screenshot({ path: "../../docs/screenshots/394-suggested-order.png", fullPage: true });
});

test("nothing is sent until the review step is confirmed, and only the ticked initiatives are sent", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Review changes…" }).click();
  const confirm = page.getByRole("region", { name: "Change the Stack Rank?" });
  await expect(confirm).toContainText("for everyone");
  await expect(confirm).toContainText("you can undo it from this page");
  await expect(confirm).toContainText("R-04");
  await expect(confirm).toContainText("#6 to #1 (up 5)");
  expect(await applied(page)).toEqual([]); // reviewing sends nothing
  await page.screenshot({ path: "../../docs/screenshots/394-confirm-step.png", fullPage: true });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  // untick two: the others reorder among their own positions only
  await page.getByRole("checkbox", { name: /Include R-11/ }).uncheck();
  await page.getByRole("checkbox", { name: /Include R-07/ }).uncheck();
  await expect(rowOf(page, "R-11")).toContainText("not included");
  await page.getByRole("button", { name: "Review changes…" }).click();
  await page.getByRole("button", { name: /^Apply \d+ changes? to Stack Rank$/ }).click();
  const sent = await applied(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.items).toHaveLength(3);
  expect(JSON.parse(sent[0]!.seen)).toMatchObject({ "00000000-0000-4000-8000-000000000001": 6 }); // the ranks the person saw travel with the request
});

test("with fewer than two ticked, or no change to make, the review button is off and says why; the keyboard does it all", async ({ page }) => {
  await open(page);
  for (const code of ["R-11", "R-07", "R-02", "R-15"]) await page.getByRole("checkbox", { name: new RegExp(`Include ${code}`) }).uncheck();
  await expect(page.getByRole("button", { name: "Review changes…" })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Tick at least two initiatives");
  await page.getByRole("checkbox", { name: /Include R-02/ }).check();
  await expect(page.getByRole("button", { name: "Review changes…" })).toBeEnabled();
  // keyboard only: focus the review button, open it, move to apply
  await page.getByRole("button", { name: "Review changes…" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Change the Stack Rank?" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Apply \d+ changes? to Stack Rank$/ })).toBeFocused();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
