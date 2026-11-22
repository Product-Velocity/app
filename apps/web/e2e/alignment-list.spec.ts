import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #392: the Alignment tab (in-memory test page, fictional sessions; "now" is Wed 10 Mar 2027, 12:00 UTC).
const open = async (page: Page, query = "") => { await page.goto(`/dev/alignment${query}`); await page.getByRole("heading", { name: "Alignment", level: 1 }).waitFor(); };
const grid = (page: Page) => page.getByTestId("alignment-grid");
/** The names in the order the rows are shown (the grid keeps its row elements in no particular order in the page, so they are sorted by row index). */
const names = (page: Page) => grid(page).locator('.ag-row:not(.ag-full-width-row)').evaluateAll((rows) => rows
  .sort((a, b) => Number(a.getAttribute("row-index")) - Number(b.getAttribute("row-index")))
  .map((r) => r.querySelector('[col-id="name"]')?.textContent ?? ""));
const headers = (page: Page) => grid(page).locator(".ag-header-cell").allInnerTexts();
/** The grid redraws a moment after the data changes, so a list of names is awaited until it matches. */
const shown = (page: Page, sorted = false) => expect.poll(async () => { const n = await names(page); return sorted ? n.sort() : n; });
const created = (page: Page) => page.evaluate(() => (window as unknown as { __created: unknown[] }).__created);
const bar = (page: Page) => page.getByRole("region", { name: "Alignment tools" });
const rowOf = (page: Page, name: string) => grid(page).locator(".ag-row").filter({ hasText: name });
const filterPanel = async (page: Page) => { await bar(page).getByRole("button", { name: /^Filter/ }).click(); return page.getByRole("group", { name: "Filters" }); };

test("an admin sees every session except archived ones, with the stats strip for the rows shown", async ({ page }) => {
  await open(page);
  await shown(page, true).toEqual(["Mobile bets", "Q1 priorities", "Q4 planning", "Roadmap vote"]);
  const strip = page.locator("dl.al-stats");
  await expect(strip).toContainText("Sessions4");
  await expect(strip).toContainText("People invited33"); // 14 + 9 + 0 + 10
  await expect(strip).toContainText("Participation73%"); // 24 of 33
  await expect(strip).toContainText("Initiatives ranked13"); // the closed sessions: 8 + 5
  await expect(strip).toContainText("Results applied1");
  expect(await headers(page)).toEqual(expect.arrayContaining(["Session", "Status", "Needs you", "Actions", "Invited", "Voted", "Participation", "Applied to Stack Rank", "Created by", "Planned quarter"]));
  const q1 = rowOf(page, "Q1 priorities");
  await expect(q1).toContainText("Q1 2027");
  await expect(q1).toContainText("Applied 12 Feb 2027 (3 moved)");
  await expect(q1).toContainText("79%"); // 11 of 14
  await expect(q1).toContainText("ana@example.test");
  await expect(rowOf(page, "Mobile bets")).toContainText("No planned quarter");
  // its initiatives are planned for Q2 and Q3 2027: the quarter most of them have is shown, and the other is noted
  const vote = rowOf(page, "Roadmap vote");
  await expect(vote).toContainText("Q2 2027");
  await expect(vote.locator('[col-id="quarter"]')).toContainText("+1");
  await expect(vote.locator('[col-id="quarter"]')).toContainText("more: Q3 2027");
  await page.screenshot({ path: "../../docs/screenshots/586-alignment-grid.png", fullPage: true });
});

test("the needs-you chips count what needs an admin and filter the grid; the Needs you column says it in words", async ({ page }) => {
  await open(page);
  const chips = page.getByRole("group", { name: "Needs you" });
  await expect(chips.getByRole("button", { name: /Draft with nobody invited/ })).toContainText("1");
  await expect(chips.getByRole("button", { name: /Mailing waiting for your confirm/ })).toContainText("1");
  await expect(chips.getByRole("button", { name: /Closing within 48 hours/ })).toContainText("1");
  await expect(chips.getByRole("button", { name: /Closed, not applied yet/ })).toContainText("1");
  await expect(rowOf(page, "Q4 planning").locator('[col-id="needs"]')).toContainText("Closed, not applied yet");
  await chips.getByRole("button", { name: /Closed, not applied yet/ }).click();
  await expect(chips.getByRole("button", { name: /Closed, not applied yet/ })).toHaveAttribute("aria-pressed", "true");
  await shown(page).toEqual(["Q4 planning"]);
  await expect(page.getByRole("status").filter({ hasText: "1 session match." })).toBeVisible();
  await chips.getByRole("button", { name: /Closed, not applied yet/ }).click();
  await expect.poll(async () => (await names(page)).length).toBe(4);
});

