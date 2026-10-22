import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, query = "n=40") => {
  await page.goto(`/dev/grid?${query}`);
  await page.waitForSelector(".ag-row");
  await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined);
};
const cell = (page: Page, id: string, col: string) => page.locator(`.ag-row[row-id="${id}"] [col-id="${col}"]`);
const panel = (page: Page) => page.getByTestId("item-panel");
const title = (page: Page) => panel(page).getByRole("heading", { level: 2 });
const settle = (page: Page) => page.waitForFunction(() => (window as unknown as { __pv: { controller: { status: { pending: number } } } }).__pv.controller.status.pending === 0);
const field = (page: Page, key: string) => panel(page).locator(`[data-field="${key}"]`);
const reveal = async (page: Page, group: string) => { // sections beyond the first few start closed
  const d = panel(page).locator("details.ip-section", { has: page.getByRole("heading", { name: group, exact: true }) });
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator("summary").click();
};
const row = (page: Page, id: string) => page.evaluate((i) => (window as unknown as { __pv: { controller: { row: (id: string) => Record<string, unknown> } } }).__pv.controller.row(i), id);

test.describe("opening, closing and moving", () => {
  test("clicking the code opens the panel beside the grid; Esc closes it; clicking a name only selects the cell", async ({ page }) => {
    await open(page);
    await expect(panel(page)).toHaveCount(0);
    await cell(page, "item-3", "initiative_name").click();
    await expect(panel(page)).toHaveCount(0); // the name stays a cell to select and edit
    await cell(page, "item-3", "item_code").click();
    await expect(title(page)).toHaveText("Initiative number 3 with a reasonably long title");
    expect(page.url()).toContain("item=R-03");
    await expect(page.getByTestId("grid")).toBeVisible(); // the grid is still there beside it
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    expect(page.url()).not.toContain("item=");
    await cell(page, "item-5", "item_code").click();
    await expect(title(page)).toContainText("Initiative number 5");
    // an edit of a name in the grid still works while the panel is open
    await cell(page, "item-6", "initiative_name").click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Renamed from the grid");
    await page.keyboard.press("Enter");
    await expect(cell(page, "item-6", "initiative_name")).toHaveText("Renamed from the grid");
  });

  test("Space on the focused row opens it, J and K move without closing, the grid follows", async ({ page }) => {
    await open(page);
    await cell(page, "item-2", "stack_rank").click();
    await page.keyboard.press("Space");
    await expect(title(page)).toContainText("Initiative number 2 ");
    await page.keyboard.press("j");
    await expect(title(page)).toContainText("Initiative number 3 ");
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    await expect(title(page)).toContainText("Initiative number 3 ");
    await expect(panel(page).locator(".ip-pos")).toHaveText("3 of 40");
    expect(page.url()).toContain("item=R-03");
    await expect(page.locator(".ag-row-focus, .ag-cell-focus").first()).toBeVisible();
    for (let i = 0; i < 3; i++) await page.keyboard.press("k"); // stops at the first item
    await expect(title(page)).toContainText("Initiative number 1 ");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  });

  test("J and K follow the current view: filtered rows only", async ({ page }) => {
    await open(page, "n=40&scope=scope-b"); // Customer-facing work: project p3 only
    const first = await page.evaluate(() => (window as unknown as { __pv: { controller: { rows: { id: string; home_project: string }[] } } }).__pv.controller.rows.filter((r) => r.home_project === "p3").slice(0, 2).map((r) => r.id));
    await cell(page, first[0]!, "item_code").click();
    await page.keyboard.press("j");
    expect(page.url()).toContain(`item=R-${first[1]!.replace("item-", "").padStart(2, "0")}`);
  });

  test("typing J or K in a field does not move; the panel opens from a shared address", async ({ page }) => {
    await open(page, "n=40&item=R-07");
    await expect(title(page)).toContainText("Initiative number 7 ");
    await reveal(page, "What");
    const name = field(page, "initiative_name").getByRole("textbox");
    await name.click();
    await page.keyboard.press("j");
    await expect(title(page)).toContainText("Initiative number 7 ");
    await page.keyboard.press("Escape"); // cancels the edit, does not close
    await expect(panel(page)).toHaveCount(1);
  });
});

