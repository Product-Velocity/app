import { PHASES } from "@pv/domain";

/**
 * The numbers behind the phone Insights screen (issue #635, slice P2). Pure rules over the roadmap rows the phone already holds: initiatives and teams
 * only, never people (CLAUDE.md rule 8), and no commercial fields (rule 2). "Active" is Initiative Status = Active, as in the Roadmap Health report.
 */
export type InsightRow = Record<string, unknown> & { home_project: string };

export const HEALTH_ORDER = ["On Track", "At Risk", "Delayed", "Blocked", "No health"] as const;
export type HealthName = (typeof HEALTH_ORDER)[number];
const NEEDS_ATTENTION: readonly string[] = ["At Risk", "Delayed", "Blocked"];
const WAITING_GATE: readonly string[] = ["In review", "Waiting for Approver"];
const WORK_PHASES = PHASES.filter((p) => p !== "Completed" && p !== "Sunset");

export type Slice = { label: string; count: number; pct: number };
export type Meter = { label: string; count: number; value: number | null };
export type Insights = {
  active: number; needAttention: number; waitingForDecision: number;
  health: Slice[]; phases: Slice[]; quarters: Slice[]; build: Meter[];
  summary: { health: string; phases: string; quarters: string; build: string };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

/** "Q1 2027" sorts by year, then quarter; anything else sorts last by text. */
export function quarterKey(q: string): number {
  const m = /^Q([1-4]) (\d{4})$/.exec(q);
  return m ? Number(m[2]) * 10 + Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export function computeInsights(all: readonly InsightRow[], projectName: (id: string) => string): Insights {
  const rows = all.filter((r) => r.initiative_status === "Active");
  const total = rows.length;

  const hc = new Map<string, number>();
  for (const r of rows) { const h = (HEALTH_ORDER as readonly string[]).includes(String(r.health)) ? String(r.health) : "No health"; hc.set(h, (hc.get(h) ?? 0) + 1); }
  const health = HEALTH_ORDER.map((h) => ({ label: h, count: hc.get(h) ?? 0, pct: pct(hc.get(h) ?? 0, total) })).filter((s) => s.count > 0);
  const needAttention = rows.filter((r) => NEEDS_ATTENTION.includes(String(r.health))).length;

  const pc = new Map<string, number>();
  for (const r of rows) { const p = String(r.initiative_phase ?? ""); if (p) pc.set(p, (pc.get(p) ?? 0) + 1); }
  const phases = WORK_PHASES.map((p) => ({ label: p, count: pc.get(p) ?? 0, pct: pct(pc.get(p) ?? 0, total) }));

  const qc = new Map<string, number>();
  for (const r of rows) { const q = String(r.g2m_quarter ?? "") || "No quarter"; qc.set(q, (qc.get(q) ?? 0) + 1); }
  const quarters = [...qc.entries()].sort(([a], [b]) => (a === "No quarter" ? 1 : b === "No quarter" ? -1 : quarterKey(a) - quarterKey(b) || a.localeCompare(b)))
    .map(([label, count]) => ({ label, count, pct: pct(count, total) }));

  const byProject = new Map<string, number[]>();
  for (const r of rows) {
    if (r.initiative_phase !== "Build") continue;
    const list = byProject.get(r.home_project) ?? [];
    if (typeof r.delivery_progress_pct === "number") list.push(r.delivery_progress_pct);
    else list.push(NaN);
    byProject.set(r.home_project, list);
  }
  const build: Meter[] = [...byProject.entries()].map(([id, xs]) => {
    const known = xs.filter((x) => !Number.isNaN(x));
    return { label: projectName(id) || "No project", count: xs.length, value: known.length === 0 ? null : Math.round(known.reduce((a, b) => a + b, 0) / known.length) };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.label.localeCompare(b.label));

  const top = Math.max(0, ...phases.map((p) => p.count));
  const biggest = phases.filter((p) => top > 0 && p.count === top);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]!);
  const nextQuarter = quarters.find((q) => q.label !== "No quarter");
  return {
    active: total, needAttention, waitingForDecision: rows.filter((r) => WAITING_GATE.includes(String(r.gate_status))).length,
    health, phases, quarters, build,
    summary: {
      health: total === 0 ? "There are no active initiatives." : needAttention === 0 ? `All ${plural(total, "active initiative")} have no health concern.`
        : `${needAttention} of ${plural(total, "active initiative")} need attention: ${health.filter((h) => NEEDS_ATTENTION.includes(h.label)).map((h) => `${h.count} ${h.label}`).join(", ")}.`,
      phases: top === 0 ? "No active initiative has a phase yet."
        : biggest.length === 1 ? `Most active work is in ${biggest[0]!.label}: ${top} of ${total} (${biggest[0]!.pct}%).`
        : `The most active work is shared by ${list(biggest.map((p) => p.label))}: ${top} each, of ${total}.`,
      quarters: quarters.length === 0 ? "No active initiatives." : nextQuarter ? `${nextQuarter.label} is the nearest planned quarter with ${plural(nextQuarter.count, "initiative")}.${qc.get("No quarter") ? ` ${qc.get("No quarter")} have no planned quarter.` : ""}` : "No active initiative has a planned quarter.",
      build: build.length === 0 ? "No active initiative is in Build." : `${plural(build.reduce((s, b) => s + b.count, 0), "initiative")} in Build across ${plural(build.length, "project")}; progress comes from the tracker.`,
    },
  };
}
