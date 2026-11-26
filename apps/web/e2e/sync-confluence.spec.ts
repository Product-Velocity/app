import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// "To send" for Confluence in the Sync dialog (issue #693): documents kept in sync that are ahead of their page are listed in step 2, each with its own preview and
// confirmation. The Confluence calls are mocked in the browser; nothing is sent anywhere.
const DOC = { id: "d1", itemId: "i1", code: "R-1", itemName: "Ticketing", title: "PRD", version: 3, publishedVersion: 2, pageTitle: "PRD - Ticketing", pageUrl: "https://acme.atlassian.net/wiki/spaces/X/pages/5", spaceKey: "X" };

const open = async (page: Page, preview: Record<string, unknown>) => {
  const posts: unknown[] = [];
  await page.route("**/api/confluence/to-send**", (r) => r.fulfill({ json: { available: true, documents: [DOC] } }));
  await page.route("**/api/documents/d1/confluence", async (r) => {
    const body = r.request().postDataJSON() as { action: string };
    posts.push(body);
    await r.fulfill({ json: body.action === "preview" ? { preview } : { done: { action: "update", page: { url: DOC.pageUrl, version: 4 }, message: "The page was updated." } } });
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