test.describe("fields", () => {
  test("fields are grouped like the dictionary; locked, calculated and later-phase fields say why or when", async ({ page }) => {
    await open(page, "n=40&item=R-04");
    const groups = await panel(page).locator("details.ip-section > summary h3").allTextContents();
    expect(groups.slice(0, 5)).toEqual(["What", "Who", "Why", "Decision", "When"]);
    await reveal(page, "Delivery (GitHub)");
    await expect(field(page, "status")).toContainText("From GitHub");
    await expect(field(page, "status")).toContainText("Change it on the GitHub issue");
    await reveal(page, "Why");
    await expect(field(page, "value_weighted")).toContainText("Calculated");
    await expect(field(page, "value_weighted")).toContainText("calculated from other fields");
    await reveal(page, "Outcomes");
    await expect(field(page, "outcome_verdict")).toContainText("Arrives in phase 7");
    await expect(panel(page).locator('[data-field]')).toHaveCount(166 - 1); // all 165 fields (health sits in its own block) plus none missing
  });

  test("a value typed in the panel appears in the grid at once, and Ctrl+Z undoes it", async ({ page }) => {
    await open(page, "n=40&item=R-02&view=All columns&cols=all"); // every column rendered: the panel narrows the grid
    await reveal(page, "Why");
    const before = Date.now();
    await field(page, "moscow").getByRole("combobox").selectOption("Must");
    await expect(cell(page, "item-2", "moscow")).toHaveText("Must");
    expect(Date.now() - before).toBeLessThan(1500); // optimistic: the grid does not wait for the save
    await settle(page);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(cell(page, "item-2", "moscow")).not.toHaveText("Must");
  });

  test("an edit in the panel registers in the grid, panel and status strip in under 200 ms (optimistic), measured over 12 edits", async ({ page }) => {
    await open(page, "n=200&item=R-02");
    await reveal(page, "Why");
    const times = await page.evaluate(async () => {
      const sel = document.querySelector('[data-field="moscow"] select') as HTMLSelectElement;
      const set = (Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value") as PropertyDescriptor).set!;
      const out: number[] = [];
      for (const v of ["Must", "Should", "Could", "Won't", "Must", "Should", "Could", "Won't", "Must", "Should", "Could", "Won't"]) {
        const t0 = performance.now();
        set.call(sel, v);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          // the status strip names the change as soon as the grid and the panel have been painted
          if (document.querySelector(".strip")?.textContent?.includes(`MoSCoW: `) && document.querySelector(".strip")?.textContent?.includes(`to ${v}`)) break;
        }
        out.push(performance.now() - t0);
      }
      return out;
    });
    const sorted = [...times].sort((a, b) => a - b);
    console.log(`panel edit latency: median ${Math.round(sorted[6]!)} ms, max ${Math.round(sorted[11]!)} ms`);
    expect(sorted[10]!).toBeLessThan(200);
  });

  test("text, currency and dates are checked with the same rules as the grid, and say what is wrong", async ({ page }) => {
    await open(page, "n=40&item=R-02");
    await reveal(page, "Why");
    const value = field(page, "value_12m").getByRole("textbox");
    await value.fill("1.2m");
    await value.press("Enter");
    await settle(page);
    expect((await row(page, "item-2")).value_12m).toBe(1200000);
    await value.fill("lots");
    await value.press("Enter");
    await expect(field(page, "value_12m").getByRole("alert")).toBeVisible();
    await reveal(page, "When");
    const start = field(page, "start_date").getByRole("textbox");
    await start.fill("31 mar");
    await start.press("Enter");
    await settle(page);
    expect(String((await row(page, "item-2")).start_date)).toMatch(/-03-31$/);
    await reveal(page, "What");
    const name = field(page, "initiative_name").getByRole("textbox");
    await name.fill("");
    await name.press("Enter");
    await expect(field(page, "initiative_name").getByRole("alert")).toContainText("needs a name");
  });

  test("Initiative Group is an open list in the panel: a new name is created, with a look-alike hint", async ({ page }) => {
    await open(page, "n=40&item=R-02");
    await reveal(page, "What");
    const g = field(page, "theme").getByRole("combobox");
    await g.fill("On-boarding");
    await expect(field(page, "theme").getByRole("status")).toContainText("Looks like “Onboarding”");
    await g.fill("Billing");
    await expect(field(page, "theme").getByRole("status")).toContainText("is a new group");
    await g.press("Enter");
    await settle(page);
    expect((await row(page, "item-2")).theme).toBe("Billing");
    await g.fill("retention");
    await g.press("Enter");
    await settle(page);
    expect((await row(page, "item-2")).theme).toBe("Retention");
  });

  test("the rank is shown both ways and typing a number moves the item", async ({ page }) => {
    await open(page, "n=40&item=R-05");
    await expect(panel(page).locator(".ip-rank")).toContainText("#5 globally · #1 in");
    await reveal(page, "What");
    const rank = field(page, "stack_rank").getByRole("textbox");
    await rank.fill("2");
    await rank.press("Enter");
    await settle(page);
    await expect(panel(page).locator(".ip-rank")).toContainText("#2 globally");
  });

  test("Health has Mark reviewed, and a place for the suggestion that arrives later", async ({ page }) => {
    await open(page, "n=40&item=R-02");
    await expect(panel(page).getByRole("region", { name: "Health" })).toBeVisible();
    await expect(panel(page).getByText("Not reviewed yet")).toBeVisible();
    await panel(page).getByRole("button", { name: "Mark reviewed" }).click();
    await expect(panel(page).getByText(/Last reviewed/)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
    await expect(panel(page).getByText("Suggested health")).toHaveCount(0);
  });
});

test.describe("list fields", () => {
  test("tags: add by typing, remove with ×, one undo step each", async ({ page }) => {
    await open(page, "n=40&item=R-01&cols=all&view=All columns");
    await reveal(page, "What");
    const tags = field(page, "tags");
    await expect(tags).toContainText("priority");
    await tags.getByLabel("Add to Tags").fill("urgent");
    await tags.getByLabel("Add to Tags").press("Enter");
    await expect(tags).toContainText("urgent");
    await settle(page);
    await expect(cell(page, "item-1", "tags")).toContainText("urgent");
    await tags.getByRole("button", { name: "Remove tag priority" }).click();
    await expect(tags).not.toContainText("priority");
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(tags).toContainText("priority");
    await settle(page);
  });

  test("links need an http address; related initiatives by code; teams by checkbox; effort by skill", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await reveal(page, "What");
    const links = field(page, "artifacts");
    await expect(links.getByRole("link", { name: "PRD" })).toHaveAttribute("href", "https://example.test/prd");
    await links.getByLabel("Link address").fill("not a link");
    await links.getByRole("button", { name: "Add link" }).click();
    await expect(links.getByRole("alert")).toContainText("http");
    await links.getByLabel("Link label (optional)").fill("Design");
    await links.getByLabel("Link address").fill("https://example.test/design");
    await links.getByRole("button", { name: "Add link" }).click();
    await expect(links.getByRole("link", { name: "Design" })).toBeVisible();
    await reveal(page, "Why");
    const rel = field(page, "related_to");
    await rel.getByLabel("Related initiative (code)").fill("R-09");
    await rel.getByLabel("Related initiative (code)").press("Enter");
    await expect(rel).toContainText("R-09 Initiative number 9");
    await rel.getByLabel("Related initiative (code)").fill("R-99");
    await rel.getByLabel("Related initiative (code)").press("Enter");
    await expect(rel.getByRole("alert")).toContainText("No initiative matches");
    const teams = field(page, "contributing_teams");
    await teams.getByLabel("Mobile").check();
    await settle(page);
    expect((await page.evaluate(() => (window as unknown as { __pv: { controller: { relatedOf: (id: string) => { contributing_teams: string[] } } } }).__pv.controller.relatedOf("item-1").contributing_teams))).toEqual(["t2"]);
    const skills = field(page, "effort_by_skill");
    await skills.getByLabel("Skill", { exact: true }).fill("backend");
    await skills.getByLabel("Person-weeks for the new skill").fill("4");
    await skills.getByRole("button", { name: "Add skill" }).click();
    await expect(skills).toContainText("backend");
    await settle(page);
    expect(((await row(page, "item-1")).effort_by_skill as Record<string, number>).backend).toBe(4);
  });

  test("a list that fails to save goes back and the strip says why", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await reveal(page, "What");
    await page.evaluate(() => { (window as unknown as { __pv: { source: { failRelated: string } } }).__pv.source.failRelated = "no permission"; });
    const tags = field(page, "tags");
    await tags.getByLabel("Add to Tags").fill("nope");
    await tags.getByLabel("Add to Tags").press("Enter");
    await expect(page.locator(".strip")).toContainText("no permission");
    await expect(tags).not.toContainText("nope");
  });

  test("screenshots wait for file storage and say so", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await reveal(page, "What");
    await expect(field(page, "screenshots")).toContainText("file storage");
  });
});

