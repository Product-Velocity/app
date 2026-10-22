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
