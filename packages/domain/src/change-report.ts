import { ATTENTION_KINDS, attentionList } from "./attention";
import type { GroupBadge, GroupRow } from "./views";

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

// ------------------------------------------------------------------ the grid (issue #472, follow-up)
/** A reason to follow up on an initiative, taken from Needs attention (`attentionList`): the kind id, its label and the sentence. */
export type ChangeFlag = { kind: string; label: string; text: string };
/** The Jira or GitHub issue an initiative is linked to: "R8P-7049" or "owner/repo#12", its title where known, and a link that opens it in the tracker. */
export type TrackerRef = { tracker: "Jira" | "GitHub"; key: string; title: string | null; url: string | null };
export type ChangeGroupBy = "initiative" | "type" | "day" | "none";
export const CHANGE_GROUP_BYS: readonly { id: ChangeGroupBy; label: string }[] = [
  { id: "initiative", label: "Initiative" }, { id: "type", label: "Change type" }, { id: "day", label: "Day" }, { id: "none", label: "No grouping" },
];
/** How a value reads in colour. Words always come with it (a colour is never the only signal). */
export type ChangeTone = "good" | "risk" | "bad" | "info" | "neutral";

/**
 * The colour of the value a change ended on. Health, Build Status, Initiative Status and the phase have a known meaning. A GitHub issue is good when closed,
 * info when open. A Jira status is neutral: Jira workflows name their statuses freely ("Project Accepted" counts as To Do), so a name is never guessed.
 */
export function changeTone(type: ChangeType, to: string | null, tracker: "GitHub" | "Jira" | null = null): ChangeTone {
  const v = (to ?? "").toLowerCase();
  if (type === "health") return v === "on track" ? "good" : v === "at risk" ? "risk" : v === "delayed" || v === "blocked" ? "bad" : "neutral";
  if (type === "build-status") return v === "done" ? "good" : v === "in progress" ? "info" : v === "cancelled" ? "bad" : "neutral";
  if (type === "initiative-status") return v === "completed" ? "good" : v === "active" ? "info" : v === "on hold" ? "risk" : v === "cancelled" ? "bad" : "neutral";
  if (type === "phase") return v === "completed" ? "good" : v ? "info" : "neutral";
  return tracker === "GitHub" ? (v.startsWith("closed, not planned") ? "neutral" : v === "closed" ? "good" : v === "open" ? "info" : "neutral") : "neutral";
}

export type ChangeRowData = {
  kind: "change"; id: string; entryId: number; itemId: string; code: string; name: string; at: string; type: ChangeType;
  from: string | null; to: string | null; tone: ChangeTone; via: string; actorId: string | null; tracker: "GitHub" | "Jira" | null; flags: ChangeFlag[];
  /** The tracker issue behind a Build Status or linked-issue change: its key or number, its name where known and its link. */
  issue: TrackerRef | null;
};
/** A group header is the main grid's own `GroupRow` (one renderer, one look), with the unit "changes" and badges. */
export type ChangeHeaderData = GroupRow;
export type ChangeGridRow = ChangeRowData | ChangeHeaderData;
export const isChangeHeader = (r: unknown): r is ChangeHeaderData => typeof r === "object" && r !== null && (r as { __group?: boolean }).__group === true;

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/**
 * The rows of the Changes grid: flat change rows with, for a grouping, a header row before each group (our own, like the main grid: row grouping is
 * Enterprise only). Headers carry the count, the newest time, whether the initiative moved, and the follow-up flags. A collapsed group shows only its header.
 * `flags` are the reasons from Needs attention by initiative; `onlyFlagged` keeps the initiatives that have one.
 */
