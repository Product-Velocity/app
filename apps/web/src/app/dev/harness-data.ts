import { emptyRelated } from "@pv/domain";
import { PortfolioController } from "@/features/portfolio/controller";
import { MemoryDataSource, sampleItems } from "@/features/portfolio/memory-source";
import type { Lookups } from "@/features/portfolio/types";

/** The workspace of the test pages (fictional): projects, people, Initiative Groups and teams. */
export const harnessLookups: Lookups = {
  projects: ["Platform", "Marketplace", "Growth", "Payments", "Mobile", "Data"].map((name, i) => ({ id: `p${i + 1}`, name })),
  members: ["ana", "bo", "chen", "dee", "eli"].map((n, i) => ({ user_id: `u${i + 1}`, email: `${n}@example.test` })),
  groups: ["Onboarding", "Platform health", "Retention"],
  teams: [{ id: "t1", name: "Core" }, { id: "t2", name: "Mobile" }],
};

/** The same workspace with long lists of people and projects, for the searchable drop-downs (more than 8 options). */
export const bigLookups: Lookups = {
  ...harnessLookups,
  projects: [...harnessLookups.projects, ...["Billing", "Search", "Identity", "Reporting", "Onboarding", "Support", "Security", "Partners"].map((name, i) => ({ id: `p${i + 7}`, name }))],
  members: [...harnessLookups.members, ...["fay", "gus", "hana", "ivo", "jun", "kai", "lea"].map((n, i) => ({ user_id: `u${i + 6}`, email: `${n}@example.test` }))],
};

export function makeHarness(n: number, latency: number, role: string, lookups: Lookups = harnessLookups) {
  const items = sampleItems(n, lookups.projects.map((p) => p.id), lookups.members.map((m) => m.user_id));
  const source = new MemoryDataSource(items, { latencyMs: latency });
  // the lists of the first item, so the panel has something to show
  source.related.set("item-1", { ...emptyRelated(), tags: ["priority", "q1"], artifacts: [{ label: "PRD", url: "https://example.test/prd" }], depends_on: ["item-2"] });
  // who added each item: the signed-in test user ("u1", Ana) added the odd-numbered ones, "u2" the even ones
  for (const i of source.items) (i as Record<string, unknown>)._created_by = Number(i.id.replace("item-", "")) % 2 === 1 ? "u1" : "u2";
  const controller = new PortfolioController(source, source.items.map((i) => ({ ...i })), lookups, role, () => new Date(Date.UTC(2027, 3, 14)), undefined, undefined, "u1");
  return { controller, source };
}

/**
 * Data for the Gantt test page (today is Wed 14 Apr 2027): most items have a Planned Start and a G2M Date (est) spread over
 * the year, one in eleven has no dates (the Unscheduled lane), and the items cycle through three Initiative Groups and none.
 */
export function makeGanttHarness(n: number, role: string) {
  const { controller, source } = makeHarness(n, 0, role);
  const groups = ["Onboarding", "Platform health", "Retention", null];
  const base = Date.UTC(2027, 0, 4);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  source.items.forEach((item, i) => {
    const start = base + ((i * 13) % 300) * 86_400_000;
    const unscheduled = i % 11 === 10;
    item.planned_start = unscheduled ? null : iso(start);
    item.g2m_date_est = unscheduled ? null : iso(start + (14 + ((i * 7) % 70)) * 86_400_000);
    item.theme = groups[i % groups.length] ?? null;
    item.contributing_teams = i % 5 === 0 ? "Core, Mobile" : i % 3 === 0 ? "Core" : null;
  });
  for (const r of controller.rows) {
    const s = source.items.find((x) => x.id === r.id)!;
    r.planned_start = s.planned_start; r.g2m_date_est = s.g2m_date_est; r.theme = s.theme; r.contributing_teams = s.contributing_teams;
  }
  return { controller, source };
}

/**
 * Data for the Cards test page: items cycle through the Initiative Phases and three Initiative Groups, so every
 * column and lane has cards and a few have none.
 */
export function makeCardsHarness(n: number, role: string) {
  const { controller, source } = makeHarness(n, 0, role);
  const phases = ["Discover", "Define", "Build", "Beta-test", null];
  const groups = ["Onboarding", "Platform health", "Retention", null];
  source.items.forEach((item, i) => {
    item.initiative_phase = phases[i % phases.length] ?? null;
    item.theme = groups[(i * 3) % groups.length] ?? null;
    item.contributing_teams = i % 5 === 0 ? "Core, Mobile" : i % 3 === 0 ? "Core" : null;
  });
  for (const r of controller.rows) {
    const s = source.items.find((x) => x.id === r.id)!;
    r.initiative_phase = s.initiative_phase; r.theme = s.theme; r.contributing_teams = s.contributing_teams;
  }
  return { controller, source };
}

/**
 * Data for the leadership test page (today is Wed 14 Apr 2027, ISO week 15): health, categories and G2M dates spread so that
 * every part of the page has something to show, plus this week's audit changes. With `reviewed`, a reviewed weekly update exists.
 */
