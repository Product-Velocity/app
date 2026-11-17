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

const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "string" ? v : JSON.stringify(v));

export function changeTypeOf(r: Pick<FeedRow, "entity" | "field">): ChangeType | null {
  if (r.entity === "items") return r.field === "initiative_phase" ? "phase" : r.field === "initiative_status" ? "initiative-status" : r.field === "health" ? "health" : r.field === "status" ? "build-status" : null;
  if ((r.entity === "item_jira_links" && r.field === "jira_status") || (r.entity === "item_github_links" && r.field === "gh_state")) return "issue-status";
  return null;
}

/** GitHub states are shown the way people say them. */
const GH: Record<string, string> = { open: "Open", closed_completed: "Closed", closed_not_planned: "Closed, not planned" };
const shown = (r: FeedRow, v: unknown) => (r.entity === "item_github_links" ? GH[String(v)] ?? text(v) : text(v));

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

// ------------------------------------------------------------------ rows of the grid (issue #472)
/** A flag to follow up on an initiative: the kind id, its label and the sentence. */
export type ChangeFlag = { kind: string; label: string; text: string };
/** The Jira or GitHub issue an initiative is linked to: "R8P-7049" or "owner/repo#12", its title where known, and a link that opens it in the tracker. */
export type TrackerRef = { tracker: "Jira" | "GitHub"; key: string; title: string | null; url: string | null };
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

/** Where the new value came from: Product Velocity, or the tracker of the initiative. "Tracker" only while the link of an initiative is not known. */
export type ChangeSource = "Product Velocity" | "Jira" | "GitHub" | "Tracker";
export const CHANGE_SOURCES: readonly ChangeSource[] = ["Product Velocity", "Jira", "GitHub", "Tracker"];

export type ChangeRowData = {
  kind: "change"; id: string; entryId: number; itemId: string; code: string; name: string; at: string; type: ChangeType;
  from: string | null; to: string | null; tone: ChangeTone;
  /** Where the value came from. Build Status and the status of a linked issue are set by the tracker, never by hand (rule 6). */
  source: ChangeSource;
  /** How it reached Product Velocity: UI, API, Claude MCP, GitHub webhook, import or system. */
  sourceType: string;
  /** Build Status and linked-issue status: the tracker's values. A person on the row only pressed Sync. */
  trackerDriven: boolean;
  actorId: string | null;
  /** Who is on the audit row: a name, or "the system". */
  actor: string;
  /** The words for the By column: for a tracker value "Sync run by Ana" (the tracker changed it, Ana refreshed it), else the name. */
  by: string;
  /** The tracker of the linked-issue row itself (Jira or GitHub), for its label and colour. */
  tracker: "GitHub" | "Jira" | null;
  flags: ChangeFlag[];
  /** The tracker issue behind a Build Status or linked-issue change: its key or number, its name where known and its link. */
  issue: TrackerRef | null;
};
export type ChangeContext = {
  flags?: ReadonlyMap<string, readonly ChangeFlag[]>;
  issues?: ReadonlyMap<string, TrackerRef>;
  nameOf?: (actorId: string | null) => string;
};

