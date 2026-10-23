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

export function makeHarness(n: number, latency: number, role: string) {
  const items = sampleItems(n, harnessLookups.projects.map((p) => p.id), harnessLookups.members.map((m) => m.user_id));
  const source = new MemoryDataSource(items, { latencyMs: latency });
  // the lists of the first item, so the panel has something to show
  source.related.set("item-1", { ...emptyRelated(), tags: ["priority", "q1"], artifacts: [{ label: "PRD", url: "https://example.test/prd" }], depends_on: ["item-2"] });
  const controller = new PortfolioController(source, items, harnessLookups, role, () => new Date(Date.UTC(2027, 3, 14)));
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
    { itemId: "item-2", field: "status", old: "Backlog", new: "In Progress", at: at(-1, 11), actorId: null, via: "GitHub webhook" },
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
