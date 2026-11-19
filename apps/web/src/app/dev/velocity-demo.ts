import type { GateRequest } from "@pv/domain";
import type { Lookups } from "@/features/portfolio/types";
import { harnessLookups } from "./harness-data";

/**
 * Fictional data for the Velocity report test page (/dev/reports?report=velocity&demo=velocity): about 150 initiatives of a made-up media company
 * with discovery starting between 14 months and 3 weeks before today (14 Apr 2027), real-looking journeys through the gates and phases, and a few
 * that stalled in a queue. Deterministic, so a test and a screenshot see the same numbers.
 */
export const velocityLookups: Lookups = {
  ...harnessLookups,
  teams: ["Core", "Mobile", "Platform", "Data & AI", "Growth"].map((name, i) => ({ id: `t${i + 1}`, name })),
};

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const SIZES = ["XS", "S", "M", "L", "XL"], SIZE_F = [0.6, 0.8, 1, 1.3, 1.7], SIZE_W = [0.1, 0.28, 0.32, 0.22, 0.08], BUILD_WEEKS = [1.5, 3, 6, 11, 18];
const TEAMS: Record<string, number> = { Core: 1, Mobile: 0.85, Platform: 1.3, "Data & AI": 1.1, Growth: 0.8 };
const OBJECTIVES: Record<string, [string, number][]> = {
  "Grow subscription revenue": [["Paid subscribers +15%", 1], ["Trial-to-paid conversion 22%", 0.95]],
  "Cut cost to serve": [["Support tickets -30%", 1.4], ["Cloud cost per stream -20%", 1.15]],
  "Raise reliability": [["Playback uptime 99.95%", 1.05], ["App crash rate under 0.3%", 0.9]],
};
const BUSINESS_LINES: Record<string, number> = { News: 1, Streaming: 1.05, Advertising: 1.2, Studios: 0.9 };
const GROUPS = ["Onboarding", "Platform health", "Retention"], FOCUS = ["Subscriptions", "Content discovery", "Advertising", "Infrastructure", "Creator tools"];

type Row = Record<string, unknown> & { id: string };

/**
 * `buildOnly` looks like a workspace filled by a Jira pull-in: no Start Discovery, no size, team, group or Key Result, only Start Building (and the build time once the
 * build is done), and Gate B decisions that were requested and decided on the same day.
 */
