import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// GitHub's field configuration (decision 2026-11-03-tracker-field-config): the same table and catalog as Jira, shown on a harness page because the real
// page needs a GitHub connection.
test.describe("GitHub field configuration", () => {
  test("the default list with the board's fields, the switches, and the catalog of what GitHub shows", async ({ page }) => {
    await page.goto("/dev/field-config");
    const form = page.getByRole("form", { name: "Field configuration of Platform" });
    await expect(form.getByLabel("Send MoSCoW: Label pv:moscow/<value>")).toBeChecked();
    await expect(form.getByLabel("Send G2M Date (est): Milestone “YYYY Qn” (the quarter of the G2M date)")).toBeChecked();
    await expect(form.getByLabel("Send Change Type: Organisation issue type (Feature, Improvement or Bug), when the organisation has it")).toBeChecked();
    // board fields are saved by the Project boards card; this list shows what is chosen there
    await expect(form.getByRole("row", { name: /MoSCoW.*Priority \(P0, P1, P2\)/ })).toContainText("Uses the board field “Priority”");
    await expect(form.getByRole("row", { name: /Initiative Group.*Initiative, Group or Theme/ })).toContainText("No board field is chosen");
    await expect(form.getByRole("button", { name: "Save field configuration of Platform" })).toBeVisible();
    const rest = page.locator("details", { hasText: "Other fields" });
    await rest.locator("summary").click();
    await expect(rest.getByRole("row", { name: /Customers Requesting.*Never synced/ })).toBeVisible();
    await expect(rest.getByRole("row", { name: /Open PRs.*GitHub to Product Velocity, read only/ })).toBeVisible();
    await expect(rest.getByRole("row", { name: /Initiative Description|Description.*Both ways/ }).first()).toBeVisible();
    const catalog = page.getByRole("region", { name: "GitHub organisation Acme" });
    await expect(catalog.getByRole("table", { name: "GitHub Organisation issue fields" })).toContainText("Urgent, High, Medium, Low");
    await catalog.locator("summary", { hasText: "Project board: Roadmap" }).click();
    await expect(catalog.getByRole("table", { name: "GitHub Project board: Roadmap" })).toContainText("Due date");
    await page.screenshot({ path: "../../docs/screenshots/field-config-github.png", fullPage: true });
  });
  test("changed settings, no board, a denied permission and an unreadable board say so", async ({ page }) => {
    await page.goto("/dev/field-config?config=changed&board=none&fields=denied");
    const form = page.getByRole("form", { name: "Field configuration of Platform" });
    await expect(form.getByLabel("Send Stack Rank: Label pv:rank/<band> (top 10, 25, 50, later; never the number)")).not.toBeChecked();
    await expect(form.getByRole("button", { name: /Reset Stack Rank/ })).toBeVisible();
    await expect(form.getByRole("row", { name: /MoSCoW.*Priority/ })).toContainText("No board is linked to this project.");
    await expect(page.getByText("Add the organisation permission “Issue fields”")).toBeVisible();
    await page.goto("/dev/field-config?board=unreadable");
    await page.locator("summary", { hasText: "Project board: Roadmap" }).click();
    await expect(page.getByText("This board could not be read just now.")).toBeVisible();
  });
  test("no accessibility violations", async ({ page }) => {
    for (const url of ["/dev/field-config", "/dev/field-config?config=changed&board=none&fields=denied", "/dev/field-config?board=unreadable"]) {
      await page.goto(url);
      await page.locator("details > summary").evaluateAll((els) => els.forEach((e) => ((e.parentElement as HTMLDetailsElement).open = true)));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`), url).toEqual([]);
    }
  });
});

// The tracker's own field list (decision 2026-11-11-tracker-field-table): search, filter, sort, and the Product Velocity field and direction of each field.
test.describe("Jira field table", () => {
  test("shows the linked field and direction, and searches, filters and sorts", async ({ page }) => {
    await page.goto("/dev/jira");
    const table = page.getByRole("table", { name: "Jira Issue fields" });
    const row = (name: string) => table.getByRole("row", { name: new RegExp(`^${name} `) });
    await expect(row("Due date")).toContainText("Product Velocity to Jira");
    await expect(row("Summary")).toContainText("Both ways");
    await expect(row("Status")).toContainText("Jira to Product Velocity (read only)");
    await expect(row("Story point estimate")).toContainText("Not linked: ignored by Sync");
    await expect(row("Story point estimate")).toContainText("Not synced");
    // search
    await page.getByRole("search", { name: /Jira Issue fields/ }).getByLabel("Search").fill("story");
    await expect(table.getByRole("row")).toHaveCount(3); // header and the two story point fields
    await expect(page.getByRole("status").filter({ hasText: "Showing 2 of" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    // filter: only fields Sync uses
    await page.getByRole("search", { name: /Jira Issue fields/ }).getByLabel("Sync").selectOption("used");
    await expect(row("Story Points")).toHaveCount(0);
    await expect(row("Due date")).toBeVisible();
    // sort by name: ascending then descending
    const sortBtn = table.getByRole("button", { name: "Name" });
    await sortBtn.click();
    await expect(table.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    await sortBtn.click();
    await expect(table.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "descending");
    await page.screenshot({ path: "../../docs/screenshots/field-table-jira.png", fullPage: true });
  });
  test("no accessibility violations", async ({ page }) => {
    await page.goto("/dev/jira");
    await page.getByRole("search", { name: /Jira Issue fields/ }).getByLabel("Search").fill("zzz");
    await expect(page.getByText("No field matches.")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
  });
});
