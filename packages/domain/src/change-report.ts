import { ATTENTION_KINDS, attentionList } from "./attention";
import { dayNumber, daysInPhase } from "./roadmap-health";
import { nextOutcomeStep, type OutcomeReview } from "./outcome-reviews";
import { GATES, GATE_IDS, moveNeedsGate, phaseIndex, type GateId, type Phase } from "./gates";
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
  { id: "initiative-status", label: "Status", hint: "Initiative Status (Backlog, Active, On hold, Completed, Cancelled) changed.", initiative: true },
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
/** What a person can do about a flag, in one click. Always a suggestion: nothing happens until the person clicks, and the database applies the same rules as everywhere (a move that passes a decision gate is refused). */
/** What a flag suggests: move the phase, request a gate, go to the Decisions page, or open the initiative to fill a field in. */
export type ChangeFlagAction =
  | { type: "move"; to: Phase; label: string }
  | { type: "gate"; gate: GateId; label: string }
  | { type: "decisions"; label: string }
  | { type: "open"; label: string }
  /** Ask the Product Manager for the 30, 60 or 90 day outcome metrics (a notification; a person clicks, never Claude). */
  | { type: "outcome-request"; days: 30 | 60 | 90; label: string };
export type ChangeFlag = { kind: string; label: string; text: string; action?: ChangeFlagAction };
/** The Jira or GitHub issue an initiative is linked to: "R8P-7049" or "owner/repo#12", its title where known, and a link that opens it in the tracker. */
export type TrackerRef = { tracker: "Jira" | "GitHub"; key: string; title: string | null; url: string | null };
/** How a value reads in colour. Words always come with it (a colour is never the only signal). */
export type ChangeTone = "good" | "risk" | "bad" | "info" | "neutral";

/**
 * The colour of the value a change ended on. Health, Build Status, Initiative Status and the phase have a known meaning. A GitHub issue is good when closed,
 * info when open. A Jira status takes the colour of its category (`jiraCategoryTone`): Jira workflows name their statuses freely ("Project Accepted" counts as To Do), so a name is never guessed.
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
  /** The colour of the value the change started from (the same rules as `tone`). */
  fromTone: ChangeTone;
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
  /**
   * A tracker move sets two values in one step: the status of the linked issue and Build Status (which follows its status category). They are shown as ONE row: the
   * linked-issue status here, and the Build Status that went with it in this field. Null when no Build Status changed with it.
   */
  alsoBuild: { from: string | null; to: string | null; tone: ChangeTone } | null;
  /** The Jira user who moved the issue to this status, from Jira's own history (Jira rows only; null when not known yet). A name on a row, never counted per person (rule 8). */
  jiraUser: string | null;
};
/** A move of a Jira issue to a status with the Jira user who made it (table jira_status_changes). */
export type JiraStatusRecord = { issue_key: string; to_status: string; changed_at: string; actor_name: string | null };
/** Jira groups every status of a workflow into one of three categories; Product Velocity's Build Status follows it (new: Not started, indeterminate: In progress, done: Done). */
export type JiraCategory = "new" | "indeterminate" | "done";
/** The colour of a Jira status is the colour of its category, the same as the Build Status it maps to: grey, blue and green. A status name is never guessed. */
export const jiraCategoryTone = (c: JiraCategory | null | undefined): ChangeTone => (c === "done" ? "good" : c === "indeterminate" ? "info" : "neutral");
const CATEGORY_OF_BUILD: Readonly<Record<string, JiraCategory>> = { "not started": "new", "in progress": "indeterminate", done: "done" };

export type ChangeContext = {
  /** Status name to category, as Jira reports it for the linked issues now. */
  jiraCategories?: ReadonlyMap<string, JiraCategory>;
  flags?: ReadonlyMap<string, readonly ChangeFlag[]>;
  issues?: ReadonlyMap<string, TrackerRef>;
  nameOf?: (actorId: string | null) => string;
  jiraUsers?: readonly JiraStatusRecord[];
};
/** Product Velocity learns of a Jira change within seconds (webhook); the daily check may be hours later. A name is taken from a change Jira made up to this long before. */
const JIRA_LAG_AFTER_MS = 5_000;

/** The Jira user of a change to `toStatus` registered at `at`: the latest change to that status Jira made up to a few seconds before PV registered it. */
function jiraUserOf(records: readonly JiraStatusRecord[], key: string, toStatus: string | null, at: string): string | null {
  if (!toStatus) return null;
  const limit = Date.parse(at) + JIRA_LAG_AFTER_MS;
  let best: JiraStatusRecord | null = null;
  for (const r of records) {
    if (r.issue_key !== key || r.to_status !== toStatus || Date.parse(r.changed_at) > limit) continue;
    if (!best || r.changed_at > best.changed_at) best = r;
  }
  return best?.actor_name ?? null;
}

