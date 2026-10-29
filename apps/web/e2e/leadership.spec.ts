import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=40") => {
  await page.goto(`/dev/leadership?${query}`);
  await page.waitForSelector(".lead-tiles");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const lead = (page: Page) => page.evaluate(() => (window as unknown as { __pv: { lead: { updates: { body: string; reviewedAt: string | null; reviewedBy: string | null }[] } } }).__pv.lead.updates.map((u) => ({ body: u.body, reviewedAt: u.reviewedAt, reviewedBy: u.reviewedBy })));

test.describe("the page", () => {
  test("shows the week, the scope and that it is read-only", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: "Leadership", level: 1 })).toBeVisible();
    await expect(page.locator(".leadership-head")).toContainText("Week 15 · 12 to 18 Apr 2027");
    await expect(page.locator(".leadership-head")).toContainText("All projects · read-only");
    await expect(page.getByRole("link", { name: "Leadership" })).toHaveAttribute("aria-current", "page");
  });

  test("health by project is in words, per project, A to Z, with totals matching the items", async ({ page }) => {
    await open(page);
    const rows = page.locator("[data-project]");
    await expect(rows.first().locator("th")).toHaveText("Data");
    await expect(rows.first()).toContainText(/\d+ (On Track|At Risk|Delayed|Blocked)/);
    const total = await rows.evaluateAll((els) => els.reduce((n, el) => n + Number(el.querySelector("td")!.textContent), 0));
    expect(total).toBe(40);
  });

  test("needs attention lists Blocked, Delayed, At Risk and late initiatives with the reasons, worst first", async ({ page }) => {
    await open(page);
    const items = page.getByTestId("attention").locator("li");
    expect(await items.count()).toBeGreaterThan(3);
    await expect(items.first()).toContainText(/Delayed|Blocked/);
    await expect(page.getByTestId("attention")).toContainText("has passed");
    await expect(page.getByRole("heading", { name: /Needs attention/ })).toBeVisible();
  });

  test("top items are the first ten by global rank, in the columns of the Leadership view", async ({ page }) => {
    await open(page);
    const rows = page.getByTestId("top-items").locator("tbody tr");
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText("#1");
    await expect(page.getByTestId("top-items").locator("thead th").allTextContents()).resolves.toEqual(expect.arrayContaining(["Stack Rank", "Initiative ID", "Initiative Name", "Home Project", "Initiative Group", "Roadmap Category", "Initiative Phase", "Health", "Business Value (12m run-rate)"]));
    await expect(page.locator(".lead-note")).toContainText("arrive with their phases");
  });

  test("what moved this week comes from the audit log: rank as a net move, status and health in words", async ({ page }) => {
    await open(page);
    const moves = page.getByTestId("moves");
    await expect(moves).toContainText("R-06 Initiative number 6 with a reasonably long title moved up 3 places (#9 to #6)");
    await expect(moves).toContainText("health changed from On Track to At Risk");
    await expect(moves).toContainText("status changed from Not started to In progress");
    await expect(moves).toContainText("R-01 Initiative number 1 with a reasonably long title moved up 2 places (#3 to #1)"); // two steps, one net move
    expect(await moves.locator("li", { hasText: "R-01" }).count()).toBe(1);
    await expect(moves).not.toContainText("R-04"); // moved down and back to where it was: no net move
    await expect(moves).not.toContainText("R-09"); // changed before this week
  });

  test("the investment mix shows each Roadmap Category with a count and a share", async ({ page }) => {
    await open(page);
    const mix = page.getByTestId("mix");
    await expect(mix).toContainText("New big bets");
    await expect(mix.locator("li").first()).toContainText(/\d+ · \d+%/);
  });

  test("respects the scope", async ({ page }) => {
    await open(page);
    await page.locator(".scope-chip").click();
    await page.getByRole("menuitemradio", { name: /Customer-facing work/ }).click();
    await expect(page.locator(".leadership-head")).toContainText("Customer-facing work");
    await expect(page.locator("[data-project]")).toHaveCount(1);
    await expect(page.locator("[data-project] th")).toHaveText("Growth");
  });

  test("clicking an item code opens the item panel, read-only for a leadership viewer", async ({ page }) => {
    await open(page, "n=40&role=leadership");
    await page.getByTestId("top-items").getByRole("button", { name: "R-01" }).click();
    await expect(page.getByTestId("item-panel")).toContainText("Initiative number 1");
    await expect(page.getByTestId("item-panel").locator('[data-field="initiative_name"] input')).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
  });
});

