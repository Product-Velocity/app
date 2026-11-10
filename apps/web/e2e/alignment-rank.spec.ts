import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issues #394 and #397: the order for the Stack Rank on the results page of a closed alignment session (in-memory test page, fictional data).
// The voted initiatives hold #1, #2, #6, #9 and #12. The vote: R-04 first, R-11 and R-07 tied second, R-02 fourth, R-15 fifth.
const ID = { "R-04": "00000000-0000-4000-8000-000000000001", "R-11": "00000000-0000-4000-8000-000000000002", "R-07": "00000000-0000-4000-8000-000000000003", "R-02": "00000000-0000-4000-8000-000000000004", "R-15": "00000000-0000-4000-8000-000000000005" } as const;
const open = async (page: Page) => { await page.goto("/dev/rank"); await page.getByRole("table", { name: "Order for the Stack Rank" }).waitFor(); };
const rowOf = (page: Page, code: string) => page.getByRole("table", { name: "Order for the Stack Rank" }).getByRole("row").filter({ hasText: code });
const codes = (page: Page) => page.getByRole("table", { name: "Order for the Stack Rank" }).locator("tbody tr strong").allInnerTexts();
const applied = (page: Page) => page.evaluate(() => (window as unknown as { __applied: { session: string; items: string[]; order: string[]; reasons: Record<string, string>; seen: string }[] }).__applied);

test("starts from the vote: where each initiative moves, in words, with ties in their current order", async ({ page }) => {
  await open(page);
  expect(await codes(page)).toEqual(["R-04", "R-11", "R-07", "R-02", "R-15"]);
  await expect(rowOf(page, "R-04")).toContainText("#6");
  await expect(rowOf(page, "R-04")).toContainText("#1 (up 5)");
  await expect(rowOf(page, "R-02")).toContainText("#9 (down 8)");
  await expect(rowOf(page, "R-11")).toContainText("#2 (stays)");
  await expect(rowOf(page, "R-07")).toContainText("#6 (up 3)");
  await expect(rowOf(page, "R-11")).toContainText("=2");
  await expect(page.getByText("1 initiative was left out")).toBeVisible();
  await expect(page.getByText(/Effect on the fit line: not shown yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Back to the vote/ })).toHaveCount(0); // it is the vote's order
  await page.screenshot({ path: "../../docs/screenshots/394-suggested-order.png", fullPage: true });
});

test("applying the vote's own order needs no reason; nothing is sent until the review is confirmed", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Review changes…" }).click();
  const confirm = page.getByRole("region", { name: "Change the Stack Rank?" });
  await expect(confirm).toContainText("for everyone");
  await expect(confirm).toContainText("you can undo it from this page");
  await expect(confirm).toContainText("as the vote suggests");
  await expect(confirm.getByRole("textbox")).toHaveCount(0); // nothing differs, so no reason is asked for
  expect(await applied(page)).toEqual([]);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("checkbox", { name: /Include R-11/ }).uncheck();
  await page.getByRole("checkbox", { name: /Include R-07/ }).uncheck();
  await expect(rowOf(page, "R-11")).toContainText("not included");
  await page.getByRole("button", { name: "Review changes…" }).click();
  await page.getByRole("button", { name: /^Apply \d+ changes? to Stack Rank$/ }).click();
  const sent = await applied(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.items).toHaveLength(3);
  expect(sent[0]!.order).toHaveLength(3);
  expect(JSON.parse(sent[0]!.seen)).toMatchObject({ [ID["R-04"]]: 6 }); // the ranks the person saw travel with the request
});

