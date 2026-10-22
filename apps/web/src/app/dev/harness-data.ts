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