/**
 * The changes of the feed that belong to the initiatives in `items`, newest first, with where each came from and who is on it. A tracker move that set the status of the
 * linked issue and Build Status in the same step (the same initiative, the same registered time) is ONE row (issue #472, from R-72: eight rows for four Jira moves).
 */
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
      tone: changeTone(type, to, tracker), fromTone: changeTone(type, shown(r, r.old), tracker), source, sourceType: r.via, trackerDriven, actorId: r.actor_id, actor,
      by: trackerDriven && r.actor_id ? `Sync run by ${actor}` : actor, tracker, flags: [...(ctx.flags?.get(r.item_id) ?? [])], issue, alsoBuild: null,
      jiraUser: tracker === "Jira" && issue?.tracker === "Jira" ? jiraUserOf(ctx.jiraUsers ?? [], issue.key, to, r.at) : null,
    });
  }
  // one row for the two values a tracker move sets in one step
  const builds = new Map<string, ChangeRowData>();
  for (const r of rows) if (r.type === "build-status") builds.set(`${r.itemId}|${r.at}`, r);
  const merged = new Set<string>();
  for (const r of rows) {
    if (r.type !== "issue-status") continue;
    const b = builds.get(`${r.itemId}|${r.at}`);
    if (!b || merged.has(b.id)) continue;
    r.alsoBuild = { from: b.from, to: b.to, tone: b.tone };
    if (b.actorId && !r.actorId) { r.actorId = b.actorId; r.actor = b.actor; r.by = b.by; } // a person who pressed Sync is on the Build Status row
    r.sourceType = r.actorId && r.sourceType === "system" ? b.sourceType : r.sourceType;
    merged.add(b.id);
  }
  // Jira statuses take the colour of their category. Where Jira has not said (a status no linked issue is in now), the Build Status that moved with a change tells it:
  // a status that ended a move to Done is in the done category, and so on, and that holds for the same status in every other row.
  const category = new Map<string, JiraCategory>();
  for (const r of rows) if (r.tracker === "Jira" && r.alsoBuild?.to && r.to) { const c = CATEGORY_OF_BUILD[r.alsoBuild.to.toLowerCase()]; if (c) category.set(r.to, c); }
  for (const [k, v] of ctx.jiraCategories ?? []) category.set(k, v);
  for (const r of rows) if (r.tracker === "Jira") { r.tone = jiraCategoryTone(r.to ? category.get(r.to) : null); r.fromTone = jiraCategoryTone(r.from ? category.get(r.from) : null); }
  return rows.filter((r) => !merged.has(r.id)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.entryId - a.entryId));
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
  field === "type" ? (r.alsoBuild ? [r.type, "build-status"] : [r.type]) : field === "source" ? [r.source] : field === "sourceType" ? [r.sourceType] : field === "by" ? [r.actor] : r.flags.map((f) => f.kind);
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
  const hay = [r.code, r.name, r.from, r.to, r.alsoBuild?.from, r.alsoBuild?.to, changeTypeLabel(r.type), r.alsoBuild ? "build status" : null, r.source, r.sourceType, r.actor, r.jiraUser, r.issue?.key, r.issue?.title, ...r.flags.map((f) => f.label)].filter(Boolean).join(" \n ").toLowerCase();
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
const REPORT_FLAG_LABELS: Record<string, string> = {
  "tracker-done-open": "Tracker done, initiative open", "no-phase": "No phase set",
  "ready-gate-c": "Ready for Gate C", "outcome-due": "Outcome review due", "outcome-requested": "Outcome metrics requested", "gate-checklist": "Gate checklist incomplete", "hold-soon": "Hold review soon", "no-owner": "No Business Owner", "no-kr": "No key result",
};
/** Days in Experiment before the report suggests asking for Gate C. A default, like STALL_DAYS (docs/decisions/2026-11-19-more-flags-and-actions.md); the real length of an experiment is not on the item. */
export const EXPERIMENT_REVIEW_DAYS = 14;
/** A Hold's review date this close (days) shows as coming up, before the Needs attention "Hold due" takes over on the day. */
export const HOLD_SOON_DAYS = 7;
export const CHANGE_FLAG_LABELS: Readonly<Record<string, string>> = { ...Object.fromEntries(ATTENTION_KINDS.map((k) => [k.id, k.label])), ...REPORT_FLAG_LABELS };

