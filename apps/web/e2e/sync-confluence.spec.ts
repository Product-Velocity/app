import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// "To send" for Confluence in the Sync dialog (issue #693): documents kept in sync that are ahead of their page are listed in step 2, each with its own preview and
// confirmation. The Confluence calls are mocked in the browser; nothing is sent anywhere.
const DOC = { id: "d1", itemId: "i1", code: "R-1", itemName: "Ticketing", title: "PRD", version: 3, publishedVersion: 2, pageTitle: "PRD - Ticketing", pageUrl: "https://acme.atlassian.net/wiki/spaces/X/pages/5", spaceKey: "X", direction: "to_confluence", state: "send", pageVersion: null };

const open = async (page: Page, preview: Record<string, unknown>, doc: Record<string, unknown> = DOC, refresh?: Record<string, unknown>) => {
  const posts: unknown[] = [];
  await page.route("**/api/confluence/to-send**", (r) => r.fulfill({ json: { available: true, documents: [doc] } }));
  await page.route("**/api/documents/d1/confluence", async (r) => {
    const body = r.request().postDataJSON() as { action: string };
    posts.push(body);
    await r.fulfill({ json: body.action === "preview" ? { preview } : body.action === "refresh-preview" ? { refresh } : body.action === "refresh" ? { done: { action: "update", message: "The document was updated from page version 6." } } : { done: { action: "update", page: { url: DOC.pageUrl, version: 4 }, message: "The page was updated." } } });
  });
  await page.goto("/dev/sync?scenario=ok");
  await page.getByRole("button", { name: "Open sync" }).click();
  await expect(page.getByRole("button", { name: "Apply and send" })).toBeEnabled();
  return posts;
};

test.describe("Sync: Confluence pages to update", () => {
  test("lists the page, previews, and writes only after Confirm", async ({ page }) => {
    const posts = await open(page, { action: "update", why: "newer", title: "PRD - Ticketing", warnings: [{ kind: "value", what: "the business value" }], notes: ["The page is replaced."], confirm: "tok1" });
    const section = page.getByRole("region", { name: "Confluence pages to update" });
    await expect(section.getByRole("heading", { name: "Confluence pages to update (1)" })).toBeVisible();
    await expect(section.getByText("the page holds version 2, the document is at version 3")).toBeVisible();
    await section.getByRole("button", { name: "Preview the update" }).click();
    await expect(section.getByText("The page will be updated")).toBeVisible();
    await expect(section.getByText("This text may be commercial.")).toBeVisible();
    expect(posts).toEqual([{ action: "preview", mode: "sync" }]); // nothing written yet
    await page.screenshot({ path: "test-results/sync-confluence-preview.png" });
    expect((await new AxeBuilder({ page }).include("[role=dialog]").analyze()).violations).toEqual([]);
    await section.getByRole("button", { name: "Confirm: update the page" }).click();
    await expect(section.getByText("The page was updated.")).toBeVisible();
    expect(posts).toEqual([{ action: "preview", mode: "sync" }, { action: "publish", mode: "sync", confirm: "tok1" }]);
    await expect(section.getByRole("heading", { name: "Confluence pages to update (0)" })).toBeVisible();
  });

  test("a page changed in Confluence is not overwritten from here", async ({ page }) => {
    await open(page, { action: "conflict", why: "somebody saved the page", title: "PRD", warnings: [], notes: [], confirm: "tok2" });
    const section = page.getByRole("region", { name: "Confluence pages to update" });
    await section.getByRole("button", { name: "Preview the update" }).click();
    await expect(section.getByText("The page was changed in Confluence")).toBeVisible();
    await expect(section.getByRole("button", { name: /Confirm/ })).toHaveCount(0);
  });
});

test.describe("Sync: Confluence pages that changed (to receive, conflict)", () => {
  const RECEIVE = { ...DOC, direction: "both", state: "receive", pageVersion: 6, publishedVersion: 3, version: 3 };
  test("a page that is newer is previewed, and the document changes only after Confirm", async ({ page }) => {
    const posts = await open(page, {}, RECEIVE, { action: "update", why: "newer", localEdits: false, excerpt: "# PRD\n\nChanged in Confluence.", truncated: false, lost: [], notes: [], confirm: "tokR" });
    const section = page.getByRole("region", { name: "Confluence pages to update" });
    await expect(section.getByText("To receive")).toBeVisible();
    await expect(section.getByText("the page is at version 6")).toBeVisible();
    await section.getByRole("button", { name: "Preview what comes in" }).click();
    await expect(section.getByText("The document will be updated from the page")).toBeVisible();
    await expect(section.getByText("Changed in Confluence.")).toBeVisible();
    expect(posts).toEqual([{ action: "refresh-preview", mode: "sync" }]);
    await page.screenshot({ path: "test-results/sync-confluence-receive.png" });
    expect((await new AxeBuilder({ page }).include("[role=dialog]").analyze()).violations).toEqual([]);
    await section.getByRole("button", { name: "Confirm: update the document" }).click();
    await expect(section.getByText("The document was updated from page version 6.")).toBeVisible();
    expect(posts).toEqual([{ action: "refresh-preview", mode: "sync" }, { action: "refresh", mode: "sync", confirm: "tokR" }]);
  });
  test("a conflict is not settled in the Sync dialog: it points to the document menu and offers no confirm", async ({ page }) => {
    await open(page, {}, { ...DOC, direction: "both", state: "conflict", pageVersion: 6 });
    const section = page.getByRole("region", { name: "Confluence pages to update" });
    await expect(section.getByText("Conflict")).toBeVisible();
    await expect(section.getByText("Both sides changed, so you choose which to keep.")).toBeVisible();
    await expect(section.getByRole("button")).toHaveCount(0);
  });
});

test.describe("Sync: the check does not start over when the page renders again", () => {
  test("a caller that builds the list of ids anew on every render still gets one check, which completes", async ({ page }) => {
    await page.goto("/dev/sync?scenario=rerender");
    await page.getByRole("button", { name: "Open sync" }).click();
    await expect(page.getByRole("button", { name: "Apply and send" })).toBeEnabled({ timeout: 10_000 });
    await page.waitForTimeout(600); // several more renders of the page
    expect(Number(await page.getByTestId("starts").textContent())).toBe(1); // one check (three initiatives fit in one call), never one per render
  });
});
