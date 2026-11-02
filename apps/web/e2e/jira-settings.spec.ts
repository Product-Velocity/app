import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Jira connection settings (issue #67, slice A)", () => {
  test("a connected site lists its Jira projects and offers Disconnect and a second site", async ({ page }) => {
    await page.goto("/dev/jira");
    await expect(page.getByRole("heading", { name: "Jira", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acme Corp" })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const table = page.getByRole("table", { name: "Jira projects of Acme Corp" });
    await expect(table).toContainText("PLAT");
    await expect(table).toContainText("Software (team-managed)");
    await expect(table).toContainText("Product Discovery (team-managed)");
    await expect(page.getByRole("button", { name: "Disconnect Acme Corp" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect another Jira site" })).toBeEnabled();
    await page.screenshot({ path: "../../docs/screenshots/jira-connection.png", fullPage: true });
  });

  test("a sign-in that Atlassian refused says so and offers to sign in again", async ({ page }) => {
    await page.goto("/dev/jira?state=needs");
    await expect(page.locator("p[role=alert]")).toContainText("no longer accepts the saved sign-in");
    await expect(page.getByText("Sign in again needed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to Jira again" })).toBeEnabled();
  });

  test("not connected, not set up and a non-admin", async ({ page }) => {
    await page.goto("/dev/jira?state=none");
    await expect(page.getByText("Not connected yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeEnabled();
    await page.goto("/dev/jira?state=none&configured=0");
    await expect(page.locator("p[role=alert]")).toContainText("not set up for this deployment");
    await expect(page.getByRole("button", { name: "Connect Jira" })).toBeDisabled();
    await page.goto("/dev/jira?role=viewer");
    await expect(page.getByText("An admin can connect Jira.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Disconnect|Connect/ })).toHaveCount(0);
  });

  test("returning from Atlassian shows the result, and the page has no accessibility violations", async ({ page }) => {
    await page.goto("/dev/jira?status=bad-link");
    await expect(page.getByRole("status")).toContainText("no longer valid");
    for (const url of ["/dev/jira", "/dev/jira?state=needs", "/dev/jira?state=none&configured=0"]) {
      await page.goto(url);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations, url).toEqual([]);
    }
  });

  test.describe("project links (slice B)", () => {
    test("a linked project says which Jira project and issue types it uses, and offers Change and Unlink; an unlinked one asks for a Jira project", async ({ page }) => {
      await page.goto("/dev/jira");
      const linked = page.getByRole("region", { name: "Platform" });
      await expect(linked).toContainText("Linked to PLAT");
      await expect(linked).toContainText("Initiative is Epic, epic is Feature, task is Subtask");
      await expect(linked.getByRole("link", { name: "Change the Jira link of Platform" })).toBeVisible();
      await expect(linked.getByRole("button", { name: "Unlink Platform from Jira" })).toBeVisible();
      const open = page.getByRole("region", { name: "Growth" });
      await expect(open.getByLabel("Jira project for Growth")).toBeVisible();
      await expect(open.getByRole("option", { name: "GROW · Growth" })).toBeAttached();
    });

    test("step 2 offers that Jira project's own issue types with the proposal selected", async ({ page }) => {
      await page.goto("/dev/jira?step=types");
      const open = page.getByRole("region", { name: "Growth" });
      await expect(open.getByLabel("An initiative is the Jira issue type")).toHaveValue("10001");
      await expect(open.getByLabel("An epic is (optional)")).toHaveValue("10002");
      await expect(open.getByLabel("A task is (optional)")).toHaveValue("10004");
      await expect(open.getByRole("button", { name: "Link Growth to GROW" })).toBeVisible();
      await page.screenshot({ path: "../../docs/screenshots/jira-project-link.png", fullPage: true });
    });

    test("Change shows the Jira project choice again with a Cancel; a viewer sees the links but no controls", async ({ page }) => {
      await page.goto("/dev/jira?step=change");
      await expect(page.getByRole("region", { name: "Platform" }).getByLabel("Jira project for Platform")).toBeVisible();
      await expect(page.getByRole("region", { name: "Platform" }).getByRole("link", { name: "Cancel" })).toBeVisible();
      await page.goto("/dev/jira?role=viewer");
      await expect(page.getByRole("region", { name: "Platform" })).toContainText("Linked to PLAT");
      await expect(page.getByRole("region", { name: "Growth" })).toContainText("Not linked to Jira");
      await expect(page.getByRole("button", { name: /Unlink|Link Growth/ })).toHaveCount(0);
    });

    test("every step has no accessibility violations", async ({ page }) => {
      for (const url of ["/dev/jira", "/dev/jira?step=types", "/dev/jira?step=change", "/dev/jira?role=viewer", "/dev/jira?read=failed", "/dev/jira?read=none"]) {
        await page.goto(url);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`), url).toEqual([]);
      }
    });

    test("reading Jira (slice C1): last read, counts, a failed read and the Read button", async ({ page }) => {
      await page.goto("/dev/jira");
      const linked = page.getByRole("region", { name: "Platform" });
      await expect(linked).toContainText("Last read");
      await expect(linked).toContainText("42 open issues (3 new, 1 changed)");
      await expect(linked).toContainText("40 not pulled in, 1 pulled in, 1 ignored. Nothing is in the roadmap until it is pulled in.");
      await expect(linked.getByRole("button", { name: "Read Jira now for Platform" })).toBeVisible();
      await page.goto("/dev/jira?read=truncated");
      await expect(page.getByRole("region", { name: "Platform" })).toContainText("only the newest were read");
      await page.goto("/dev/jira?read=failed");
      await expect(page.getByRole("region", { name: "Platform" })).toContainText("failed: Sign in to Jira again.");
      await page.goto("/dev/jira?read=none");
      await expect(page.getByRole("region", { name: "Platform" })).toContainText("Not read yet.");
      await page.goto("/dev/jira?role=viewer");
      await expect(page.getByRole("region", { name: "Platform" })).toContainText("42 open issues");
      await expect(page.getByRole("button", { name: /Read Jira/ })).toHaveCount(0);
    });
  });
});