/**
 * The flags to follow up in the Changes report, by initiative: every reason of Needs attention that can be worked out from the rows (`attentionList`), plus two
 * that only this report adds (issue #472, from the real data: almost every initiative pulled in from Jira has no Initiative Phase and no Initiative Status, so the
 * Needs attention rules that start from a phase cannot fire). **Tracker done, initiative open**: the tracker says the work is done (Build Status Done, or every linked
 * issue closed) but the initiative has no phase and is not Completed or Cancelled. **No phase set**: the tracker says the build is in progress but no phase is set.
 * Suggestions only; nothing changes by itself. The Needs attention page is unchanged.
 */
export function changeFlags(rows: readonly { id: string }[], today: Date, ctx: { outcomeReviews?: readonly OutcomeReview[] } = {}): Map<string, ChangeFlag[]> {
  const out = new Map<string, ChangeFlag[]>();
  for (const e of attentionList(rows as never, today)) out.set(e.id, e.reasons.map((r): ChangeFlag => ({ kind: r.kind, label: CHANGE_FLAG_LABELS[r.kind] ?? r.kind, text: r.text, ...(r.action?.type === "move" ? { action: { type: "move" as const, to: r.action.to, label: r.action.label } } : {}) })));
  for (const r of rows as readonly Record<string, unknown>[]) {
    if (!blank(r.initiative_phase) || r.initiative_status === "Completed" || r.initiative_status === "Cancelled") continue;
    const total = typeof r.issues_total === "number" ? r.issues_total : 0, closed = typeof r.issues_closed === "number" ? r.issues_closed : 0;
    const done = r.status === "Done" || (total > 0 && closed >= total);
    const add = (f: ChangeFlag) => out.set(String(r.id), [...(out.get(String(r.id)) ?? []), f]);
    if (done) add({ kind: "tracker-done-open", label: REPORT_FLAG_LABELS["tracker-done-open"]!, text: `The tracker says the work is done${total > 0 && closed >= total ? ` (all ${total} linked ${total === 1 ? "issue is" : "issues are"} closed)` : ""}, but the initiative has no phase and its status is ${blank(r.initiative_status) ? "not set" : String(r.initiative_status)}, not Completed.`, action: { type: "move", to: "Test", label: "Move to Test" } });
    else if (r.status === "In progress") add({ kind: "no-phase", label: REPORT_FLAG_LABELS["no-phase"]!, text: "The tracker says the build is in progress, but no Initiative Phase is set.", action: { type: "move", to: "Build", label: "Move to Build" } });
  }
  for (const [id, f] of moreFlags(rows as readonly Record<string, unknown>[], today)) out.set(id, [...(out.get(id) ?? []), ...f]);
  // the 30, 60 and 90 day outcome reviews: only when the reviews are known (a screen that did not load them shows no such flag rather than a wrong one)
  if (ctx.outcomeReviews) {
    const byItem = new Map<string, OutcomeReview[]>();
    for (const v of ctx.outcomeReviews) byItem.set(v.item_id, [...(byItem.get(v.item_id) ?? []), v]);
    for (const r of rows as readonly Record<string, unknown>[]) {
      const step = nextOutcomeStep(r, byItem.get(String(r.id)) ?? [], dayNumber(today));
      if (!step) continue;
      const f: ChangeFlag = step.kind === "request"
        ? { kind: "outcome-due", label: REPORT_FLAG_LABELS["outcome-due"]!, text: `The ${step.days} day outcome review ${step.overdueDays > 0 ? `was due on ${step.dueOn}` : `is due on ${step.dueOn}`}, counted from Start Roll-Out. Ask for the metrics.`, action: { type: "outcome-request", days: step.days, label: `Request ${step.days}-day metrics` } }
        : { kind: "outcome-requested", label: REPORT_FLAG_LABELS["outcome-requested"]!, text: `The ${step.days} day metrics were requested and are not recorded yet (due ${step.dueOn}).`, action: { type: "open", label: "Record metrics" } };
      out.set(String(r.id), [...(out.get(String(r.id)) ?? []), f]);
    }
  }
  return out;
}

const isoDay = (v: unknown) => (typeof v === "string" && v !== "" ? Math.round(Date.parse(`${v.slice(0, 10)}T00:00:00Z`) / 86_400_000) : NaN);