export function makeLeadershipHarness(n: number, role: string) {
  const { controller, source } = makeHarness(n, 0, role);
  const categories = ["New big bets", "Grow customer revenues", "Protect customer revenues", "Operational efficiency", null];
  const phases = ["Discover", "Build", "Beta-test", "Roll-out", "Completed"];
  const iso = (d: number) => new Date(Date.UTC(2027, 3, 14) + d * 86_400_000).toISOString().slice(0, 10);
  source.items.forEach((item, i) => {
    item.roadmap_category = categories[i % categories.length] ?? null;
    item.initiative_phase = phases[i % phases.length]!;
    item.g2m_date_est = iso(i % 7 === 0 ? -20 : i % 5 === 0 ? 6 : 30 + i);
    item.g2m_date_actual = i === 4 ? iso(-1) : null;
  });
  for (const r of controller.rows) {
    const s = source.items.find((x) => x.id === r.id)!;
    for (const k of ["roadmap_category", "initiative_phase", "g2m_date_est", "g2m_date_actual"]) r[k] = s[k];
  }
  const at = (d: number, h = 9) => `${iso(d)}T${String(h).padStart(2, "0")}:00:00.000Z`;
  const changes = [
    { itemId: "item-6", field: "stack_rank", old: 9, new: 6, at: at(-2), actorId: "u1", via: "UI" },
    { itemId: "item-3", field: "health", old: "On Track", new: "At Risk", at: at(-1), actorId: "u2", via: "UI" },
    { itemId: "item-2", field: "status", old: "Not started", new: "In progress", at: at(-1, 11), actorId: null, via: "GitHub webhook" },
    { itemId: "item-1", field: "stack_rank", old: 3, new: 2, at: at(-2, 8), actorId: "u1", via: "UI" },
    { itemId: "item-1", field: "stack_rank", old: 2, new: 1, at: at(-2, 10), actorId: "u1", via: "UI" },
    { itemId: "item-4", field: "stack_rank", old: 6, new: 7, at: at(-2, 8), actorId: "u1", via: "UI" },
    { itemId: "item-4", field: "stack_rank", old: 7, new: 6, at: at(-2, 9), actorId: "u1", via: "UI" },
    { itemId: "item-9", field: "stack_rank", old: 12, new: 12, at: at(-8), actorId: "u1", via: "UI" }, // before this week
  ];
  const reviewed = role === "leadership" || role === "viewer"
    ? { id: "wu-seed", weekStart: "2027-04-12", scopeKey: "all", scopeLabel: "All projects", body: "All projects, week 15\n\nHighlights\n- R-05 was completed on 13 Apr.", reviewedAt: "2027-04-14T08:00:00.000Z", reviewedBy: "u2" }
    : null;
  return { controller, source, changes, reviewed };
}

/**
 * ?gh=1: the item has a pushed tracking issue with two epics and three tasks (one closed), and its breakdown awaits engineering.
 * Returns the lookups with the link; the tree is read through the in-memory source.
 */
export function withGithubTree(controller: PortfolioController, source: MemoryDataSource, code: string, lookups: Lookups): Lookups {
  const row = controller.rows.find((r) => r.item_code === code);
  if (!row) return lookups;
  const t = (number: number, level: 1 | 2, parentNumber: number | null, title: string, state: "open" | "closed", assignees: string[], createdBy: "app" | "claude" | "engineer" = "engineer") =>
    ({ repo: "Acme/App", number, level, parentNumber, title, state, stateReason: null, assignees, createdBy, updatedAt: "2026-10-23T10:00:00Z" });
  source.trees.set(row.id, [t(40, 1, null, "Import flow", "open", []), t(41, 1, null, "Export flow", "open", ["dev1"], "claude"), t(42, 2, 40, "Parse the file", "closed", ["dev1"]), t(43, 2, 40, "Map the columns", "open", ["dev2"]), t(44, 2, 41, "Write the CSV", "open", [])]);
  Object.assign(row, { issues_total: 3, issues_closed: 1, breakdown_route: "Traditional", breakdown_status: "Awaiting engineering", last_synced: "2026-10-27T10:15:00Z", gh_project_status: "On staging", synced_with: 'GitHub · Acme/App · board "Product Velocity roadmap"' });
  return { ...lookups, github: { connected: true, links: { [row.id]: { mode: "push", number: 34, url: "https://github.com/Acme/App/issues/34", state: "synced", error: null, ghState: "open", lastActivity: "2026-10-23T10:00:00Z" } } } };
}

/**
 * Data for the Reports test page: Initiative Phase, Initiative Status and Planned Quarter cycle, a few items have two teams, some no quarter,
 * and every seventh is archived. Fully known, so the tests can count what each filter must show.
 */
export function makeReportsHarness(n: number, role: string) {
  const { controller, source } = makeHarness(n, 0, role);
  const phases = ["Discover", "Define", "Build", "Beta-test"];
  const statuses = ["Active", "On hold", "Cancelled"];
  const quarters = ["Q3 2027", "Q4 2027", null];
  for (const r of controller.rows) {
    const i = Number(r.id.replace("item-", "")) - 1;
    Object.assign(r, {
      initiative_phase: phases[i % 4], initiative_status: statuses[i % 3], g2m_quarter: quarters[i % 3],
      theme: ["Onboarding", "Retention", null][i % 3], archived: i % 7 === 6, engineering_manager: i % 6 === 0 ? null : `u${(i % 5) + 1}`,
      contributing_teams: i % 5 === 0 ? "Core, Mobile" : i % 2 === 0 ? "Core" : null,
    });
    // dates for Time to Market and the timeline: discovery starts on day i of 2027-02-01; every third item has gone to market 60 to 90 days later
    const d0 = Date.UTC(2027, 1, 1) + i * 86_400_000;
    const at = (n: number) => new Date(d0 + n * 86_400_000).toISOString().slice(0, 10);
    Object.assign(r, {
      start_discovery: at(0), start_date: at(5), start_definition: at(15), start_building: at(40),
      kr_metric: i % 4 === 0 ? `Metric ${i}` : null, kr_start: i % 4 === 0 ? i : null, kr_target: i % 4 === 0 ? i + 10 : null, kr_unit: i % 4 === 0 ? "count" : null, kr_direction: i % 4 === 0 ? "Increase" : null,
      g2m_date_actual: i % 3 === 0 ? at(60 + (i % 4) * 10) : null, g2m_date_est: at(120), planned_start: at(0),
    });
  }
  return { controller, source };
}
