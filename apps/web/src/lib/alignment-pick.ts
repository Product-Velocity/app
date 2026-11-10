import { compareQuarters } from "@pv/domain";
import { NO_QUARTER } from "@/lib/alignment-list";

/** An initiative the "New session" picker can offer (issue #392). */
export type Initiative = {
  id: string; code: string; name: string; project: string;
  /** Initiative Phase. */
  phase: string | null;
  /** MoSCoW: Must, Should, Could or Won't. */
  moscow: string | null;
  /** Planned Quarter, such as "Q1 2027". */
  quarter: string | null;
  /** Ready for Build is "Ready" (set at Gate B). */
  ready: boolean;
};

/**
 * The stages people pick initiatives by (Ashu, 2026-11-10): Discover, the PRD (an initiative in Define is writing it) and Ready for build.
 * Choosing several shows the initiatives that are in any of them.
 */
export const STAGES = [
  { id: "discover", label: "Discover", match: (i: Initiative) => i.phase === "Discover" },
  { id: "prd", label: "PRD (Define)", match: (i: Initiative) => i.phase === "Define" },
  { id: "ready", label: "Ready for build", match: (i: Initiative) => i.ready },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export const MOSCOW_VALUES = ["Must", "Should", "Could", "Won't"] as const;
export const NOT_SET = "Not set";

export type PickFilters = { q: string; project: string; quarter: string; moscow: string; stages: StageId[] };
export const NO_PICK_FILTERS: PickFilters = { q: "", project: "", quarter: "", moscow: "", stages: [] };

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** The initiatives that match every filter. The stages are an "or"; everything else is an "and". */
export function filterInitiatives(list: Initiative[], f: PickFilters): Initiative[] {
  const w = words(f.q);
  const stages = STAGES.filter((s) => f.stages.includes(s.id));
  return list.filter((i) => {
    if (f.project && i.project !== f.project) return false;
    if (f.quarter && (f.quarter === NO_QUARTER ? i.quarter !== null : i.quarter !== f.quarter)) return false;
    if (f.moscow && (f.moscow === NOT_SET ? i.moscow !== null : i.moscow !== f.moscow)) return false;
    if (stages.length > 0 && !stages.some((s) => s.match(i))) return false;
    if (w.length > 0 && !w.every((x) => `${i.code} ${i.name}`.toLowerCase().includes(x))) return false;
    return true;
  });
}

/** The planned quarters the initiatives have, oldest first, with "No planned quarter" last when some have none. */
export function pickerQuarters(list: Initiative[]): string[] {
  const real = [...new Set(list.map((i) => i.quarter).filter((q): q is string => !!q))].sort(compareQuarters);
  return list.some((i) => i.quarter === null) ? [...real, NO_QUARTER] : real;
}

/** How many of the initiatives each stage matches, for the chips. */
export const stageCounts = (list: Initiative[]): Record<StageId, number> =>
  Object.fromEntries(STAGES.map((s) => [s.id, list.filter(s.match).length])) as Record<StageId, number>;