test("search finds a session by its name and by an initiative in it; the Filter panel combines filters; archived sessions are shown on request", async ({ page }) => {
  await open(page);
  const search = bar(page).getByRole("searchbox", { name: "Search" });
  await search.fill("onboarding");
  await shown(page, true).toEqual(["Q1 priorities", "Q4 planning"]); // an initiative that is in both
  await search.fill("roadmap");
  await shown(page).toEqual(["Roadmap vote"]);
  await search.fill("");
  let panel = await filterPanel(page);
  await panel.getByRole("button", { name: "Q4 2026", exact: true }).click();
  await shown(page).toEqual(["Q4 planning"]);
  await panel.getByRole("button", { name: "Q4 2026", exact: true }).click();
  await panel.getByRole("button", { name: "Q3 2027", exact: true }).click(); // any of a session's initiatives' planned quarters
  await shown(page).toEqual(["Roadmap vote"]);
  await panel.getByRole("button", { name: "Q3 2027", exact: true }).click();
  await panel.getByRole("button", { name: "No planned quarter", exact: true }).click();
  await shown(page).toEqual(["Mobile bets"]);
  await panel.getByRole("button", { name: "No planned quarter", exact: true }).click();
  await panel.getByRole("group", { name: "Method" }).getByRole("button", { name: "ICE sliders" }).click();
  await shown(page).toEqual(["Roadmap vote"]);
  await expect(page.getByRole("group", { name: "Active filters" })).toContainText("Method: ICE sliders");
  await panel.getByRole("group", { name: "Method" }).getByRole("button", { name: "ICE sliders" }).click();
  await panel.getByRole("group", { name: "Applied to Stack Rank" }).getByRole("button", { name: "Applied", exact: true }).click();
  await shown(page).toEqual(["Q1 priorities"]);
  await panel.getByRole("button", { name: "Show archived sessions" }).click();
  await shown(page, true).toEqual(["Old vote", "Q1 priorities"]);
  await panel.getByRole("button", { name: "Clear all" }).click();
  await expect.poll(async () => (await names(page)).length).toBe(4);
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await search.fill("zzz");
  await expect(page.getByText("No session matches.")).toBeVisible();
  await page.getByRole("button", { name: "Clear the filters" }).click();
  await expect.poll(async () => (await names(page)).length).toBe(4);
  panel = page.getByRole("group", { name: "Filters" });
});

test("a filter chip under the bar removes its filter", async ({ page }) => {
  await open(page);
  const panel = await filterPanel(page);
  await panel.getByRole("group", { name: "Status" }).getByRole("button", { name: "Closed" }).click();
  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await shown(page, true).toEqual(["Q1 priorities", "Q4 planning"]);
  await page.getByRole("button", { name: "Remove filter Status: Closed" }).click();
  await expect.poll(async () => (await names(page)).length).toBe(4);
});

test("columns sort in both directions and say which way", async ({ page }) => {
  await open(page);
  const sortBtn = (label: string) => grid(page).getByRole("button", { name: new RegExp(`^Sort by ${label}`) });
  await sortBtn("Initiatives").click();
  await expect(sortBtn("Initiatives")).toHaveAttribute("aria-label", "Sort by Initiatives, descending");
  await shown(page).toEqual(["Q1 priorities", "Roadmap vote", "Mobile bets", "Q4 planning"]); // 8, 6, then the tie at 5 with the newest session first
  await sortBtn("Initiatives").click();
  await expect(sortBtn("Initiatives")).toHaveAttribute("aria-label", "Sort by Initiatives, ascending");
  await shown(page).toEqual(["Mobile bets", "Q4 planning", "Roadmap vote", "Q1 priorities"]); // 5, 5, 6, 8
  await sortBtn("Session").click();
  await shown(page).toEqual(["Mobile bets", "Q1 priorities", "Q4 planning", "Roadmap vote"]);
});

test("Group by status puts a header row before each group with its count and the votes in words, and folding hides the rows", async ({ page }) => {
  await open(page);
  await bar(page).getByRole("button", { name: /^Group by/ }).click();
  const gp = page.getByRole("group", { name: "Group by", exact: true }).last();
  await gp.getByRole("button", { name: "Status", exact: true }).click();
  await gp.getByRole("button", { name: "Apply" }).click();
  const headers_ = grid(page).locator(".ag-full-width-row .group-row");
  await expect(headers_).toHaveCount(3); // Open, Draft, Closed (archived is hidden)
  await expect(headers_.first()).toContainText("Open");
  await expect(headers_.first()).toContainText("1 session");
  await expect(headers_.first()).toContainText("4 of 9 invited have voted");
  await expect(headers_.nth(2)).toContainText("Closed");
  await expect(headers_.nth(2)).toContainText("2 sessions");
  await grid(page).getByRole("button", { name: "Collapse group Closed" }).click();
  await shown(page, true).toEqual(["Mobile bets", "Roadmap vote"]);
  await bar(page).getByRole("button", { name: "Expand all groups" }).or(bar(page).getByRole("button", { name: "Collapse all groups" })).click();
  await shown(page).toEqual([]); // every group folded
  await page.reload();
  await page.getByRole("heading", { name: "Alignment", level: 1 }).waitFor();
  await expect(grid(page).locator(".ag-full-width-row .group-row")).toHaveCount(3); // the grouping is remembered in the browser
});

