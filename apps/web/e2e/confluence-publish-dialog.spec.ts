import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The Publish to Confluence dialog (issues #693, #718, #722): one search box for the space, a search over the page tree, a path under it. The Confluence calls are faked.
const SPACES = [
  { key: "PRD", name: "Product", type: "global" }, { key: "GTM", name: "Go to market", type: "global" }, { key: "ENG", name: "Engineering", type: "global" },
  { key: "PM", name: "Product Management", type: "global" },
];
const TREE: Record<string, { id: string; title: string; kind: "page" | "folder" }[]> = {
  "space=PRD": [{ id: "1", title: "Product Home", kind: "page" }],
  "parent=1": [{ id: "2", title: "Procedures", kind: "folder" }, { id: "3", title: "Product Roadmap", kind: "folder" }],
  "parent=2&kind=folder": [{ id: "4", title: "Product Ideas Procedure", kind: "page" }],
  "parent=3&kind=folder": [{ id: "5", title: "[2026][Q4]", kind: "folder" }],
  "parent=5&kind=folder": [{ id: "6", title: "R89 Bidder adapter", kind: "folder" }, { id: "7", title: "[Development Done | RollOut WIP] R89-SPEC-032 — Publisher Dashboard Session Metrics (Phase 1)", kind: "page" }],
  "parent=6&kind=folder": [{ id: "8", title: "Bidder adapter spec", kind: "page" }],
  "parent=4": [], "parent=7": [], "parent=8": [],
};

const open = async (page: Page) => {
  await page.route("**/api/documents/d1/confluence?spaces=1", (r) => r.fulfill({ json: { canPublish: true, available: true, site: { name: "refinery89", url: "https://r89.atlassian.net" }, last: null, spaces: SPACES, suggestedTitle: "Go-to-market - R-102" } }));
  await page.route("**/api/documents/d1/confluence/pages?**", (r) => {
    const q = new URL(r.request().url()).searchParams;
    const key = q.get("space") ? `space=${q.get("space")}` : `parent=${q.get("parent")}${q.get("kind") ? `&kind=${q.get("kind")}` : ""}`;
    return r.fulfill({ json: { pages: TREE[key] ?? [] } });
  });
  await page.addInitScript(() => { try { if (!window.sessionStorage.getItem("seen")) { window.sessionStorage.setItem("seen", "1"); window.localStorage.removeItem("pv.confluence.lastSpace"); } } catch { /* none */ } });
  await page.goto("/dev/confluence");
};

test.describe("Publish to Confluence", () => {
  test("one box finds the space; arrow keys and Enter pick it", async ({ page }) => {
    await open(page);
    const box = page.getByRole("combobox", { name: "Space" });
    await expect(box).toHaveValue("Product (PRD)"); // no choice made before: the first space of the list
    await box.fill("prod");
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("Product Management (PM)");
    await box.fill("go to");
    await page.getByRole("option", { name: /^Go to market/ }).click();
    await expect(box).toHaveValue("Go to market (GTM)");
    await expect(page.getByRole("tree")).toBeVisible();
  });

  test("remembers the last space, and says when nothing matches", async ({ page }) => {
    await open(page);
    const box = page.getByRole("combobox", { name: "Space" });
    await box.fill("eng");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("Engineering (ENG)");
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Space" })).toHaveValue("Engineering (ENG)");
    await page.getByRole("combobox", { name: "Space" }).fill("zzz");
    await expect(page.getByText("No space matches")).toBeVisible();
  });

  test("a search finds a folder that was never opened, opens the way to it and shows the path", async ({ page }) => {
    await open(page);
    await page.getByRole("combobox", { name: "Space" }).fill("product");
    await page.getByRole("option", { name: /^Product \(PRD\)/ }).click();
    await expect(page.getByText("Product Home").first()).toBeVisible();
    await page.getByRole("searchbox", { name: "Search the pages and folders of this space" }).fill("bidder adapter");
    await expect(page.getByText("Searched every folder and page in the space.")).toBeVisible();
    await expect(page.locator(".page-tree-pick", { hasText: "R89 Bidder adapter" })).toBeVisible();
    await expect(page.locator(".page-tree-pick", { hasText: "Product Ideas Procedure" })).toHaveCount(0);
    await page.locator(".page-tree-pick", { hasText: "R89 Bidder adapter" }).click();
    await expect(page.locator(".page-tree-path")).toContainText("Product › Product Home › Product Roadmap › [2026][Q4] › R89 Bidder adapter");
    await page.screenshot({ path: "test-results/confluence-publish-dialog-search.png" });
    await page.getByRole("searchbox", { name: "Search the pages and folders of this space" }).fill("nothing like it");
    await expect(page.getByText("Nothing found for")).toBeVisible();
  });

  test("the path shows for the top of the space, and the dialog has no accessibility violations", async ({ page }) => {
    await open(page);
    await page.getByRole("combobox", { name: "Space" }).fill("product");
    await page.getByRole("option", { name: /^Product \(PRD\)/ }).click();
    await expect(page.locator(".page-tree-path")).toContainText("Goes in: Product (top of the space)");
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
});
