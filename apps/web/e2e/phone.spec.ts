import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("initiatives on a phone", () => {
  test("search, quick filters, grouping and collapse", async ({ page }) => {
    await page.goto("/dev/phone?n=40");
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
