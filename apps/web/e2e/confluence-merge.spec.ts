import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Merging a document and its Confluence page when both changed (issue #721). The routes need a signed-in session, so the page's calls are faked in the browser;
// the merge rules are covered by the unit tests. This checks what the person sees and that nothing is written before Confirm.
const PAGE = "https://acme.atlassian.net/wiki/spaces/GTM/pages/42/Plan";
const DOC = { id: "d1", kind: "go_to_market", title: "GTM one-pager", status: "draft", version: 4, aiDraft: false, characters: 100, updatedAt: "2026-11-26T10:00:00Z", approvedAt: null, aiTool: null, aiModel: null, shared: false, shareUrl: null };
const CHUNKS = [
  { kind: "same", text: "# Plan\n\nIntro." },
  { kind: "ours", text: "Build it in two steps.", base: "Build it.", theirs: "Build it." },
  { kind: "conflict", base: "None known.", ours: "Risk: vendor delay.", theirs: "Risk: budget." },
  { kind: "theirs", text: "Edited in Confluence.", base: "Old.", ours: "Old." },
];

async function fake(page: Page) {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/documents?item=**", (r) => r.fulfill({ json: { confluenceAvailable: true, importRequests: [], documents: [{ ...DOC, confluence: { source: "pv", direction: "both", pageUrl: PAGE, pageTitle: "Plan", spaceKey: "GTM", syncMode: "sync", publishedVersion: 2, publishedAt: "2026-11-26T09:00:00Z", linked: true, outOfDate: true }, publishRequest: null, refreshRequest: null }] } }));
  await page.route("**/api/documents/d1/confluence", async (r) => {
    const b = r.request().postDataJSON() as Record<string, unknown>;
    posts.push(b);
    const json = b.action === "sync-state" ? { direction: "both", state: "conflict", pageVersion: 6, documentVersion: 4, publishedVersion: 2 }
      : b.action === "merge-preview" ? { merge: { chunks: CHUNKS, conflicts: 1, page: { version: 6, title: "Plan", url: PAGE }, documentVersion: 4, warnings: [], notes: ["The merged text becomes a new version of the document and is written to the page."], confirm: "tokM" } }
      : b.action === "merge" ? { done: { message: "Merged: the document is at version 5 and the page at version 7, both with the same text.", documentVersion: 5, page: { version: 7, url: PAGE } } }
      : { ok: true };
    await r.fulfill({ json });
  });
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

test("a conflict offers a merge; clashing blocks need a choice, and nothing is written before Confirm", async ({ page }) => {
  const posts = await fake(page);
  const panel = await openSpec(page);
  await panel.getByRole("button", { name: "Actions for GTM one-pager" }).click();
  await page.getByRole("menuitem", { name: "Confluence sync…" }).click();
  await expect(page.getByText("Both sides changed since they were last in step.")).toBeVisible();
  await page.getByRole("button", { name: "Merge the two texts…" }).click();
  const dialog = page.getByRole("dialog", { name: /Merge the two texts/ });
  await expect(dialog.locator("strong", { hasText: "2 changes merged on their own" })).toBeVisible();
  await expect(dialog.locator("strong", { hasText: "1 block needs your choice" })).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Confirm: save the merged text and update the page" });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByText("Risk: vendor delay.")).toBeVisible();
  await expect(dialog.getByText("Risk: budget.")).toBeVisible();
  await page.screenshot({ path: "test-results/confluence-merge.png" });
  expect((await new AxeBuilder({ page }).include("[role=dialog]").analyze()).violations).toEqual([]);
  expect(posts.map((p) => p.action)).toEqual(["sync-state", "merge-preview"]); // nothing written yet
  await dialog.getByLabel("Keep Confluence’s").check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByText("Merged: the document is at version 5 and the page at version 7")).toBeVisible();
  expect(posts.at(-1)).toEqual({ action: "merge", confirm: "tokM", choices: { 2: "theirs" } });
});
