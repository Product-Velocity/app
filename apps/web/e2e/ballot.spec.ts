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

  test("moscow: every initiative needs a choice, the choices are Must, Should, Could and Won't, and submit sends them all", async ({ page }) => {
    await open(page, "moscow", 3);
    const submit = page.getByRole("button", { name: "Submit my vote" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText("Choose for 3 more initiatives.")).toBeVisible();
    await page.getByRole("button", { name: /^Must\s*for Initiative 1$/ }).click();
    await page.getByRole("button", { name: /^Should\s*for Initiative 2$/ }).click();
    await expect(page.getByText("Choose for 1 more initiative.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Must\s*for Initiative 1$/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^Won't\s*for Initiative 3$/ }).click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText("Your vote is saved.")).toBeVisible();
    expect((await rec(page)).submits[0]!.answers).toEqual({ moscow: { "item-1": "must", "item-2": "should", "item-3": "wont" } });
  });

  test("the card under More is closed until opened and shows the three fields", async ({ page }) => {
    await open(page, "coins", 3);
    const more = page.getByText("More about this initiative");
    await expect(more).toHaveCount(1); // only the first initiative has a card
    await expect(page.getByText("Business Line")).toBeHidden();
    await more.click();
    await expect(page.getByText("Business Line")).toBeVisible();
    await expect(page.getByText("€250,000")).toBeVisible();
    await expect(page.getByText("Effort", { exact: true })).toBeVisible();
  });
});

for (const [name, viewport] of [["a 360 px phone", { width: 360, height: 740 }], ["a 390 px phone", { width: 390, height: 844 }], ["a tablet", { width: 768, height: 1024 }], ["a desktop", { width: 1280, height: 800 }]] as const) {
  test.describe(`voting screens on ${name}`, () => {
    test.use({ viewport });
    for (const method of ["coins", "ice", "top5_duels", "moscow"]) {
      test(`${method}: no sideways scrolling, no accessibility violations, tap targets and the submit bar stay usable`, async ({ page }) => {
        await open(page, method, 6);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
        // every button and number field is at least 44px high (WCAG 2.2 target size, brand guide)
        const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".voter button, .voter input[type=number]")].filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent?.trim() || e.getAttribute("aria-label") || e.tagName));
        expect(small).toEqual([]);
        // the page uses the voter layout: the 16px reading size, not the 13px app size
        expect(await page.evaluate(() => getComputedStyle(document.querySelector(".voter")!).fontSize)).toBe("16px");
      });
    }
  });
}
