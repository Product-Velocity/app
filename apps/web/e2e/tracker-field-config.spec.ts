import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The field mapping, one table per project (decision 2026-11-16-tracker-settings-sections): GitHub on a harness page because the real page needs a GitHub connection.
test.describe("GitHub field mapping", () => {
  test("the default list with the board's fields, the switches, the filters and the fields GitHub shows that nothing uses", async ({ page }) => {
    await page.goto("/dev/field-config");
    const form = page.getByRole("form", { name: "Field configuration of Platform" });
    await expect(form.getByLabel("Send MoSCoW: Label pv:moscow/<value>")).toBeChecked();
    await expect(form.getByLabel("Send G2M Date (est): Milestone “YYYY Qn” (the quarter of the G2M date)")).toBeChecked();
    await expect(form.getByLabel("Send Change Type: Organisation issue type (Feature, Improvement or Bug), when the organisation has it")).toBeChecked();
    // board fields are saved by the Project boards card; this list shows what is chosen there
    await page.getByRole("button", { name: /^Can change/ }).click();
    await expect(form.getByRole("row", { name: /MoSCoW.*Priority \(P0, P1, P2\)/ })).toContainText("Uses the board field “Priority”");
    await expect(form.getByRole("row", { name: /Initiative Group.*Initiative, Group or Theme/ })).toContainText("No board field is chosen");
    await expect(form.getByRole("button", { name: "Save field configuration of Platform" })).toBeVisible();
    await page.getByRole("button", { name: /^Never synced/ }).click();
    await expect(form.getByRole("row", { name: /Customers Requesting.*Never synced/ })).toBeVisible();
    await page.getByRole("button", { name: /^Read only/ }).click();
    await expect(form.getByRole("row", { name: /Open PRs.*GitHub to Product Velocity, read only/ })).toBeVisible();
    await page.getByRole("button", { name: /^GitHub fields not linked/ }).click();
    await expect(form.getByRole("row", { name: /Urgent, High, Medium, Low/ }).first()).toContainText("Ignored by Sync");
    await page.screenshot({ path: "../../docs/screenshots/field-config-github.png", fullPage: true });
  });
  test("changed settings, no board, a denied permission and an unreadable board say so", async ({ page }) => {
    await page.goto("/dev/field-config?config=changed&board=none&fields=denied");
    const form = page.getByRole("form", { name: "Field configuration of Platform" });
    await expect(form.getByLabel("Send Stack Rank: Label pv:rank/<band> (top 10, 25, 50, later; never the number)")).not.toBeChecked();
    await page.getByRole("button", { name: /^Can change/ }).click();
    await expect(form.getByRole("button", { name: /Reset Stack Rank/ })).toBeVisible();
    await expect(form.getByRole("row", { name: /MoSCoW.*Priority/ })).toContainText("No board is linked to this project.");
    await page.getByRole("button", { name: /^GitHub fields not linked/ }).click();
    await expect(page.getByText("Add the organisation permission “Issue fields”")).toBeVisible();
    await page.goto("/dev/field-config?board=unreadable");
    await page.getByRole("button", { name: /^GitHub fields not linked/ }).click();
    await expect(page.getByText("This board could not be read just now.")).toBeVisible();
  });
  test("no accessibility violations", async ({ page }) => {
    for (const url of ["/dev/field-config", "/dev/field-config?config=changed&board=none&fields=denied", "/dev/field-config?board=unreadable"]) {
      await page.goto(url);
      await page.getByRole("button", { name: /^All/ }).click();
      await page.locator("details > summary").evaluateAll((els) => els.forEach((e) => ((e.parentElement as HTMLDetailsElement).open = true)));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`), url).toEqual([]);
    }
  });
});

test.describe("Jira field mapping table", () => {
  test("shows only what Sync moves at first, and the unlinked Jira fields on request, with search and Show more", async ({ page }) => {
    await page.goto("/dev/jira/mapping");
    const form = page.getByRole("form", { name: "Field configuration of Platform" });
    await expect(page.getByRole("status").filter({ hasText: /The fields Sync moves between Product Velocity and Jira/ })).toBeVisible();
    await expect(form.getByRole("row", { name: /Initiative Name.*Both ways.*Summary/ })).toBeVisible();
    await page.getByRole("button", { name: /^Jira fields not linked/ }).click();
    await page.getByLabel("Search", { exact: true }).fill("story point");
    await expect(form.getByRole("row", { name: /Story point estimate/ })).toBeVisible();
    await expect(form.getByRole("row", { name: /Initiative Name/ })).toHaveCount(0);
    await page.getByLabel("Search", { exact: true }).fill("");
    await page.getByLabel("Search", { exact: true }).fill("zzz");
    await expect(page.getByText("No field matches.")).toBeVisible();
    await page.getByLabel("Search", { exact: true }).fill("");
    await page.getByLabel("Search", { exact: true }).fill("");
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(form.getByRole("row", { name: /Initiative Name/ })).toBeVisible();
    await page.getByLabel("Search", { exact: true }).fill("story point");
    await expect(form.getByRole("row", { name: /Story point estimate/ })).toBeVisible();
    await page.screenshot({ path: "../../docs/screenshots/field-table-jira.png", fullPage: true });
  });
  test("no accessibility violations", async ({ page }) => {
    await page.goto("/dev/jira/mapping");
    await page.getByLabel("Search", { exact: true }).fill("zzz");
    await expect(page.getByText("No field matches.")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  });
});