/**
 * Five more reasons to follow up, each with its next step (docs/decisions/2026-11-19-more-flags-and-actions.md). Only for initiatives still in play (not Completed,
 * Cancelled or Sunset). **Ready for Gate C**: in Experiment for EXPERIMENT_REVIEW_DAYS or more with no gate request open. **Gate checklist incomplete**: a gate was
 * requested and its checklist is not complete. **Hold review soon**: a Hold's review date is within HOLD_SOON_DAYS. **No Business Owner**: Active and past Define with no
 * owner. **No key result**: in Define, before Gate B, with no Primary KR. Suggestions only; everything is about the initiative, never a person (rule 8).
 */
function moreFlags(rows: readonly Record<string, unknown>[], today: Date): Map<string, ChangeFlag[]> {
  const out = new Map<string, ChangeFlag[]>();
  const todayNum = dayNumber(today);
  const phaseOrder = ["Discover", "Define", "Build", "Test", "Experiment", "Roll-out"];
  for (const r of rows) {
    const phase = typeof r.initiative_phase === "string" ? r.initiative_phase : null;
    if (r.initiative_status === "Completed" || r.initiative_status === "Cancelled" || phase === "Completed" || phase === "Sunset") continue;
    const add = (kind: string, text: string, action: ChangeFlagAction) => out.set(String(r.id), [...(out.get(String(r.id)) ?? []), { kind, label: REPORT_FLAG_LABELS[kind]!, text, action }]);
    const status = r.gate_status, gate = typeof r.current_gate === "string" ? r.current_gate : null;
    const asked = status === "In review" || status === "Waiting for Approver";
    if (phase === "Experiment" && !asked && status !== "Held") {
      const d = daysInPhase(r as never, todayNum);
      if (d !== null && d >= EXPERIMENT_REVIEW_DAYS) add("ready-gate-c", `In Experiment for ${d} days with no request for Gate C. If the experiment is done, ask for the decision to roll out.`, { type: "gate", gate: "C", label: "Request gate C" });
    }
    if (status === "In review") add("gate-checklist", `${gate ? `Gate ${gate}` : "The gate"} was requested but its checklist is not complete, so it is not yet with the approver as ready.`, { type: "decisions", label: "Open Decisions" });
    if (status === "Held") {
      const due = isoDay(r.next_gate_due);
      if (!Number.isNaN(due) && due > todayNum && due - todayNum <= HOLD_SOON_DAYS) add("hold-soon", `The Hold on this initiative is due for review in ${due - todayNum} ${due - todayNum === 1 ? "day" : "days"}.`, { type: "decisions", label: "Open Decisions" });
    }
    if (blank(r.sponsor) && phase !== null && phaseOrder.indexOf(phase) > phaseOrder.indexOf("Define")) add("no-owner", `The phase is ${phase}, but no Business Owner is set.`, { type: "open", label: "Assign owner" });
    if (phase === "Define" && blank(r.kr_metric)) add("no-kr", "The initiative is in Define with no Primary KR. Gate B asks for one.", { type: "open", label: "Add key result" });
  }
  return out;
}

// ------------------------------------------------------------------ doing something about a flag
/** The gate whose decision opens a phase: the last gate that opens that phase or an earlier one (Test: Gate B, which opens Build; the approver picks Test as a fast-lane target). */
export function gateForTarget(to: Phase): GateId | null {
  const found = GATE_IDS.filter((g) => phaseIndex(GATES[g].to) <= phaseIndex(to));
  return found.at(-1) ?? null;
}

export type ResolvedFlagAction =
  | { kind: "move"; to: Phase; label: string; title: string }
  | { kind: "gate"; gate: GateId; label: string; title: string }
  /** The gate was already requested and waits for a decision: the button becomes a link to the Decisions page, where the follow-up is. */
  | { kind: "requested"; gate: GateId; label: string; title: string; href: string }
  /** Go to the Decisions page (a checklist to finish, a Hold to review). */
  | { kind: "decisions"; label: string; title: string; href: string }
  /** Open the initiative so the person can fill a field in. */
  | { kind: "open"; label: string; title: string }
  /** Ask for the outcome metrics of a checkpoint; the screen calls the request and says what happened. */
  | { kind: "outcome-request"; days: 30 | 60 | 90; label: string; title: string };

/** The Decisions page, where a requested gate is followed up. */
export const DECISIONS_HREF = "/decisions";

/** The gate whose request is open on this row (asked and not yet decided), read from the row's own gate fields; null when none. */
export function openGateOf(item: object | null | undefined): GateId | null {
  const row = item as { current_gate?: unknown; gate_status?: unknown } | null | undefined;
  if (!row || (row.gate_status !== "In review" && row.gate_status !== "Waiting for Approver")) return null;
  return GATE_IDS.find((g) => g === row.current_gate) ?? null;
}