export function changeGridRows(
  groups: readonly ChangeGroup[], by: ChangeGroupBy, collapsed: ReadonlySet<string>, flags: ReadonlyMap<string, readonly ChangeFlag[]> = new Map(), onlyFlagged = false, issues: ReadonlyMap<string, TrackerRef> = new Map(),
): ChangeGridRow[] {
  const shown = onlyFlagged ? groups.filter((g) => (flags.get(g.itemId) ?? []).length > 0) : groups;
  const rows: ChangeRowData[] = shown.flatMap((g) => g.entries.map((e): ChangeRowData => ({
    kind: "change", id: `c${e.id}`, entryId: e.id, itemId: g.itemId, code: g.code, name: g.name, at: e.at, type: e.type, from: e.from, to: e.to,
    tone: changeTone(e.type, e.to, e.tracker), via: e.via, actorId: e.actorId, tracker: e.tracker, flags: [...(flags.get(g.itemId) ?? [])],
    issue: e.type === "build-status" || e.type === "issue-status" ? issues.get(g.itemId) ?? null : null,
  })));
  const newest = (a: ChangeRowData, b: ChangeRowData) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.entryId - a.entryId);
  if (by === "none") return rows.sort(newest);

  const header = (key: string, label: string, count: number, badges: GroupBadge[]): GroupRow =>
    ({ __group: true, id: `group:${key}`, key, label, count, collapsed: collapsed.has(key), level: 0, healthSummary: "", unit: count === 1 ? "change" : "changes", badges });
  const out: ChangeGridRow[] = [];
  if (by === "initiative") {
    const byItem = new Map<string, ChangeRowData[]>();
    for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
    for (const g of shown) { // already newest first
      const list = (byItem.get(g.itemId) ?? []).sort(newest), key = `initiative:${g.itemId}`;
      const badges: GroupBadge[] = [
        g.moved.length > 0 ? { text: `Initiative: ${g.moved.map(changeTypeLabel).join(", ")}`, tone: "info", title: "The initiative itself changed" } : { text: "Initiative unchanged", tone: "neutral", title: "Only the linked issues changed" },
        ...(g.trackerChanges > 0 ? [{ text: `${g.trackerChanges} linked-issue ${g.trackerChanges === 1 ? "change" : "changes"}`, tone: "neutral" as const }] : []),
        ...(flags.get(g.itemId) ?? []).map((f): GroupBadge => ({ text: `⚑ ${f.label}`, tone: "risk", title: f.text })),
      ];
      out.push(header(key, `${g.code} ${g.name}`, list.length, badges));
      if (!collapsed.has(key)) out.push(...list);
    }
    return out;
  }
  const keyOf = (r: ChangeRowData) => (by === "type" ? r.type : dayKey(r.at));
  const groupsOf = new Map<string, ChangeRowData[]>();
  for (const r of rows.sort(newest)) groupsOf.set(keyOf(r), [...(groupsOf.get(keyOf(r)) ?? []), r]);
  const keys = [...groupsOf.keys()].sort(by === "type" ? (a, b) => CHANGE_TYPES.findIndex((x) => x.id === a) - CHANGE_TYPES.findIndex((x) => x.id === b) : (a, b) => (a < b ? 1 : -1));
  for (const k of keys) {
    const list = groupsOf.get(k)!, key = `${by}:${k}`;
    out.push(header(key, by === "type" ? changeTypeLabel(k as ChangeType) : dayLabel(list[0]!.at), list.length, []));
    if (!collapsed.has(key)) out.push(...list);
  }
  return out;
}

// ------------------------------------------------------------------ flags of the report
const blank = (v: unknown) => v === null || v === undefined || v === "";
const REPORT_FLAG_LABELS: Record<string, string> = { "tracker-done-open": "Tracker done, initiative open", "no-phase": "No phase set" };
export const CHANGE_FLAG_LABELS: Readonly<Record<string, string>> = { ...Object.fromEntries(ATTENTION_KINDS.map((k) => [k.id, k.label])), ...REPORT_FLAG_LABELS };

/**
 * The flags to follow up in the Changes report, by initiative: every reason of Needs attention that can be worked out from the rows (`attentionList`), plus two
 * that only this report adds (issue #472, from the real data: almost every initiative pulled in from Jira has no Initiative Phase and no Initiative Status, so the
 * Needs attention rules that start from a phase cannot fire). **Tracker done, initiative open**: the tracker says the work is done (Build Status Done, or every linked
 * issue closed) but the initiative has no phase and is not Completed or Cancelled. **No phase set**: the tracker says the build is in progress but no phase is set.
 * Suggestions only; nothing changes by itself. The Needs attention page is unchanged.
 */
export function changeFlags(rows: readonly { id: string }[], today: Date): Map<string, ChangeFlag[]> {
  const out = new Map<string, ChangeFlag[]>();
  for (const e of attentionList(rows as never, today)) out.set(e.id, e.reasons.map((r) => ({ kind: r.kind, label: CHANGE_FLAG_LABELS[r.kind] ?? r.kind, text: r.text })));
  for (const r of rows as readonly Record<string, unknown>[]) {
    if (!blank(r.initiative_phase) || r.initiative_status === "Completed" || r.initiative_status === "Cancelled") continue;
    const total = typeof r.issues_total === "number" ? r.issues_total : 0, closed = typeof r.issues_closed === "number" ? r.issues_closed : 0;
    const done = r.status === "Done" || (total > 0 && closed >= total);
    const add = (f: ChangeFlag) => out.set(String(r.id), [...(out.get(String(r.id)) ?? []), f]);
    if (done) add({ kind: "tracker-done-open", label: REPORT_FLAG_LABELS["tracker-done-open"]!, text: `The tracker says the work is done${total > 0 && closed >= total ? ` (all ${total} linked ${total === 1 ? "issue is" : "issues are"} closed)` : ""}, but the initiative has no phase and its status is ${blank(r.initiative_status) ? "not set" : String(r.initiative_status)}, not Completed.` });
    else if (r.status === "In progress") add({ kind: "no-phase", label: REPORT_FLAG_LABELS["no-phase"]!, text: "The tracker says the build is in progress, but no Initiative Phase is set." });
  }
  return out;
}
