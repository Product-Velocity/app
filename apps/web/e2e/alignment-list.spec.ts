import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Issue #392: the Alignment tab (in-memory test page, fictional sessions; "now" is Wed 10 Mar 2027, 12:00 UTC).
const open = async (page: Page, query = "") => { await page.goto(`/dev/alignment${query}`); await page.getByRole("heading", { name: "Alignment", level: 1 }).waitFor(); };
const table = (page: Page) => page.getByRole("table", { name: "Alignment sessions" });
const names = (page: Page) => table(page).locator("tbody tr th").allInnerTexts();
const headers = (page: Page) => table(page).locator("thead th").allInnerTexts();
const created = (page: Page) => page.evaluate(() => (window as unknown as { __created: unknown[] }).__created);

test("an admin sees every session except archived ones, with the stats strip for the rows shown", async ({ page }) => {
  await open(page);
  expect((await names(page)).sort()).toEqual(["Mobile bets", "Q1 priorities", "Q4 planning", "Roadmap vote"]);
  const strip = page.getByRole("list", { name: "Totals for the sessions shown" }).or(page.locator("dl.al-stats"));
  await expect(strip).toContainText("Sessions4");
  await expect(strip).toContainText("People invited33"); // 14 + 9 + 0 + 10
  await expect(strip).toContainText("Participation73%"); // 24 of 33
  await expect(strip).toContainText("Initiatives ranked13"); // the closed sessions: 8 + 5
  await expect(strip).toContainText("Results applied1");
  expect(await headers(page)).toEqual(expect.arrayContaining(["Invited", "Voted", "Participation", "Applied to Stack Rank", "Created by", "Planned quarter"]));
  const q1 = table(page).getByRole("row").filter({ hasText: "Q1 priorities" });
  await expect(q1).toContainText("Q1 2027");
  await expect(q1).toContainText("Applied 12 Feb 2027 (3 moved)");
  expect(await headers(page)).toContain("Planned quarter");
  await expect(q1).toContainText("79%"); // 11 of 14
  await expect(q1).toContainText("ana@example.test");
  await expect(table(page).getByRole("row").filter({ hasText: "Mobile bets" })).toContainText("No planned quarter");
  // its initiatives are planned for Q2 and Q3 2027: the quarter most of them have is shown, and the other is noted
  const vote = table(page).getByRole("row").filter({ hasText: "Roadmap vote" });
  await expect(vote).toContainText("Q2 2027");
  await expect(vote.locator('td[data-label="Planned quarter"]')).toContainText("+1");
  await expect(vote.locator('td[data-label="Planned quarter"]')).toContainText("more: Q3 2027");
  await page.screenshot({ path: "../../docs/screenshots/392-alignment-tab.png", fullPage: true });
});

test("the needs-you chips count what needs an admin and filter the table", async ({ page }) => {
  await open(page);
  const chips = page.getByRole("group", { name: "Needs you" });
  await expect(chips.getByRole("button", { name: /Draft with nobody invited/ })).toContainText("1");
  await expect(chips.getByRole("button", { name: /Mailing waiting for your confirm/ })).toContainText("1");
  await expect(chips.getByRole("button", { name: /Closing within 48 hours/ })).toContainText("1");
  await expect(chips.getByRole("button", { name: /Closed, not applied yet/ })).toContainText("1");
  await chips.getByRole("button", { name: /Closed, not applied yet/ }).click();
  await expect(chips.getByRole("button", { name: /Closed, not applied yet/ })).toHaveAttribute("aria-pressed", "true");
  expect(await names(page)).toEqual(["Q4 planning"]);
  await expect(page.getByRole("status").filter({ hasText: "1 session match." })).toBeVisible();
  await chips.getByRole("button", { name: /Closed, not applied yet/ }).click();
  expect((await names(page)).length).toBe(4);
});

test("search finds a session by its name and by an initiative in it; filters combine; archived sessions are shown on request", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: "Search" }).fill("onboarding");
  expect((await names(page)).sort()).toEqual(["Q1 priorities", "Q4 planning"]); // an initiative that is in both
  await page.getByRole("searchbox", { name: "Search" }).fill("roadmap");
  expect(await names(page)).toEqual(["Roadmap vote"]);
  await page.getByRole("searchbox", { name: "Search" }).fill("");
  await page.getByLabel("Planned quarter").selectOption("Q4 2026");
  expect(await names(page)).toEqual(["Q4 planning"]);
  await page.getByLabel("Planned quarter").selectOption("Q3 2027"); // any of a session's initiatives' planned quarters
  expect(await names(page)).toEqual(["Roadmap vote"]);
  await page.getByLabel("Planned quarter").selectOption("No planned quarter");
  expect(await names(page)).toEqual(["Mobile bets"]);
  await page.getByLabel("Planned quarter").selectOption("");
  await page.getByLabel("Method").selectOption("ice");
  expect(await names(page)).toEqual(["Roadmap vote"]);
  await page.getByLabel("Method").selectOption("");
  await page.getByLabel("Applied", { exact: true }).selectOption("applied");
  expect(await names(page)).toEqual(["Q1 priorities"]);
  await page.getByRole("checkbox", { name: "Show archived" }).check();
  expect((await names(page)).sort()).toEqual(["Old vote", "Q1 priorities"]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  expect((await names(page)).length).toBe(4);
  await page.getByRole("searchbox", { name: "Search" }).fill("zzz");
  await expect(page.getByText("No session matches. Clear the filters to see them all.")).toBeVisible();
});