test("moving an initiative changes the final order, the move stays on the keyboard, and the difference from the vote is named", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Move R-15 up" }).click();
  await expect(page.getByRole("button", { name: "Move R-15 up" })).toBeFocused(); // focus follows the row it moved
  expect(await codes(page)).toEqual(["R-04", "R-11", "R-07", "R-15", "R-02"]);
  await expect(rowOf(page, "R-15")).toContainText("#9 (up 3)");
  await expect(rowOf(page, "R-15")).toContainText("differs from the vote");
  await expect(rowOf(page, "R-02")).toContainText("differs from the vote");
  await expect(rowOf(page, "R-04")).not.toContainText("differs from the vote");
  await expect(page.getByRole("status").filter({ hasText: "R-15 is now place 4 of 5." })).toBeAttached();
  await expect(page.getByRole("button", { name: /Back to the vote/ })).toBeVisible();
  // the first row cannot move up and the last cannot move down
  await expect(page.getByRole("button", { name: "Move R-04 up" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Move R-02 down" })).toHaveAttribute("aria-disabled", "true");
  // typing the place takes the initiative there
  const place = page.getByRole("spinbutton", { name: /Place in your order for R-02/ });
  await place.fill("1");
  await place.press("Enter");
  expect(await codes(page)).toEqual(["R-02", "R-04", "R-11", "R-07", "R-15"]);
  await expect(rowOf(page, "R-02")).toContainText("#1 (stays)");
  // back to the vote's order removes every difference
  await page.getByRole("button", { name: /Back to the vote/ }).click();
  expect(await codes(page)).toEqual(["R-04", "R-11", "R-07", "R-02", "R-15"]);
  await expect(page.getByText("differs from the vote")).toHaveCount(0);
});

test("a reason is required for every initiative that differs from the vote, and is sent with the final order", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Move R-15 up" }).click();
  await page.getByRole("button", { name: "Review changes…" }).click();
  const confirm = page.getByRole("region", { name: "Change the Stack Rank?" });
  await expect(confirm.getByRole("textbox")).toHaveCount(2); // R-15 and R-02 differ; the others match the vote
  const apply = confirm.getByRole("button", { name: /^Apply \d+ changes? to Stack Rank$/ });
  await expect(apply).toBeDisabled();
  await expect(confirm).toContainText("Give a reason for 2 initiatives.");
  await expect(confirm).toContainText("seen by admins only");
  await expect(confirm).toContainText("never sent to GitHub or Jira");
  await confirm.getByRole("textbox", { name: /Reason for R-15/ }).fill("Unblocks the Q1 launch");
  await expect(apply).toBeDisabled();
  await confirm.getByRole("textbox", { name: /Reason for R-02/ }).fill("   "); // blank is not a reason
  await expect(apply).toBeDisabled();
  await confirm.getByRole("textbox", { name: /Reason for R-02/ }).fill("Waits for R-15");
  await expect(apply).toBeEnabled();
  await page.screenshot({ path: "../../docs/screenshots/397-reasons-step.png", fullPage: true });
  await apply.click();
  const sent = (await applied(page))[0]!;
  expect(sent.order).toEqual([ID["R-04"], ID["R-11"], ID["R-07"], ID["R-15"], ID["R-02"]]); // the final order, as chosen
  expect(sent.reasons).toEqual({ [ID["R-15"]]: "Unblocks the Q1 launch", [ID["R-02"]]: "Waits for R-15" });
});

test("changing the order while the review is open closes it, so a reason is never left for an order that is gone; a reason has a length limit", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Move R-15 up" }).click();
  await page.getByRole("button", { name: "Review changes…" }).click();
  const confirm = page.getByRole("region", { name: "Change the Stack Rank?" });
  await expect(confirm.getByRole("textbox", { name: /Reason for R-15/ })).toHaveAttribute("maxlength", "300");
  await confirm.getByRole("textbox", { name: /Reason for R-15/ }).fill("A reason");
  await page.getByRole("button", { name: "Move R-15 up" }).click(); // the order changes again
  await expect(confirm).toHaveCount(0);
  expect(await codes(page)).toEqual(["R-04", "R-11", "R-15", "R-07", "R-02"]);
  expect(await applied(page)).toEqual([]); // nothing was sent
});

test("keeping today's order when the vote would move things changes nothing, so there is nothing to review", async ({ page }) => {
  await open(page);
  // the team's order today: R-02 (#1), R-11 (#2), R-04 (#6), R-07 (#9), R-15 (#12)
  const place = (code: string) => page.getByRole("spinbutton", { name: new RegExp(`Place in your order for ${code}`) });
  await place("R-02").fill("1"); await place("R-02").press("Enter");
  await place("R-11").fill("2"); await place("R-11").press("Enter");
  await place("R-04").fill("3"); await place("R-04").press("Enter");
  await place("R-07").fill("4"); await place("R-07").press("Enter");
  expect(await codes(page)).toEqual(["R-02", "R-11", "R-04", "R-07", "R-15"]);
  await expect(page.getByRole("button", { name: "Review changes…" })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "The Stack Rank would not change." })).toBeVisible();
});

test("fewer than two ticked: the review button is off and says why; the keyboard does it all; no serious accessibility problems", async ({ page }) => {
  await open(page);
  for (const code of ["R-11", "R-07", "R-02", "R-15"]) await page.getByRole("checkbox", { name: new RegExp(`Include ${code}`) }).uncheck();
  await expect(page.getByRole("button", { name: "Review changes…" })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Tick at least two initiatives" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Include R-02/ }).check();
  await expect(page.getByRole("button", { name: "Review changes…" })).toBeEnabled();
  await page.getByRole("button", { name: "Review changes…" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Change the Stack Rank?" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