test.describe("tabs", () => {
  test("Spec, GitHub and Alignment are honest empty states; the GitHub tab shows the epics-with-tasks columns", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await panel(page).getByRole("tab", { name: "Spec" }).click();
    await expect(panel(page)).toContainText("arrive in phase 4");
    await panel(page).getByRole("tab", { name: "GitHub" }).click();
    await expect(panel(page).getByRole("columnheader")).toHaveText(["Issue", "Title", "State", "Assignee", "Created by", "Pull request", "Updated"]);
    await panel(page).getByRole("tab", { name: "Alignment" }).click();
    await expect(panel(page)).toContainText("phases 5 and 8");
  });

  test("the tabs work with the arrow keys", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await panel(page).getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(panel(page).getByRole("tab", { name: "Spec" })).toHaveAttribute("aria-selected", "true");
  });

  test("Activity lists changes with who and where from, and undoes your own change", async ({ page }) => {
    await open(page, "n=40&item=R-02&view=All columns&cols=all");
    await reveal(page, "Why");
    await field(page, "moscow").getByRole("combobox").selectOption("Must");
    await settle(page);
    await field(page, "tags").getByLabel("Add to Tags").fill("urgent").catch(() => {});
    await panel(page).getByRole("tab", { name: "Activity" }).click();
    const log = panel(page).locator(".ip-log");
    await expect(log).toContainText("MoSCoW");
    await expect(log).toContainText("changed from Should to Must");
    await expect(log).toContainText("ana@example.test · UI");
    await log.getByRole("button", { name: "Undo the change to MoSCoW" }).click();
    await settle(page);
    await expect(cell(page, "item-2", "moscow")).not.toHaveText("Must");
    await expect(panel(page)).toContainText("Put MoSCoW back to Should");
  });

  test("Activity shows added and removed list entries, and offers no Undo for someone else's change", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await reveal(page, "What");
    await field(page, "tags").getByLabel("Add to Tags").fill("urgent");
    await field(page, "tags").getByLabel("Add to Tags").press("Enter");
    await settle(page);
    await page.evaluate(() => { (window as unknown as { __pv: { source: { actorId: string } } }).__pv.source.actorId = "u2"; });
    await field(page, "tags").getByRole("button", { name: "Remove tag urgent" }).click();
    await settle(page);
    await panel(page).getByRole("tab", { name: "Activity" }).click();
    const log = panel(page).locator(".ip-log");
    await expect(log).toContainText("Tags added urgent");
    await expect(log).toContainText("Tags removed urgent");
    await expect(log.getByRole("button", { name: /Undo/ })).toHaveCount(0); // tag changes are undone with Undo in the strip
  });
});

