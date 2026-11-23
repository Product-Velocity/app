import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("initiatives on a phone", () => {
  test("opens on the 15 most recently changed initiatives, with the change in words", async ({ page }) => {
    await page.goto("/dev/phone?n=40");
    await expect(page.locator(".phone-card")).toHaveCount(15);
    await expect(page.locator(".phone-count")).toContainText("15 recently changed");
    await expect(page.locator(".phone-card").first().locator(".phone-change")).toContainText("Health: On track → At risk");
    await expect(page.locator(".phone-card").first()).toContainText(/just now|ago/);
    // searching looks through every initiative, not only the changed ones
    await page.getByLabel("Search initiatives").fill("R-30");
    await expect(page.locator(".phone-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.locator(".phone-card")).toHaveCount(15);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("search, quick filters, grouping and collapse", async ({ page }) => {
    await page.goto("/dev/phone?n=40");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.locator(".phone-card").first()).toBeVisible();
    await expect(page.locator(".phone-count")).toContainText("40 initiatives");
    await page.getByLabel("Search initiatives").fill("R-07");
    await expect(page.locator(".phone-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Build", exact: true }).click();
    const n = await page.locator(".phone-card").count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(40);
    await expect(page.locator(".phone-group")).toHaveCount(1);
    await page.locator(".phone-group button").click();
    await expect(page.locator(".phone-card")).toHaveCount(0);
  });

  test("a card shows the health as a word and has a 44 px touch target", async ({ page }) => {
    await page.goto("/dev/phone?n=10");
    await page.getByRole("button", { name: "All", exact: true }).click();
    const c = page.locator(".phone-card").first();
    await expect(c.locator(".phone-health")).not.toBeEmpty();
    expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("passes the accessibility check", async ({ page }) => {
    await page.goto("/dev/phone?n=10");
    await page.waitForSelector(".phone-card");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe("the phone shell", () => {
  test("the top bar is one compact row and the bottom bar has icons with labels", async ({ page }) => {
    await page.goto("/dev/menu");
    const bar = page.locator("header.topbar");
    expect((await bar.boundingBox())!.height).toBeLessThan(70);
    await expect(page.locator(".topbar .brand-name")).toBeHidden();
    await expect(page.locator(".topbar .text-size")).toBeHidden();
    const tabs = page.getByRole("navigation", { name: "Main (phone)" }).getByRole("link");
    await expect(tabs).toHaveText(["Initiatives", "Decide", "Add", "Tracker", "Insights"]);
    for (const t of await tabs.all()) { await expect(t.locator("svg")).toBeVisible(); expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test("an initiative opens as a page in the flow, not as a panel laid over the list", async ({ page }) => {
    await page.goto("/dev/item/R-12?role=creator");
    const panel = page.getByTestId("item-panel");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((e) => getComputedStyle(e).position)).toBe("static");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(12);
    expect(box.width).toBeGreaterThanOrEqual(390 - 24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // the bottom bar stays on top and usable
    const hit = await page.evaluate(() => { const r = document.querySelector(".phone-nav")!.getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + 20)?.closest(".phone-nav"); });
    expect(hit).toBe(true);
    // the flags start folded, so the first screen is the initiative
    expect(await page.locator(".ip-flagged").evaluate((e) => (e as HTMLDetailsElement).open)).toBe(false);
    await expect(page.locator(".ip-flagged summary")).toContainText("flag");
    await page.locator(".ip-flagged summary").click();
    expect(await page.locator(".ip-flagged").evaluate((e) => (e as HTMLDetailsElement).open)).toBe(true);
  });
});

test.describe("one initiative on a phone", () => {
  test("opens as a read-first briefing with the facts, the flags, the build and the latest changes", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=item");
    await expect(page.getByRole("heading", { level: 1, name: /Initiative number 12/ })).toBeVisible();
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
    await expect(page.locator(".briefing-pills")).toContainText("Health: Delayed");
    await expect(page.getByRole("region", { name: "Needs attention" })).toContainText("Delivery risk");
    const where = page.getByRole("region", { name: "Where it stands" });
    for (const label of ["Phase", "Owner", "Planned quarter", "Gate"]) await expect(where.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Build" })).toContainText("cannot be edited here");
    const changes = page.getByRole("region", { name: "Latest changes" });
    await expect(changes.locator("li").first()).toContainText(/Health|Linked issue/);
    await expect(changes.locator("li").first()).toContainText("ago");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test("Edit details shows the full panel and Summary comes back", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=item");
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.getByTestId("item-panel")).toBeVisible();
    await expect(page.locator(".briefing")).toHaveCount(0);
    await page.getByRole("button", { name: "← Summary" }).click();
    await expect(page.locator(".briefing")).toBeVisible();
    await expect(page.getByTestId("item-panel")).toHaveCount(0);
  });
  test("passes the accessibility check", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=item");
    await page.waitForSelector(".briefing");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe("since you last looked", () => {
  test("counts the changes, lists them for review and remembers that they were seen", async ({ page }) => {
    await page.goto("/dev/phone?n=40");
    const card = page.locator(".phone-since");
    await expect(card).toContainText("34 changes");
    await expect(card).toContainText("since");
    await card.getByRole("button", { name: "Review" }).click();
    await expect(card.locator(".phone-card")).toHaveCount(30);
    await expect(card).toContainText("and 4 more");
    await card.getByRole("button", { name: "Mark all seen" }).click();
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("pv:last-look:")))).toBe(true);
    // the test page builds its changes from "now", so a reload brings two new ones (the newest of each kind); the 32 older ones stay seen
    await page.reload();
    await expect(page.locator(".phone-since")).toContainText("2 changes");
  });
  test("passes the accessibility check", async ({ page }) => {
    await page.goto("/dev/phone?n=40");
    await page.locator(".phone-since").getByRole("button", { name: "Review" }).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe("insights on a phone", () => {
  test("shows the key numbers and charts, each with a sentence and a table", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=insights");
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
    await expect(page.locator(".insight-tiles li")).toHaveCount(3);
    await expect(page.locator(".insight-tiles li").first().locator(".insight-num")).not.toHaveText("0");
    await expect(page.locator(".insight-tiles li").nth(1).locator(".insight-num")).not.toHaveText("0");
    await expect(page.getByRole("figure", { name: "Health" }).locator(".seg")).not.toHaveCount(0);
    await expect(page.getByRole("figure", { name: "Health" }).locator(".seg-legend")).toContainText("At Risk");
    await expect(page.getByRole("figure", { name: "Health" }).locator("figcaption p")).toContainText("need attention");
    await expect(page.getByRole("figure", { name: "Build progress by project" }).locator(".bar-list li")).not.toHaveCount(0);
    for (const name of ["Health", "Where the work is", "Build progress by project", "Planned quarters"]) {
      const chart = page.getByRole("figure", { name });
      await expect(chart).toBeVisible();
      await expect(chart.locator("figcaption p")).not.toBeEmpty();
    }
    const health = page.getByRole("figure", { name: "Health" });
    await health.getByText("Show as a table").click();
    await expect(health.getByRole("table")).toBeVisible();
    await expect(health.getByRole("columnheader", { name: "Initiatives" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test("passes the accessibility check", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=insights");
    await page.waitForSelector(".insight-chart");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe("tracker feed on a phone", () => {
  test("shows the latest ten changes and searches them", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=tracker");
    await expect(page.locator(".phone-card")).toHaveCount(10);
    await expect(page.locator(".phone-count")).toContainText("Latest 10 from GitHub and Jira");
    await page.getByLabel("Search tracker items").fill("PAY-701");
    await expect(page.locator(".phone-card")).toHaveCount(1);
    await expect(page.locator(".phone-card")).toContainText("Payment retries 1");
    await page.getByLabel("Search tracker items").fill("zzz");
    await expect(page.locator(".phone-card")).toHaveCount(0);
    await expect(page.getByText("No tracker change matches")).toBeVisible();
  });
  test("passes the accessibility check", async ({ page }) => {
    await page.goto("/dev/phone?n=40&screen=tracker");
    await page.waitForSelector(".phone-card");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe("quick add and For you on a phone", () => {
  test("adds an initiative with a name only, and offers Undo", async ({ page }) => {
    await page.goto("/dev/phone?n=10&screen=add");
    await page.getByLabel("Name").fill("Dark mode for the app");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Dark mode for the app" })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("");
  });

  test("asks for a name and warns about a similar initiative", async ({ page }) => {
    await page.goto("/dev/phone?n=10&screen=add");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator(".pf-error")).toContainText("Give it a name");
    await page.getByLabel("Name").fill("Initiative number 3 with a reasonably long title");
    await expect(page.getByText("Looks similar to:")).toBeVisible();
  });

  test("For you lists what needs attention and my placeholders, with words and no horizontal scroll", async ({ page }) => {
    await page.goto("/dev/phone?n=20&screen=for-you");
    await expect(page.getByRole("heading", { name: /My placeholders/ })).toBeVisible();
    await expect(page.getByText("Missing:").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

const PRD = "Depends on: none\n\n# 1 Executive Summary\nShort summary.\n\n**At a glance**\n- We will build the new checkout\n\n# 3 Problem Statement\nCustomers drop off.\n\n# 4 Scope\nCheckout only.";
const stubDocs = async (page: import("@playwright/test").Page) => {
  await page.route("**/api/documents?item=*", (r) => r.fulfill({ json: { documents: [{ id: "d1", kind: "prd", title: "PRD", status: "in_review", version: 3, aiDraft: false, characters: PRD.length, updatedAt: "2027-04-12T09:00:00Z", approvedAt: null, aiTool: null, aiModel: null, shared: true, shareUrl: null }] } }));
  await page.route("**/api/documents/d1", (r) => r.fulfill({ json: { document: { id: "d1", kind: "prd", title: "PRD", status: "in_review", version: 3, aiDraft: false, characters: PRD.length, updatedAt: "2027-04-12T09:00:00Z", approvedAt: null, aiTool: null, aiModel: null, shared: true, shareUrl: null, body: PRD } } }));
};

test.describe("gate decisions on a phone", () => {
  test("queue, review with the PRD, and a decision that needs a rationale and a confirmation", async ({ page }) => {
    await stubDocs(page);
    await page.goto("/dev/decisions?phone=1");
    await expect(page.locator(".phone-card")).toHaveCount(4);
    await page.locator(".phone-card", { hasText: "New checkout flow" }).click();
    await expect(page.getByRole("heading", { name: /R-02 New checkout flow/ })).toBeVisible();
    await expect(page.getByText("MoSCoW set")).toBeVisible();
    await expect(page.getByText("(missing)")).toBeVisible();
    await expect(page.getByText("We will build the new checkout")).toBeVisible(); // the "At a glance" block starts open
    await expect(page.getByText("Customers drop off.")).toHaveCount(0); // other sections start folded
    await page.getByRole("button", { name: /3 Problem Statement/ }).click();
    await expect(page.getByText("Customers drop off.")).toBeVisible();

    await page.getByRole("button", { name: "Go", exact: true }).click();
    const review = page.getByRole("button", { name: "Review decision" });
    await expect(review).toBeDisabled();
    await page.getByLabel(/Rationale/).fill("Scope is clear and the estimate is fine");
    await review.click();
    await expect(page.getByText("cannot be undone or edited")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Go" }).click();
    await expect(page.getByText("Recorded: Go for R-02 New checkout flow.")).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { __pv: { source: { calls: string[] } } }).__pv.source.calls);
    expect(calls).toContain("decide go 1");
  });

  test("Go with conditions needs at least one condition", async ({ page }) => {
    await stubDocs(page);
    await page.goto("/dev/decisions?phone=1");
    await page.locator(".phone-card", { hasText: "New checkout flow" }).click();
    await page.getByRole("button", { name: "Conditions", exact: true }).click();
    await page.getByLabel(/Rationale/).fill("Fine if the estimate is revisited");
    await expect(page.getByRole("button", { name: "Review decision" })).toBeDisabled();
    await page.getByLabel(/Conditions, one per line/).fill("Re-estimate after spike");
    await expect(page.getByRole("button", { name: "Review decision" })).toBeEnabled();
  });

  test("without approval rights for the gate there are no decision buttons", async ({ page }) => {
    await stubDocs(page);
    await page.goto("/dev/decisions?phone=1&can=A");
    await page.getByRole("button", { name: /Waiting/ }).click();
    await page.locator(".phone-card", { hasText: "New checkout flow" }).click();
    await expect(page.getByText(/do not have approval rights for gate B/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Go", exact: true })).toHaveCount(0);
  });

  test("the review screen passes the accessibility check", async ({ page }) => {
    await stubDocs(page);
    await page.goto("/dev/decisions?phone=1");
    await page.locator(".phone-card", { hasText: "New checkout flow" }).click();
    await page.getByText("We will build the new checkout").waitFor();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });
});

test.describe("leadership and reports on a phone", () => {
  test("leadership: two tile columns, top items as cards, no sideways scroll, accessible", async ({ page }) => {
    await page.goto("/dev/leadership?n=40");
    await page.waitForSelector(".lead-tiles");
    const tiles = await page.locator(".lead-tile").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(tiles).toBe(2);
    const first = page.locator('[data-testid="top-items"] tbody tr').first();
    expect(await first.evaluate((e) => getComputedStyle(e).display)).toBe("block");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations).toEqual([]);
  });

  test("reports: charts stack in one column without sideways scroll", async ({ page }) => {
    await page.goto("/dev/reports?n=42");
    await page.waitForSelector(".rp-card");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
