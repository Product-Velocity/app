import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

type Rec = { saves: { progress: unknown; revision: number }[]; submits: { answers: Record<string, unknown> }[]; failNext: boolean };
const rec = (page: Page) => page.evaluate(() => (window as unknown as { __ballot: Rec }).__ballot);
const open = async (page: Page, method: string, n = 6) => { await page.goto(`/dev/ballot?method=${method}&n=${n}`); await page.getByRole("heading", { name: "Q1 priorities" }).waitFor(); };

test.describe("participant ballot on a phone (0.24.0)", () => {
  test("coins: a live counter, a maximum per initiative, and submit only when every coin is spent", async ({ page }) => {
    await open(page, "coins", 5);
    await expect(page.getByRole("status").first()).toContainText("100 of 100 coins left");
    const submit = page.getByRole("button", { name: "Submit my vote" });
    await expect(submit).toBeDisabled();
    const more = (n: number) => page.getByRole("button", { name: `More coins for Initiative ${n}` });
    for (let i = 0; i < 6; i++) await more(1).click(); // 30, the maximum
    await expect(page.getByRole("spinbutton", { name: "Coins for Initiative 1" })).toHaveValue("30");
    await expect(more(1)).toBeDisabled();
    for (const n of [2, 3]) for (let i = 0; i < 6; i++) await more(n).click();
    await expect(page.getByRole("status").first()).toContainText("10 of 100 coins left");
    await expect(page.getByText("Spend your last 10 coins.")).toBeVisible();
    await more(4).click(); await more(4).click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("Your vote is saved.")).toBeVisible();
    const r = await rec(page);
    expect(r.submits).toHaveLength(1);
    expect(Object.values(r.submits[0]!.answers.coins as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("a failed submit says so and keeps the answers; pressing again saves it once", async ({ page }) => {
    await open(page, "coins", 4);
    for (const n of [1, 2, 3]) for (let i = 0; i < 6; i++) await page.getByRole("button", { name: `More coins for Initiative ${n}` }).click();
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "More coins for Initiative 4" }).click();
    await page.evaluate(() => { (window as unknown as { __ballot: Rec }).__ballot.failNext = true; });
    await page.getByRole("button", { name: "Submit my vote" }).click();
    await expect(page.locator(".ballot .error")).toContainText("could not reach the server");
    await expect(page.getByRole("spinbutton", { name: "Coins for Initiative 1" })).toHaveValue("30");
    await page.getByRole("button", { name: "Submit my vote" }).click();
    await expect(page.getByText("Your vote is saved.")).toBeVisible();
    expect((await rec(page)).submits).toHaveLength(1);
  });

  test("a vote can be changed after it was sent", async ({ page }) => {
    await open(page, "ice", 2);
    await page.getByLabel("impact of Initiative 1").fill("8");
    await page.getByLabel("impact of Initiative 2").fill("3");
    await page.getByRole("button", { name: "Submit my vote" }).click();
    await expect(page.getByText("Your vote is saved.")).toBeVisible();
    await page.getByRole("button", { name: "Change my vote" }).click();
    await expect(page.getByLabel("impact of Initiative 1")).toHaveValue("8");
    await page.getByLabel("impact of Initiative 1").fill("9");
    await page.getByRole("button", { name: "Submit my vote" }).click();
    await expect(page.getByText("Your vote is saved.")).toBeVisible();
    const r = await rec(page);
    expect(r.submits).toHaveLength(2);
    expect((r.submits[1]!.answers.ice as Record<string, { impact: number }>)["item-1"]!.impact).toBe(9);
  });

  test("ICE needs every initiative scored", async ({ page }) => {
    await open(page, "ice", 3);
    await expect(page.getByText("0 of 3 scored.")).toBeVisible();
    await page.getByLabel("ease of Initiative 1").fill("7");
    await expect(page.getByText("1 of 3 scored.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit my vote" })).toBeDisabled();
    await expect(page.getByText("Score 2 more initiatives.")).toBeVisible();
  });

  test("top 5 with duels: pick five, decide ten duels, review the order, submit", async ({ page }) => {
    await open(page, "top5_duels", 7);
    const next = page.getByRole("button", { name: "Next: duels" });
    await expect(next).toBeDisabled();
    for (let n = 1; n <= 5; n++) await page.getByRole("button", { name: new RegExp(`^Pick\\s*Initiative ${n}$`) }).click();
    await expect(page.getByRole("button", { name: /^Pick\s*Initiative 6$/ })).toBeDisabled();
    await expect(page.getByText("5 of 5 picked")).toBeVisible();
    await next.click();
    for (let d = 1; d <= 10; d++) {
      await expect(page.getByText(`Duel ${d} of 10`)).toBeVisible();
      await page.getByRole("button", { name: /^This one/ }).first().click(); // the earlier pick always wins
    }
    await expect(page.getByText("This is your order")).toBeVisible();
    const items = await page.locator("ol.plain-list li").allInnerTexts();
    expect(items).toEqual(["Initiative 1", "Initiative 2", "Initiative 3", "Initiative 4", "Initiative 5"]);
    await page.getByRole("button", { name: "Submit my vote" }).click();
    await expect(page.getByText("Your vote is saved.")).toBeVisible();
    expect((await rec(page)).submits[0]!.answers.ranking).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5"]);
  });

  test("progress is saved after every change, and an older save never replaces a newer one", async ({ page }) => {
    await open(page, "coins", 4);
    await page.getByRole("button", { name: "More coins for Initiative 1" }).click();
    await page.getByRole("button", { name: "More coins for Initiative 1" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    const r = await rec(page);
    const revs = r.saves.map((s) => s.revision);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect((r.saves.at(-1)!.progress as { coins: Record<string, number> }).coins["item-1"]).toBe(10);
  });

  for (const method of ["coins", "ice", "top5_duels"]) {
    test(`${method}: fits a 390 px screen without sideways scrolling, and has no accessibility violations`, async ({ page }) => {
      await open(page, method, 6);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