/**
 * What the button does for this initiative. A move that does not pass a decision gate is made at once (the same `move_phase` as the Roadmap and Needs attention). One that
 * does (a Jira initiative with no phase counts as Discover, so Test passes Gates A and B) opens the Request gate dialog with the gate that opens that phase, because the database
 * refuses the move and a button that is known to fail would only teach people to ignore it. The approver then decides, and may choose the phase as a fast-lane target.
 */
export function resolveFlagAction(action: ChangeFlagAction, phase: unknown, openGate: GateId | null = null): ResolvedFlagAction {
  if (action.type === "decisions") return { kind: "decisions", label: action.label, title: "Opens the Decisions page.", href: DECISIONS_HREF };
  if (action.type === "outcome-request") return { kind: "outcome-request", days: action.days, label: action.label, title: `Asks the Product Manager for the ${action.days} day metrics (they get a notification).` };
  if (action.type === "open") return { kind: "open", label: action.label, title: "Opens the initiative so you can fill this in." };
  if (action.type === "gate") {
    if (openGate) return { kind: "requested", gate: openGate, label: `Gate ${openGate} requested`, title: `Gate ${openGate} has been requested and waits for a decision. Opens the Decisions page.`, href: DECISIONS_HREF };
    return { kind: "gate", gate: action.gate, label: action.label, title: `Opens the request for Gate ${action.gate}. The approver decides.` };
  }
  const needs = moveNeedsGate(phase, action.to);
  if (!needs) return { kind: "move", to: action.to, label: action.label, title: `Moves the initiative to ${action.to} now. You can undo it from the initiative.` };
  const gate = gateForTarget(action.to) ?? needs;
  if (openGate) return { kind: "requested", gate: openGate, label: `Gate ${openGate} requested`, title: `Gate ${openGate} has been requested and waits for a decision. Opens the Decisions page.`, href: DECISIONS_HREF };
  return { kind: "gate", gate, label: `Request gate ${gate} (to ${action.to})`, title: `Moving to ${action.to} passes ${needs === gate ? `Gate ${gate}` : `Gate ${needs} and later`}, so it needs a decision. This opens the request; the approver can choose ${action.to} as the phase.` };
}

// ------------------------------------------------------------------ the Flags and Actions columns of the main grid (issue #480)
/** The flags of one initiative row of the main grid, from the same rules as the Changes report. Gate requests and open conditions are not on the row, so those two reasons are not here. */
export function flagsOfRow(row: object, today: Date, ctx: { outcomeReviews?: readonly OutcomeReview[] } = {}): ChangeFlag[] {
  return changeFlags([row as { id: string }], today, ctx).get(String((row as { id: unknown }).id)) ?? [];
}

/** One button of the Actions column: what it says, what it does and why (the tooltip). */
export type RowAction = { flag: ChangeFlag; resolved: ResolvedFlagAction };

/** The actions of a row, one per different button (two flags that suggest the same move give one button). Nobody who cannot edit gets any. */
export function actionsOfFlags(flags: readonly ChangeFlag[], phase: unknown, canAct: boolean, openGate: GateId | null = null): RowAction[] {
  if (!canAct) return [];
  const seen = new Set<string>(), out: RowAction[] = [];
  for (const flag of flags) {
    if (!flag.action) continue;
    const resolved = resolveFlagAction(flag.action, phase, openGate);
    if (seen.has(resolved.label)) continue;
    seen.add(resolved.label);
    out.push({ flag, resolved });
  }
  return out;
}

/** The words the grid stores on the row for the two columns, so sorting, searching and the export see what the cells show. */
export function rowFlagTexts(row: object, today: Date, canAct: boolean): { flags: string | null; actions: string | null } {
  const flags = flagsOfRow(row, today);
  const actions = actionsOfFlags(flags, (row as { initiative_phase?: unknown }).initiative_phase, canAct, openGateOf(row));
  return { flags: [...new Set(flags.map((f) => f.label))].join("; ") || null, actions: actions.map((a) => a.resolved.label).join("; ") || null };
}

/** The newest row of each initiative: it carries the actions, so an initiative with several changes has its buttons once. */
export function primaryRowIds(rows: readonly ChangeRowData[]): Set<string> {
  const seen = new Set<string>(), out = new Set<string>();
  for (const r of [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.entryId - a.entryId))) if (!seen.has(r.itemId)) { seen.add(r.itemId); out.add(r.id); }
  return out;
}