test.describe("roles", () => {
  test("view-only roles read everything and can edit nothing", async ({ page }) => {
    await open(page, "n=40&item=R-01&role=viewer");
    await reveal(page, "What");
    await expect(field(page, "initiative_name").getByRole("textbox")).toBeDisabled();
    await expect(field(page, "tags").getByLabel("Add to Tags")).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
  });
});

test.describe("item page", () => {
  test("has an address of its own, the same panel, and J and K walk through the roadmap", async ({ page }) => {
    await page.goto("/dev/item/R-05");
    await page.waitForFunction(() => (window as unknown as { __pv?: unknown }).__pv !== undefined); // the page is ready for keys
    await expect(title(page)).toContainText("Initiative number 5 ");
    await expect(panel(page).getByRole("link", { name: "Back to the roadmap" })).toHaveAttribute("href", "/dev/grid");
    await expect(panel(page).locator(".ip-pos")).toHaveText("5 of 40");
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/dev\/item\/R-06/);
    await expect(title(page)).toContainText("Initiative number 6 ");
  });
  test("an unknown code is explained", async ({ page }) => {
    await page.goto("/dev/item/R-999");
    await expect(page.getByText("There is no initiative R-999")).toBeVisible();
  });
  test("the peek links to the page", async ({ page }) => {
    await open(page, "n=40&item=R-03");
    await expect(panel(page).getByRole("link", { name: "Open full page" })).toHaveAttribute("href", /\/portfolio\/R-03$/);
  });
});

test.describe("accessibility", () => {
  test("the peek panel and the item page pass the WCAG A/AA check", async ({ page }) => {
    await open(page, "n=40&item=R-01");
    await reveal(page, "What");
    await reveal(page, "Why");
    let r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
    await page.goto("/dev/item/R-01");
    await panel(page).waitFor();
    r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });
});