export function applyVelocityDemo(rows: Row[], today: Date, buildOnly = false): GateRequest[] {
  const R = rng(20271404);
  const gauss = () => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); };
  const logn = (m: number, s: number) => m * Math.exp(s * gauss());
  const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  const weighted = (w: number[]) => { let r = R(), i = 0; while (i < w.length - 1 && r > w[i]!) { r -= w[i]!; i++; } return i; };
  const t0 = Math.round(today.getTime() / 86_400_000);
  const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
  const quarter = (d: number) => { const s = iso(d); return `Q${Math.floor((Number(s.slice(5, 7)) - 1) / 3) + 1} ${s.slice(0, 4)}`; };
  const requests: GateRequest[] = [];
  const first = t0 - 420;
  rows.forEach((r, i) => {
    const si = weighted(SIZE_W), team = pick(Object.keys(TEAMS)), objective = pick(Object.keys(OBJECTIVES)), kr = pick(OBJECTIVES[objective]!), bl = pick(Object.keys(BUSINESS_LINES));
    const stall = i % 29 === 7;
    const start = stall ? first + Math.floor(R() * 150) : first + Math.floor(R() * (t0 - first - 25));
    const trend = 1.18 - 0.34 * ((start - first) / (t0 - first));
    const discover = Math.max(4, logn(22 * SIZE_F[si]! ** 0.3, 0.45)), waitA = Math.max(1, logn(5, 0.7) * (R() < 0.08 ? 3 : 1));
    const define = Math.max(5, logn(18 * SIZE_F[si]! ** 0.4, 0.4)), waitB = Math.max(1, logn(8, 0.6) * (R() < 0.1 ? 3.6 : 1) * (bl === "Advertising" ? 1.35 : 1));
    const queue = Math.max(1, logn(10, 0.7) * (team === "Platform" ? 1.9 : 1)) * (stall ? 14 : 1);
    const build = Math.max(5, BUILD_WEEKS[si]! * 7 * TEAMS[team]! * kr[1] * BUSINESS_LINES[bl]! * trend * Math.exp(0.33 * gauss()));
    const test = Math.max(2, logn(7 + si * 3, 0.4)), skip = R() < 0.3, experiment = skip ? 0 : Math.max(7, logn(18, 0.4)), waitC = Math.max(1, logn(6, 0.6) * (R() < 0.08 ? 3 : 1)), launch = Math.floor(R() * 9);
    const m: Record<string, number> = { start };
    m.aReq = start + Math.round(discover); m.a = m.aReq! + Math.round(waitA); m.bReq = m.a + Math.round(define); m.b = m.bReq + Math.round(waitB);
    m.build = m.b + Math.round(queue); m.test = m.build + Math.round(build); m.exp = m.test + Math.round(test); m.cReq = m.exp + Math.round(experiment); m.c = m.cReq + Math.round(waitC); m.roll = m.c + launch;
    const reached = (d: number) => d <= t0;
    const status = reached(m.roll!) ? (m.roll! + 60 <= t0 && i % 5 !== 0 ? "Completed" : "Active") : i % 11 === 3 ? "On hold" : i % 17 === 5 ? "Cancelled" : "Active";
    const buildDays = m.test! - m.build!;
    Object.assign(r, {
      effort: SIZES[si], contributing_teams: i % 9 === 0 ? `${team}, ${team === "Core" ? "Mobile" : "Core"}` : team, okr_objective: objective, kr_metric: kr[0], business_line: bl,
      theme: GROUPS[(i * 7) % 3], focus_area: FOCUS[(i * 3) % 5], initiative_status: status, archived: false, g2m_quarter: quarter(m.roll! + ((i * 7) % 61) - 25),
      start_discovery: iso(start), start_date: null, start_definition: reached(m.a!) ? iso(m.a!) : null, start_building: reached(m.build!) ? iso(m.build!) : null,
      start_beta: reached(m.test!) ? iso(m.test!) : null, start_experiment: reached(m.exp!) && !skip ? iso(m.exp!) : null, start_rollout: reached(m.roll!) ? iso(m.roll!) : null,
      g2m_date_actual: null, time_building_days: reached(m.test!) ? buildDays : null, actual_build_weeks: reached(m.test!) ? Math.round((buildDays / 7) * 10) / 10 : null,
      initiative_phase: reached(m.roll!) ? "Roll-out" : reached(m.exp!) ? "Experiment" : reached(m.test!) ? "Test" : reached(m.build!) ? "Build" : reached(m.a!) ? "Define" : "Discover",
    });
    const outcome = () => (["go", "go_with_conditions", "hold", "stop"] as const)[weighted([0.7, 0.17, 0.09, 0.04])]!;
    for (const [gate, req, dec] of [["A", "aReq", "a"], ["B", "bReq", "b"], ["C", "cReq", "c"]] as const) {
      if (!reached(m[req]!)) continue;
      const decided = reached(m[dec]!);
      requests.push({
        id: `g-${i}-${gate}`, item_id: r.id, gate, kind: "decision", requested_by: null, requested_at: `${iso(m[req]!)}T09:00:00Z`, preferred_approvers: [], ready: true, criteria: [],
        outcome: decided ? outcome() : null, rationale: decided ? "ok" : null, fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: decided ? `${iso(m[dec]!)}T09:00:00Z` : null, withdrawn_at: null,
      });
      // the decision that moved the initiative on is always a pass, so the journey has its dates
      if (decided) requests[requests.length - 1]!.outcome = i % 4 === 0 ? "go_with_conditions" : "go";
    }
  });
  if (!buildOnly) return requests;
  for (const r of rows) {
    Object.assign(r, { start_discovery: null, start_date: null, start_definition: null, start_beta: null, start_experiment: null, start_rollout: null, effort: null, contributing_teams: null, theme: null, focus_area: null, kr_metric: null, okr_objective: null, business_line: null });
  }
  return requests.filter((q) => q.gate === "B" && q.decided_at).map((q) => ({ ...q, requested_at: q.decided_at!, outcome: "go" as const }));
}