/** The changes of the feed that belong to the initiatives in `items`, newest first, with where each came from and who is on it. */
export function buildChangeRows(feed: readonly FeedRow[], items: ReadonlyMap<string, ItemInfo>, ctx: ChangeContext = {}): ChangeRowData[] {
  const nameOf = ctx.nameOf ?? ((id: string | null) => (id ? "someone" : "the system"));
  const rows: ChangeRowData[] = [];
  for (const r of feed) {
    const info = items.get(r.item_id);
    const type = changeTypeOf(r);
    if (!info || !type || text(r.old) === text(r.new)) continue;
    const trackerDriven = type === "build-status" || type === "issue-status";
    const issue = trackerDriven ? ctx.issues?.get(r.item_id) ?? null : null;
    const source: ChangeSource = r.entity === "item_jira_links" ? "Jira" : r.entity === "item_github_links" ? "GitHub"
      : type === "build-status" ? issue?.tracker ?? (r.via === "GitHub webhook" ? "GitHub" : "Tracker") : "Product Velocity";
    const tracker = r.entity === "item_jira_links" ? "Jira" : r.entity === "item_github_links" ? "GitHub" : null;
    const to = shown(r, r.new);
    const actor = nameOf(r.actor_id);
    rows.push({
      kind: "change", id: `c${r.id}`, entryId: Number(r.id), itemId: r.item_id, code: info.code, name: info.name, at: r.at, type, from: shown(r, r.old), to,
      tone: changeTone(type, to, tracker), source, sourceType: r.via, trackerDriven, actorId: r.actor_id, actor,
      by: trackerDriven && r.actor_id ? `Sync run by ${actor}` : actor, tracker, flags: [...(ctx.flags?.get(r.item_id) ?? [])], issue,
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.entryId - a.entryId));
}

// ------------------------------------------------------------------ filters, search and the columns' values
export type ChangeRuleField = "type" | "source" | "sourceType" | "by" | "flag";
export const CHANGE_RULE_FIELDS: readonly { id: ChangeRuleField; label: string }[] = [
  { id: "type", label: "Change type" }, { id: "source", label: "Source" }, { id: "sourceType", label: "Source type" }, { id: "by", label: "By" }, { id: "flag", label: "Flag" },
];
/** A rule matches any of its values; the rules together must all match (AND), like the custom rules of the Roadmap filter. */
export type ChangeRule = { field: ChangeRuleField; values: string[] };
export type ChangeQuick = "flagged" | "initiative" | "tracker";
export const CHANGE_QUICK: readonly { id: ChangeQuick; label: string; hint: string }[] = [
  { id: "flagged", label: "To follow up", hint: "Initiatives with a flag to follow up." },
  { id: "initiative", label: "Initiative moved", hint: "Phase, Status or Health of the initiative itself changed." },
  { id: "tracker", label: "Tracker changes", hint: "Build Status or the status of a linked issue changed." },
];
export type ChangeFilters = { quick: ChangeQuick[]; rules: ChangeRule[]; search: string };
export const NO_CHANGE_FILTERS: ChangeFilters = { quick: [], rules: [], search: "" };

const valuesOf = (r: ChangeRowData, field: ChangeRuleField): string[] =>
  field === "type" ? [r.type] : field === "source" ? [r.source] : field === "sourceType" ? [r.sourceType] : field === "by" ? [r.actor] : r.flags.map((f) => f.kind);
const isInitiativeType = (t: ChangeType) => CHANGE_TYPES.find((x) => x.id === t)!.initiative;

/** The label of a rule value: change types and flags have ids, the rest read as they are. */
export function changeValueLabel(field: ChangeRuleField, value: string, rows: readonly ChangeRowData[] = []): string {
  if (field === "type") return changeTypeLabel(value as ChangeType);
  if (field === "flag") return rows.flatMap((r) => r.flags).find((f) => f.kind === value)?.label ?? CHANGE_FLAG_LABELS[value] ?? value;
  return value;
}
/** The values a rule can take in these rows, in a sensible order. */
export function changeFieldChoices(rows: readonly ChangeRowData[], field: ChangeRuleField): { value: string; label: string }[] {
  const seen = [...new Set(rows.flatMap((r) => valuesOf(r, field)))];
  const order = (v: string) => (field === "type" ? CHANGE_TYPES.findIndex((x) => x.id === v) : field === "source" ? CHANGE_SOURCES.indexOf(v as ChangeSource) : 0);
  return seen.sort((a, b) => order(a) - order(b) || changeValueLabel(field, a, rows).localeCompare(changeValueLabel(field, b, rows))).map((value) => ({ value, label: changeValueLabel(field, value, rows) }));
}
export const changeFilterCount = (f: ChangeFilters) => f.quick.length + f.rules.filter((r) => r.values.length > 0).length;

export function matchesChangeSearch(r: ChangeRowData, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = [r.code, r.name, r.from, r.to, changeTypeLabel(r.type), r.source, r.sourceType, r.actor, r.issue?.key, r.issue?.title, ...r.flags.map((f) => f.label)].filter(Boolean).join(" \n ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function filterChangeRows(rows: readonly ChangeRowData[], f: ChangeFilters): ChangeRowData[] {
  return rows.filter((r) =>
    matchesChangeSearch(r, f.search)
    && f.quick.every((q) => (q === "flagged" ? r.flags.length > 0 : q === "initiative" ? isInitiativeType(r.type) : !isInitiativeType(r.type)))
    && f.rules.every((rule) => rule.values.length === 0 || valuesOf(r, rule.field).some((v) => rule.values.includes(v))));
}

// ------------------------------------------------------------------ grouping (our own header rows: row grouping is Enterprise only; the same GroupRow as the Roadmap grid)
export type ChangeHeaderData = GroupRow;
export type ChangeGridRow = ChangeRowData | ChangeHeaderData;
export const isChangeHeader = (r: unknown): r is ChangeHeaderData => typeof r === "object" && r !== null && (r as { __group?: boolean }).__group === true;

/** Groups are by initiative, change type, source, source type or day. Never by person: nothing is counted or ranked per person (rule 8). */
export type ChangeGroupBy = "initiative" | "type" | "source" | "sourceType" | "day";
export const CHANGE_GROUP_BYS: readonly { id: ChangeGroupBy; label: string }[] = [
  { id: "initiative", label: "Initiative" }, { id: "type", label: "Change type" }, { id: "source", label: "Source" }, { id: "sourceType", label: "Source type" }, { id: "day", label: "Day" },
];
/** "Initiative", "Initiative › Change type" or "None". */
export function changeGroupSummary(by: ChangeGroupBy | null, then: ChangeGroupBy | null): string {
  const name = (g: ChangeGroupBy) => CHANGE_GROUP_BYS.find((x) => x.id === g)!.label;
  return !by ? "None" : then && then !== by ? `${name(by)} › ${name(then)}` : name(by);
}

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const keyOf = (r: ChangeRowData, g: ChangeGroupBy) => (g === "initiative" ? r.itemId : g === "type" ? r.type : g === "source" ? r.source : g === "sourceType" ? r.sourceType : dayKey(r.at));
const newest = (a: ChangeRowData, b: ChangeRowData) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.entryId - a.entryId);

/**
 * The rows of the Changes grid: change rows with, for a grouping, a header row before each group (the Roadmap grid's own `GroupRow`; a collapsed group shows only its
 * header). Two levels at most. The header of an initiative says whether the initiative itself moved, how many linked-issue changes it has, and its flags.
 */
export function groupChangeRows(rows: readonly ChangeRowData[], by: ChangeGroupBy | null, then: ChangeGroupBy | null, collapsed: ReadonlySet<string>): ChangeGridRow[] {
  const first = by ?? then;
  const second = by && then && then !== by ? then : null;
  if (!first) return [...rows].sort(newest);
  const out: ChangeGridRow[] = [];
  const walk = (list: ChangeRowData[], g: ChangeGroupBy, level: 0 | 1, parent: string) => {
    const buckets = new Map<string, ChangeRowData[]>();
    for (const r of list) buckets.set(keyOf(r, g), [...(buckets.get(keyOf(r, g)) ?? []), r]);
    const latest = (rs: ChangeRowData[]) => rs.reduce((m, r) => (r.at > m ? r.at : m), "");
    const keys = [...buckets.keys()].sort((a, b) =>
      g === "type" ? CHANGE_TYPES.findIndex((x) => x.id === a) - CHANGE_TYPES.findIndex((x) => x.id === b)
      : g === "source" ? CHANGE_SOURCES.indexOf(a as ChangeSource) - CHANGE_SOURCES.indexOf(b as ChangeSource)
      : g === "sourceType" ? a.localeCompare(b)
      : g === "day" ? (a < b ? 1 : -1)
      : (latest(buckets.get(a)!) < latest(buckets.get(b)!) ? 1 : latest(buckets.get(a)!) > latest(buckets.get(b)!) ? -1 : buckets.get(a)![0]!.code.localeCompare(buckets.get(b)![0]!.code)));
    for (const k of keys) {
      const rs = buckets.get(k)!.sort(newest), r0 = rs[0]!;
      const key = `${parent}${g}:${k}`;
      const label = g === "initiative" ? `${r0.code} ${r0.name}` : g === "type" ? changeTypeLabel(r0.type) : g === "day" ? dayLabel(r0.at) : k;
      const badges: GroupBadge[] = [];
      if (g === "initiative") {
        const moved = CHANGE_TYPES.filter((t) => t.initiative && rs.some((r) => r.type === t.id));
        const tracker = rs.filter((r) => !isInitiativeType(r.type)).length;
        badges.push(moved.length > 0 ? { text: `Initiative: ${moved.map((t) => t.label).join(", ")}`, tone: "info", title: "The initiative itself changed" } : { text: "Initiative unchanged", tone: "neutral", title: "Only the linked issues changed" });
        if (tracker > 0) badges.push({ text: `${tracker} linked-issue ${tracker === 1 ? "change" : "changes"}`, tone: "neutral" });
        for (const f of r0.flags) badges.push({ text: `⚑ ${f.label}`, tone: "risk", title: f.text });
      }
      out.push({ __group: true, id: `group:${key}`, key, label, count: rs.length, collapsed: collapsed.has(key), level, healthSummary: "", unit: rs.length === 1 ? "change" : "changes", badges });
      if (collapsed.has(key)) continue;
      if (level === 0 && second) walk(rs, second, 1, `${key}>`);
      else out.push(...rs);
    }
  };
  walk([...rows], first, 0, "");
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
