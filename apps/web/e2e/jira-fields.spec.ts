import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The Fields section of a linked Jira project (issues #69, #70): the catalog of the site's fields next to the mapping. Fictional data from /dev/jira.
test.describe("Jira fields and mapping", () => {
  test("lists the site's fields with the mapped one first, and says unmapped fields are ignored", async ({ page }) => {
    await page.goto("/dev/jira?fields=read");
    const region = page.getByRole("region", { name: "Platform" });
    await expect(region.getByText("Fields of PLAT (14 fields, 1 mapped)")).toBeVisible();
    const table = region.getByRole("table", { name: /Jira fields of PLAT/ });
    await expect(table).toBeVisible();
    const first = table.getByRole("row").nth(1);
    await expect(first).toContainText("Start date");
    await expect(first).toContainText("customfield_10015");
    await expect(first).toContainText("Planned Start (read only)");
    await expect(first).toContainText("1 of 2");
    // two fields with the same name are two rows, told apart by their id
    await expect(table.getByRole("row", { name: /Vulnerability/ })).toHaveCount(2);
    await expect(table.locator("code", { hasText: "customfield_10100" })).toBeVisible();
    await expect(table.locator("code", { hasText: "customfield_10101" })).toBeVisible();
    await expect(table.getByRole("row", { name: /Impact/ })).toContainText("Not mappable: Product Velocity cannot read this kind of value yet.");
    await expect(table.getByRole("row", { name: /Story point estimate/ })).toContainText("Not mapped: ignored");
    await page.screenshot({ path: "../../docs/screenshots/jira-fields.png", fullPage: true });
  });

  test("only valid choices are offered, a suggestion is not applied, and a status can never be mapped", async ({ page }) => {
    await page.goto("/dev/jira?fields=read");
    const table = page.getByRole("table", { name: /Jira fields of PLAT/ });
    const team = table.getByRole("row", { name: /Team/ });
    await expect(team).toContainText("Suggestion: Contributing Teams (read only). Not applied until you choose it.");
    const choice = team.getByLabel("Map Team (customfield_10001) to");
    await expect(choice).toHaveValue("");
    await expect(choice.locator("option")).toHaveText(["Not mapped (ignored)", "Contributing Teams (read only)"]);
    const date = table.getByRole("row", { name: /Start date/ }).getByLabel("Map Start date (customfield_10015) to");
    await expect(date).toHaveValue("planned_start:read");
    await expect(date.locator("option")).toHaveText(["Not mapped (ignored)", "Planned Start (read only)", "Planned Start (two-way)", "G2M Date (est) (read only)", "G2M Date (est) (two-way)"]);
    const status = table.getByRole("row", { name: /^Status/ });
    await expect(status).toContainText("Not mappable: A Jira status, resolution or computed field is never mapped.");
    await expect(status.getByRole("button")).toHaveCount(0);
    // nothing commercial is ever offered
    const all = await table.locator("select option").allTextContents();
    for (const word of ["Value", "Confidence", "Customers", "Decision", "Stack Rank", "Key Result", "Build Status", "Initiative Status"]) expect(all.join("|"), word).not.toContain(word);
  });

  test("not read yet, a failed read and an old list", async ({ page }) => {
    await page.goto("/dev/jira?fields=never&open=1");
    const region = page.getByRole("region", { name: "Platform" });
    await expect(region.getByText("The fields have not been read yet.")).toBeVisible();
    await expect(region.getByRole("button", { name: "Read the fields of PLAT from Jira" })).toBeEnabled();
    await page.goto("/dev/jira?fields=failed&open=1");
    await expect(page.getByRole("alert").filter({ hasText: "The last read of the fields failed: Jira answered 503" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh the list of fields of PLAT from Jira" })).toBeEnabled();
    await page.goto("/dev/jira?fields=old&open=1");
    await expect(page.getByText(/more than 7 days old/)).toBeVisible();
  });

  test("members do not see the Fields section", async ({ page }) => {
    await page.goto("/dev/jira?fields=read&role=viewer");
    await expect(page.getByText(/Fields of PLAT/)).toHaveCount(0);
    await expect(page.getByRole("table", { name: /Jira fields of PLAT/ })).toHaveCount(0);
  });

  test("notices for a refused or saved mapping, and no accessibility violations", async ({ page }) => {
    for (const [status, text] of [["map-saved", "Nothing is written to Jira"], ["map-commercial", "can never be mapped"], ["map-tracker_driven", "comes from the tracker"], ["map-incompatible", "kinds do not match"], ["map-taken", "already mapped"]]) {
      await page.goto(`/dev/jira?fields=read&open=1&status=${status}`);
      await expect(page.getByRole("status")).toContainText(text!);
    }
    await page.goto("/dev/jira?fields=read&open=1");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
