/**
 * Changes report (issue #472): what changed on which initiative in a period, grouped by initiative, with the time Product Velocity registered it,
 * the source and the actor, and whether the initiative itself moved (phase, status, health) next to the status changes of its linked issues.
 * Pure rules over the rows of the database function change_feed. Rows are about initiatives; actors are shown on a row, but nothing is counted,
 * ranked or charted per person (CLAUDE.md rule 8).
 */
export type ChangeType = "phase" | "initiative-status" | "health" | "build-status" | "issue-status";

export const CHANGE_TYPES: readonly { id: ChangeType; label: string; hint: string; initiative: boolean }[] = [
  { id: "phase", label: "Phase", hint: "Initiative Phase changed.", initiative: true },
  { id: "initiative-status", label: "Status", hint: "Initiative Status (Active, On hold, Completed, Cancelled) changed.", initiative: true },
  { id: "health", label: "Health", hint: "Health changed.", initiative: true },
  { id: "build-status", label: "Build status", hint: "Build Status changed (set by the tracker, never by hand).", initiative: false },
  { id: "issue-status", label: "Linked issue", hint: "The status of the linked GitHub or Jira issue changed.", initiative: false },
];
export const changeTypeLabel = (t: ChangeType) => CHANGE_TYPES.find((x) => x.id === t)?.label ?? t;

/** A row of change_feed. */
export type FeedRow = { id: number | string; item_id: string; entity: string; field: string; old: unknown; new: unknown; at: string; actor_id: string | null; via: string };
export type ItemInfo = { code: string; name: string; rank: number };

export type ChangeEntry = { id: number; at: string; type: ChangeType; from: string | null; to: string | null; via: string; actorId: string | null; tracker: "GitHub" | "Jira" | null };
export type ChangeGroup = {
  itemId: string; code: string; name: string; rank: number;
  /** The newest change shown. */
  latest: string;
  /** The initiative itself moved: which of phase, status and health changed. */
  moved: ChangeType[];
  /** Number of changes of linked issues (build status and issue status). */
  trackerChanges: number;
  entries: ChangeEntry[];
};

const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "string" ? v : JSON.stringify(v));

export function changeTypeOf(r: Pick<FeedRow, "entity" | "field">): ChangeType | null {
  if (r.entity === "items") return r.field === "initiative_phase" ? "phase" : r.field === "initiative_status" ? "initiative-status" : r.field === "health" ? "health" : r.field === "status" ? "build-status" : null;
  if ((r.entity === "item_jira_links" && r.field === "jira_status") || (r.entity === "item_github_links" && r.field === "gh_state")) return "issue-status";
  return null;
}

/** GitHub states are shown the way people say them. */
const GH: Record<string, string> = { open: "Open", closed_completed: "Closed", closed_not_planned: "Closed, not planned" };
const shown = (r: FeedRow, v: unknown) => (r.entity === "item_github_links" ? GH[String(v)] ?? text(v) : text(v));

/**
 * Groups the feed by initiative. Only initiatives in `items` are shown (so the filters of the Reports tab apply); only the chosen types are kept
 * (all when `types` is empty). Groups are newest first, and the entries of a group are newest first.
 */
export function changeReport(rows: readonly FeedRow[], items: ReadonlyMap<string, ItemInfo>, types: readonly ChangeType[] = []): ChangeGroup[] {
  const want = new Set<ChangeType>(types);
  const groups = new Map<string, ChangeGroup>();
  for (const r of rows) {
    const info = items.get(r.item_id);
    const type = changeTypeOf(r);
    if (!info || !type || (want.size > 0 && !want.has(type))) continue;
    if (text(r.old) === text(r.new)) continue;
    let g = groups.get(r.item_id);
    if (!g) groups.set(r.item_id, (g = { itemId: r.item_id, code: info.code, name: info.name, rank: info.rank, latest: r.at, moved: [], trackerChanges: 0, entries: [] }));
    g.entries.push({ id: Number(r.id), at: r.at, type, from: shown(r, r.old), to: shown(r, r.new), via: r.via, actorId: r.actor_id, tracker: r.entity === "item_jira_links" ? "Jira" : r.entity === "item_github_links" ? "GitHub" : null });
    if (r.at > g.latest) g.latest = r.at;
    if (CHANGE_TYPES.find((x) => x.id === type)!.initiative) { if (!g.moved.includes(type)) g.moved.push(type); } else g.trackerChanges++;
  }
  const order = (t: ChangeType) => CHANGE_TYPES.findIndex((x) => x.id === t);
  for (const g of groups.values()) {
    g.entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
    g.moved.sort((a, b) => order(a) - order(b));
  }
  return [...groups.values()].sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : a.rank - b.rank));
}

/** How many entries each type has in the feed (for the filter chips), counting only initiatives in `items`. */
export function changeCounts(rows: readonly FeedRow[], items: ReadonlyMap<string, ItemInfo>): Record<ChangeType, number> {
  const c = Object.fromEntries(CHANGE_TYPES.map((t) => [t.id, 0])) as Record<ChangeType, number>;
  for (const r of rows) { const t = changeTypeOf(r); if (t && items.has(r.item_id) && text(r.old) !== text(r.new)) c[t]++; }
  return c;
}

// ------------------------------------------------------------------ periods
export type ChangePeriod = "today" | "week" | "month";
export const CHANGE_PERIODS: readonly { id: ChangePeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
];
/** The period as [from, to) in the viewer's own time zone: today, the week from Monday, the calendar month. `to` is the start of the next day, so a change made a minute ago is in. */
export function changePeriod(period: ChangePeriod, now: Date): { from: Date; to: Date } {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  if (period === "today") return { from: day, to };
  if (period === "week") return { from: new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7)), to };
  return { from: new Date(day.getFullYear(), day.getMonth(), 1), to };
}