test.describe("the weekly update", () => {
  test("a creator drafts it from the data: sections, facts with codes, an ask line, and nothing is sent", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("weekly-update");
    await expect(panel).toContainText("Nothing is sent anywhere automatically");
    await panel.getByRole("button", { name: "Draft weekly update" }).click();
    const box = panel.getByLabel("Weekly update text");
    await expect(box).toBeVisible();
    const text = await box.inputValue();
    expect(text.split("\n")[0]).toBe("All projects, week 15 (12 to 18 Apr 2027)");
    for (const h of ["Highlights", "Risks and asks", "What moved this week", "Next two weeks", "Investment mix"]) expect(text).toContain(`\n${h}\n`);
    expect(text).toContain("R-05 Initiative number 5 with a reasonably long title was completed on 13 Apr.");
    expect(text).toContain("Ask: ");
    await expect(panel.locator(".lead-status")).toContainText("Draft, not reviewed yet");
    await expect(panel.locator(".lead-sources")).toContainText("R-05");
    expect((await lead(page))).toHaveLength(1);
  });

  test("it can be edited (saved when you leave the box) and marked reviewed with who and when; editing again clears the review", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("weekly-update");
    await panel.getByRole("button", { name: "Draft weekly update" }).click();
    const box = panel.getByLabel("Weekly update text");
    await box.fill("Edited by hand\nAsk: a slot for the finance API team");
    await expect(panel.locator(".lead-status")).toContainText("Unsaved changes");
    await page.getByRole("heading", { name: "Weekly update" }).click(); // leave the box
    await expect(panel.locator(".lead-status")).toContainText("Draft, not reviewed yet");
    expect((await lead(page))[0]!.body).toBe("Edited by hand\nAsk: a slot for the finance API team");
    await panel.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(panel.locator(".lead-status")).toContainText("Reviewed by ana@example.test on 14 Apr");
    await expect(panel).toContainText("Nothing was sent anywhere");
    expect((await lead(page))[0]!.reviewedBy).toBe("u1");
    await box.fill("Edited again");
    await page.getByRole("heading", { name: "Weekly update" }).click();
    await expect(panel.locator(".lead-status")).toContainText("Draft, not reviewed yet");
    expect((await lead(page))[0]!.reviewedAt).toBeNull();
  });

  test("drafting again asks before it replaces your text", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("weekly-update");
    await panel.getByRole("button", { name: "Draft weekly update" }).click();
    await panel.getByLabel("Weekly update text").fill("My own words");
    await page.getByRole("heading", { name: "Weekly update" }).click();
    await panel.getByRole("button", { name: "Draft again from the data" }).click();
    await expect(panel).toContainText("Your edits are lost");
    await panel.getByRole("button", { name: "Keep my text" }).click();
    expect(await panel.getByLabel("Weekly update text").inputValue()).toBe("My own words");
    await panel.getByRole("button", { name: "Draft again from the data" }).click();
    await panel.getByRole("button", { name: "Yes, replace it" }).click();
    expect(await panel.getByLabel("Weekly update text").inputValue()).toContain("Highlights");
  });

  test("a failed save is explained and the page stays usable", async ({ page }) => {
    await open(page);
    await page.evaluate(() => { (window as unknown as { __pv: { lead: { failWith: string } } }).__pv.lead.failWith = "Could not save the weekly update. Try again."; });
    await page.getByTestId("weekly-update").getByRole("button", { name: "Draft weekly update" }).click();
    await expect(page.getByTestId("weekly-update").getByRole("alert")).toContainText("Could not save");
    await expect(page.getByTestId("weekly-update").getByRole("button", { name: "Draft weekly update" })).toBeVisible();
  });

  test("a leadership viewer cannot edit anything: they read the reviewed update and no draft controls exist", async ({ page }) => {
    await open(page, "n=40&role=leadership");
    const panel = page.getByTestId("weekly-update");
    await expect(panel.getByTestId("reviewed-text")).toContainText("R-05 was completed on 13 Apr.");
    await expect(panel).toContainText("Reviewed by bo@example.test on 14 Apr");
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Draft weekly update|Mark reviewed/ })).toHaveCount(0);
  });

  test("without a reviewed update a leadership viewer is told so (and sees no unreviewed draft)", async ({ page }) => {
    await open(page, "n=40&role=commenter");
    await expect(page.getByTestId("weekly-update")).toContainText("There is no reviewed update for this week yet");
  });
});

test.describe("accessibility", () => {
  test("the page passes the WCAG A/AA check with a draft open", async ({ page }) => {
    await open(page);
    await page.getByTestId("weekly-update").getByRole("button", { name: "Draft weekly update" }).click();
    await page.getByLabel("Weekly update text").waitFor();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`)).toEqual([]);
  });
});