test("columns sort in both directions and say which way", async ({ page }) => {
  await open(page);
  const sortBtn = (label: string) => table(page).getByRole("button", { name: new RegExp(`^${label}`) });
  await sortBtn("Initiatives").click();
  await expect(table(page).locator("thead th", { hasText: "Initiatives" })).toHaveAttribute("aria-sort", "descending");
  expect(await names(page)).toEqual(["Q1 priorities", "Roadmap vote", "Mobile bets", "Q4 planning"]); // 8, 6, then the tie at 5 with the newest session first
  await sortBtn("Initiatives").click();
  await expect(table(page).locator("thead th", { hasText: "Initiatives" })).toHaveAttribute("aria-sort", "ascending");
  expect(await names(page)).toEqual(["Mobile bets", "Q4 planning", "Roadmap vote", "Q1 priorities"]); // 5, 5, 6, 8
  await sortBtn("Session").click();
  expect(await names(page)).toEqual(["Mobile bets", "Q1 priorities", "Q4 planning", "Roadmap vote"]);
});

test("a member sees only the closed sessions that allow results, and none of the admin-only columns, strip, chips or the New session button", async ({ page }) => {
  await open(page, "?role=member");
  expect((await names(page)).sort()).toEqual(["Q1 priorities", "Q4 planning"]); // the archived one is behind the filter
  const heads = await headers(page);
  for (const h of ["Invited", "Voted", "Participation", "Applied to Stack Rank", "Created by"]) expect(heads).not.toContain(h);
  expect(heads).toEqual(expect.arrayContaining(["Session", "Method", "Status", "Planned quarter", "Initiatives", "Contested"]));
  await expect(page.locator("dl.al-stats")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Needs you" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New session" })).toHaveCount(0);
  await expect(page.getByLabel("Applied", { exact: true })).toHaveCount(0);
  const status = page.getByLabel("Status", { exact: true });
  await expect(status.locator("option")).toHaveText(["Any status", "Closed", "Archived"]); // no draft, no open
  await expect(page.getByRole("link", { name: "Q1 priorities" })).toHaveAttribute("href", "/alignment/s-q1/results"); // the read-only view
  await page.screenshot({ path: "../../docs/screenshots/392-alignment-tab-member.png", fullPage: true });
});

test("an admin's rows open the session page; the empty states say what to do", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("link", { name: "Q1 priorities" })).toHaveAttribute("href", "/alignment/s-q1");
  await open(page, "?empty=1");
  await expect(page.getByText("No alignment sessions yet. Press New session to start one.")).toBeVisible();
  await open(page, "?role=member&empty=1");
  await expect(page.getByText(/No results to show yet/)).toBeVisible();
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

test("on a phone the table becomes cards and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(table(page).locator("thead th").first()).not.toBeInViewport();
  const card = table(page).getByRole("row").filter({ hasText: "Q1 priorities" });
  await expect(card).toBeVisible();
  await expect(card.locator('td[data-label="Planned quarter"]')).toContainText("Q1 2027");
  await page.screenshot({ path: "../../docs/screenshots/392-alignment-tab-phone.png", fullPage: true });
});

test("no serious accessibility problems, for an admin and for a member", async ({ page }) => {
  for (const q of ["", "?role=member"]) {
    await open(page, q);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical"), q).toEqual([]);
  }
});

test("the header has a working Alignment tab, no longer muted, and the account menu no longer lists it", async ({ page }) => {
  await page.goto("/dev/grid?n=5");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Alignment" })).toHaveAttribute("href", "/alignment");
  await expect(header.locator(".tab-later", { hasText: "Alignment" })).toHaveCount(0);
  await expect(header.locator(".tab-later")).toHaveCount(2); // Planning and Capacity are still to come
  await header.locator("summary").click();
  await expect(header.locator(".account-menu").getByRole("link", { name: "Alignment" })).toHaveCount(0);
});
