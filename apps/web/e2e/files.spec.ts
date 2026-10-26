import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The file routes need a signed-in Supabase session, so these tests stand in for them with an in-page fake server
// and check what the person sees. The server rules are covered by unit and database tests.
type F = { id: string; name: string; mime: string; size: number; shareUrl: string | null };

async function fakeFiles(page: Page, start: F[] = []) {
  const files = [...start];
  await page.route("**/api/files**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const m = url.pathname.match(/^\/api\/files\/([^/]+)(\/share)?$/);
    if (!m && req.method() === "GET") return json({ files });
    if (!m && req.method() === "POST") {
      const body = req.postDataBuffer()?.toString("latin1") ?? "";
      if (body.includes('filename="bad.svg"')) return json({ error: "Only PNG, JPEG, GIF, WebP and PDF files can be attached." }, 422);
      files.push({ id: `f${files.length + 1}`, name: "mockup.png", mime: "image/png", size: 2048, shareUrl: null });
      return json({ file: files.at(-1) }, 201);
    }
    const f = files.find((x) => x.id === m![1]);
    if (!f) return json({ error: "File not found." }, 404);
    if (m![2]) {
      const on = (JSON.parse(req.postData() ?? "{}") as { on: boolean }).on;
      f.shareUrl = on ? `http://localhost/f/${"T".repeat(43)}/${f.name}` : null;
      return json({ shareUrl: f.shareUrl });
    }
    files.splice(files.indexOf(f), 1);
    return json({ ok: true });
  });
}
const openPanel = async (page: Page, role = "admin") => {
  await page.goto(`/dev/grid?n=12&role=${role}`);
  await page.waitForSelector(".ag-row");
  await page.locator('.ag-row[row-id="item-3"] [col-id="item_code"]').click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("item-panel")).toBeVisible();
  return page.getByTestId("item-panel").locator('[data-field="screenshots"]');
};

test.describe("Files on an initiative", () => {
  test("attach, share with a login-free link, turn the link off, remove", async ({ page }) => {
    await fakeFiles(page);
    const field = await openPanel(page);
    await expect(field.getByText("No files yet.")).toBeVisible();
    await field.locator('input[type="file"]').setInputFiles({ name: "mockup.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) });
    const row = field.locator('[data-file="mockup.png"]');
    await expect(row.getByRole("link", { name: "mockup.png" })).toHaveAttribute("target", "_blank");
    await row.getByRole("button", { name: "Create link for mockup.png" }).click();
    await expect(field.getByLabel("Share link for mockup.png")).toHaveValue(new RegExp(`/f/T{43}/mockup.png$`));
    await page.screenshot({ path: "../../docs/screenshots/files-share-link.png" });
    const r = await new AxeBuilder({ page }).include('[data-field="screenshots"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((x) => x.id)).toEqual([]);
    await row.getByRole("button", { name: "Turn off link for mockup.png" }).click();
    await expect(field.getByLabel("Share link for mockup.png")).toHaveCount(0);
    await row.getByRole("button", { name: "Remove mockup.png" }).click();
    await expect(field.getByText("No files yet.")).toBeVisible();
  });

  test("a refused file explains why", async ({ page }) => {
    await fakeFiles(page);
    const field = await openPanel(page);
    await field.locator('input[type="file"]').setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(field.getByRole("alert")).toHaveText("Only PNG, JPEG, GIF, WebP and PDF files can be attached.");
  });

  test("a viewer sees the files and links but cannot attach, share or remove", async ({ page }) => {
    await fakeFiles(page, [{ id: "f1", name: "spec.pdf", mime: "application/pdf", size: 5000, shareUrl: null }]);
    const field = await openPanel(page, "viewer");
    await expect(field.getByRole("link", { name: "spec.pdf" })).toBeVisible();
    await expect(field.getByRole("button")).toHaveCount(0);
    await expect(field.locator('input[type="file"]')).toHaveCount(0);
  });
});
