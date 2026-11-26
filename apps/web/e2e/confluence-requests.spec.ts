import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Claude asks to import a Confluence page, or to update a document from its page (issue #721). The routes need a signed-in session, so the page's calls are faked
// in the browser; the rules (a request reads and changes nothing, a person confirms) are covered by the unit and database tests.
const PAGE = "https://acme.atlassian.net/wiki/spaces/GTM/pages/42/Plan";
const DOC = { id: "d1", kind: "go_to_market", title: "GTM one-pager", status: "draft", version: 2, aiDraft: false, characters: 100, updatedAt: "2026-11-26T10:00:00Z", approvedAt: null, aiTool: null, aiModel: null, shared: false, shareUrl: null };

async function fake(page: Page, over: { importRequests?: unknown[]; refreshRequest?: unknown } = {}) {
  const posts: unknown[] = [];
  let importRequests = over.importRequests ?? [];
  let refreshRequest = over.refreshRequest ?? null;
  await page.route("**/api/documents?item=**", (r) => r.fulfill({ json: { confluenceAvailable: true, importRequests, documents: [{ ...DOC, confluence: { source: "external", direction: "from_confluence", pageUrl: PAGE, pageTitle: "Plan", spaceKey: "GTM", syncMode: "sync", publishedVersion: 1, publishedAt: "2026-11-26T09:00:00Z", linked: true, outOfDate: false }, publishRequest: null, refreshRequest }] } }));
  await page.route("**/api/documents/import-confluence", async (r) => { const b = r.request().postDataJSON(); posts.push(b); if (b.action === "dismiss") importRequests = []; await r.fulfill({ json: { ok: true } }); });
  await page.route("**/api/documents/d1/confluence", async (r) => { const b = r.request().postDataJSON(); posts.push(b); if (b.action === "dismiss-refresh") refreshRequest = null; await r.fulfill({ json: b.action === "refresh-preview" ? { refresh: { action: "update", why: "newer", localEdits: false, excerpt: "# GTM\n\nNew.", truncated: false, lost: [], notes: [], confirm: "t" } } : { ok: true } }); });
  await page.route("**/api/files**", (r) => r.fulfill({ json: { files: [] } }));
  return posts;
}
const openSpec = async (page: Page) => {
  await page.goto("/dev/grid?n=12&role=admin");
  await page.waitForSelector(".ag-row");
  await page.locator('.ag-row[row-id="item-3"] [col-id="item_code"]').click({ position: { x: 8, y: 8 } });
  const panel = page.getByTestId("item-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Spec" }).click();
  return panel;
};

test.describe("Claude's requests to read a Confluence page", () => {
  test("an import request shows who asked and why, reads nothing, and can be dismissed", async ({ page }) => {
    const posts = await fake(page, { importRequests: [{ kind: "import", pageUrl: PAGE, docKind: "go_to_market", mode: "sync", direction: "from_confluence", note: "The plan lives here", requestedBy: "Claude", aiModel: "Claude Sonnet 5.5" }] });
    const panel = await openSpec(page);
    const notice = panel.getByRole("status").filter({ hasText: "asked for a Confluence page to be imported" });
    await expect(notice).toContainText("Claude (Claude Sonnet 5.5)");
    await expect(notice).toContainText("The plan lives here");
    await expect(notice).toContainText("Nothing is read until you review the preview and confirm");
    expect(posts).toEqual([]);
    expect((await new AxeBuilder({ page }).include('[data-testid="item-panel"]').analyze()).violations).toEqual([]);
    await page.screenshot({ path: "test-results/confluence-import-request.png" });
    await notice.getByRole("button", { name: "Review…" }).click();
    await expect(page.getByRole("dialog", { name: /Read a Confluence page/ })).toBeVisible();
    await expect(page.getByLabel("Page address")).toHaveValue(PAGE);
    await page.getByRole("button", { name: "Cancel" }).click();
    await notice.getByRole("button", { name: "Dismiss the request" }).click();
    await expect(notice).toHaveCount(0);
    expect(posts).toEqual([{ action: "dismiss", item: expect.any(String), pageUrl: PAGE }]);
  });

  test("a refresh request puts a chip on the document; it opens the preview, and can be dismissed from the menu", async ({ page }) => {
    const posts = await fake(page, { refreshRequest: { kind: "refresh", pageUrl: null, docKind: null, mode: "sync", direction: "from_confluence", note: "Page changed today", requestedBy: "Claude", aiModel: null } });
    const panel = await openSpec(page);
    const chip = panel.getByRole("button", { name: "Update requested by Claude" });
    await expect(chip).toBeVisible();
    expect(posts).toEqual([]);
    await chip.click();
    await expect(page.getByText("The document will be updated from the page").or(page.getByText("newer"))).toBeVisible();
    expect(posts).toEqual([{ action: "refresh-preview" }]);
    await page.getByRole("button", { name: "Cancel" }).click();
    await panel.getByRole("button", { name: "Actions for GTM one-pager" }).click();
    await page.getByRole("menuitem", { name: "Dismiss the update request" }).click();
    await expect(chip).toHaveCount(0);
  });
});