test("the Columns panel hides a column and the choice is remembered", async ({ page }) => {
  await open(page);
  await bar(page).getByRole("button", { name: /^Columns/ }).click();
  const panel = page.getByRole("group", { name: "Choose columns" });
  await panel.getByRole("checkbox", { name: "Created by" }).uncheck();
  await panel.getByRole("button", { name: /^Apply columns/ }).click();
  expect(await headers(page)).not.toContain("Created by");
  await page.reload();
  await page.getByRole("heading", { name: "Alignment", level: 1 }).waitFor();
  expect(await headers(page)).not.toContain("Created by");
});

test("Actions: the next step for each session is a link, and Open, Close and Archive ask first and then change the state", async ({ page }) => {
  await open(page);
  await expect(rowOf(page, "Mobile bets").getByRole("link", { name: /^Add people/ })).toHaveAttribute("href", "/alignment/s-mobile#participants");
  await expect(rowOf(page, "Roadmap vote").getByRole("link", { name: /^Review mailing/ })).toHaveAttribute("href", "/alignment/s-vote#participants");
  await expect(rowOf(page, "Q4 planning").getByRole("link", { name: /^Apply results/ })).toHaveAttribute("href", "/alignment/s-q4/results");
  await expect(rowOf(page, "Q1 priorities").getByRole("link", { name: /^Results/ })).toHaveAttribute("href", "/alignment/s-q1/results");
  await rowOf(page, "Roadmap vote").getByRole("button", { name: "Close the session: Roadmap vote" }).click();
  const dialog = page.getByRole("dialog", { name: "Close the session: Roadmap vote" });
  await expect(dialog).toContainText("Closing ends voting.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await created(page)).toEqual([]);
  await rowOf(page, "Q1 priorities").getByRole("button", { name: "Archive: Q1 priorities" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  expect(await created(page)).toEqual([{ state: "s-q1", to: "archived" }]);
  await expect(page.getByRole("status").filter({ hasText: "Q1 priorities is now archived." })).toBeVisible();
});

test("a member sees only the closed sessions that allow results, and none of the admin-only columns, strip, chips, actions or the New session button", async ({ page }) => {
  await open(page, "?role=member");
  await shown(page, true).toEqual(["Q1 priorities", "Q4 planning"]); // the archived one is behind the filter
  const heads = await headers(page);
  for (const h of ["Invited", "Voted", "Participation", "Applied to Stack Rank", "Created by", "Needs you", "Actions"]) expect(heads).not.toContain(h);
  expect(heads).toEqual(expect.arrayContaining(["Session", "Method", "Status", "Planned quarter", "Initiatives", "Contested"]));
  await expect(page.locator("dl.al-stats")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Needs you" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New session" })).toHaveCount(0);
  const panel = await filterPanel(page);
  await expect(panel.getByRole("group", { name: "Applied to Stack Rank" })).toHaveCount(0);
  await expect(panel.getByRole("group", { name: "Status" }).getByRole("button")).toHaveText(["Closed", "Archived"]); // no draft, no open
  await expect(page.getByRole("link", { name: "Q1 priorities" })).toHaveAttribute("href", "/alignment/s-q1/results"); // the read-only view
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "../../docs/screenshots/586-alignment-grid-member.png", fullPage: true });
});

test("an admin's rows open the session page and the counts go deeper; the empty states say what to do", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("link", { name: "Q1 priorities" })).toHaveAttribute("href", "/alignment/s-q1");
  await expect(rowOf(page, "Q1 priorities").locator('[col-id="voted"]').getByRole("link")).toHaveAttribute("href", "/alignment/s-q1#participants");
  await expect(rowOf(page, "Q1 priorities").locator('[col-id="contested"]').getByRole("link")).toHaveAttribute("href", "/alignment/s-q1/results");
  await open(page, "?empty=1");
  await expect(page.getByText("No alignment sessions yet. Press New session to start one.")).toBeVisible();
  await open(page, "?role=member&empty=1");
  await expect(page.getByText(/No results to show yet/)).toBeVisible();
});

test("the grid has no accessibility violations", async ({ page }) => {
  await open(page);
  const r = await new AxeBuilder({ page }).include('[data-testid="alignment-grid"]').analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("New session: needs a name and at least two initiatives, and the picker finds initiatives by planned quarter, MoSCoW and stage", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog", { name: "New alignment session" });
  const create = dialog.getByRole("button", { name: "Create draft" });
  const list = dialog.getByRole("list", { name: "Initiatives" }).getByRole("listitem");
  await expect(create).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Q1 candidates");
  await expect(dialog).toContainText("Pick at least 2 initiatives.");
  await dialog.getByRole("combobox", { name: "Method" }).selectOption("ice");
  await expect(list).toHaveCount(6);
  // the combination people ask for most: a planned quarter, MoSCoW Must, and the stages Discover, PRD (Define) and Ready for build
  await dialog.getByRole("combobox", { name: "Planned quarter" }).selectOption("Q1 2027");
  await expect(list).toHaveCount(4);
  await dialog.getByRole("combobox", { name: "MoSCoW" }).selectOption("Must");
  await expect(list).toHaveCount(3);
  const stage = dialog.getByRole("group", { name: "Stage" });
  // the counts follow the other filters: Q1 2027 and Must leave one initiative in each stage (R-04, R-11, R-07)
  await expect(stage.getByRole("button", { name: /^Discover/ })).toContainText("1");
  await expect(stage.getByRole("button", { name: /^PRD \(Define\)/ })).toContainText("1");
  await expect(stage.getByRole("button", { name: /^Ready for build/ })).toContainText("1");
  await dialog.getByRole("combobox", { name: "MoSCoW" }).selectOption("");
  await expect(stage.getByRole("button", { name: /^PRD \(Define\)/ })).toContainText("2"); // R-15 (Could) is in Define too
  await dialog.getByRole("combobox", { name: "MoSCoW" }).selectOption("Must");
  await stage.getByRole("button", { name: /^Discover/ }).click();
  await expect(list).toHaveCount(1); // R-04 is the only one in Discover, planned for Q1 2027, Must
  await stage.getByRole("button", { name: /^PRD \(Define\)/ }).click();
  await expect(list).toHaveCount(2); // the stages are an "or": Discover or the PRD
  await stage.getByRole("button", { name: /^Ready for build/ }).click();
  await expect(list).toHaveCount(3);
  await expect(stage.getByRole("button", { name: /^Discover/ })).toHaveAttribute("aria-pressed", "true");
  await expect(list.filter({ hasText: "R-07" })).toContainText("Ready for build");
  await dialog.getByRole("button", { name: "Add the 3 shown" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "3 of 100 picked" })).toBeVisible();
  await page.screenshot({ path: "../../docs/screenshots/392-new-session.png", fullPage: true });
  // the search and the project narrow it further; clearing the filters shows everything again
  await dialog.getByRole("searchbox", { name: "Search" }).fill("host");
  await expect(list).toHaveCount(1);
  await dialog.getByRole("button", { name: "Clear filters" }).click();
  await expect(list).toHaveCount(6);
  await dialog.getByRole("checkbox", { name: /R-11/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /R-15/ }).check();
  await expect(create).toBeEnabled();
  await create.click();
  const calls = (await created(page)) as { ids?: string[]; name?: string; method?: string; opened?: string }[];
  expect(calls[0]).toMatchObject({ name: "Q1 candidates", method: "ice" });
  expect([...calls[0]!.ids!].sort()).toEqual(["i1", "i3", "i5"]); // R-04, R-07 and R-15: R-11 was ticked off and R-15 added by hand
  expect(calls[1]).toEqual({ opened: "new-session" });
});

test("the picker's MoSCoW and planned quarter can also find what is not set", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "New session" }).click();
  const dialog = page.getByRole("dialog", { name: "New alignment session" });
  const list = dialog.getByRole("list", { name: "Initiatives" }).getByRole("listitem");
  await dialog.getByRole("combobox", { name: "MoSCoW" }).selectOption("Not set");
  await expect(list).toHaveCount(1);
  await expect(list).toContainText("R-21");
  await dialog.getByRole("combobox", { name: "MoSCoW" }).selectOption("");
  await dialog.getByRole("combobox", { name: "Planned quarter" }).selectOption("No planned quarter");
  await expect(list).toHaveCount(1);
  await expect(dialog.getByRole("combobox", { name: "Planned quarter" }).locator("option")).toHaveText(["Any planned quarter", "Q1 2027", "Q2 2027", "No planned quarter"]);
});

test("New session and its dialog work with the keyboard: Escape closes, Enter on the button opens", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "New session" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "New alignment session" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "New alignment session" })).toHaveCount(0);
});

test("on a phone the grid scrolls inside itself and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(rowOf(page, "Q1 priorities")).toBeVisible();
  await page.screenshot({ path: "../../docs/screenshots/586-alignment-grid-phone.png", fullPage: true });
});
