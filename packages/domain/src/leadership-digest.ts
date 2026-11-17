import type { ChangeFlag, ChangeType, FeedRow, TrackerRef } from "./change-report";
import { phaseIndex } from "./gates";
import type { Move } from "./leadership";

/**
 * The leadership digest (request: "a C level update how things are moving over the time period"): the net outcome per initiative from the change feed,
 * not a list of every step. An initiative that went In progress, Done, In progress, Done in one day is one line: first value to last value, and nothing at all
 * when it ended where it started (the rule rank already used). Phase moves are named as moves ("from Build to Test"); Completed is its own group; the status of
 * the tracker's issue (Jira or GitHub) is told apart from Product Velocity's Build Status; new documents and files are named. Every initiative, tracker ticket and
 * document is a link, so the text can be pasted into an email. Nothing is counted or named per person (CLAUDE.md rule 8). Pure logic.
 */
export type DigestPart = { text: string; /** Where it goes in an email or on the page. */ href?: string; /** The initiative it opens in the side panel on the page. */ item?: string };
export type DigestLine = DigestPart[];
export type DigestGroupId = "completed" | "phase" | "health" | "priority" | "build" | "documents" | "followup";
export type DigestGroup = { id: DigestGroupId; title: string; lines: DigestLine[] };
export type Digest = { headline: string; groups: DigestGroup[]; /** Ids of the initiatives the digest talks about. */ itemIds: string[] };

export type DigestRow = { id: string; item_code: string; initiative_name: string; stack_rank: number };
/** A written document, an uploaded file or a link added to an initiative in the period (titles and names only, never the text). */
export type NewDocument = { id: string; itemId: string; entry: "document" | "file" | "link"; title: string; /** The document type (PRD, Research ...) where there is one. */ kind: string | null; aiDraft: boolean; at: string };

export type DigestInput = {
  feed: readonly FeedRow[];
  rows: readonly DigestRow[];
  trackers: ReadonlyMap<string, TrackerRef>;
  documents: readonly NewDocument[];
  rankMoves: readonly Move[];
  flags: ReadonlyMap<string, readonly ChangeFlag[]>;
  /** "this week", "this month" ... for the headline. */
  periodLabel: string;
  /** Absolute links, so a paste into an email still works. */
  itemHref: (code: string) => string;
  documentHref: (code: string, doc: Pick<NewDocument, "id" | "entry">) => string;
  changesHref: string;
  /** Lines per group before "and N more" (default 6). */
  limit?: number;
};

/** The kind of a feed row (the same rule as `changeTypeOf` in change-report.ts, which this file must not import at run time: it would make a cycle through attention.ts). */
function changeTypeOf(r: Pick<FeedRow, "entity" | "field">): ChangeType | null {
  if (r.entity === "items") return r.field === "initiative_phase" ? "phase" : r.field === "initiative_status" ? "initiative-status" : r.field === "health" ? "health" : r.field === "status" ? "build-status" : null;
  if ((r.entity === "item_jira_links" && r.field === "jira_status") || (r.entity === "item_github_links" && r.field === "gh_state")) return "issue-status";
  return null;
}

const GH: Record<string, string> = { open: "Open", closed_completed: "Closed", closed_not_planned: "Closed, not planned" };
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "string" ? v : JSON.stringify(v));
const HEALTH_RANK: Record<string, number> = { "On Track": 0, "At Risk": 1, "Delayed": 2, "Blocked": 3 };
const DOC_TYPE: Record<string, string> = { prd: "PRD", business_req: "Business requirements", tech_req: "Technical requirements", acceptance: "Acceptance criteria", prototype: "Prototype", research: "Research", other: "Document" };

type Net = { from: string | null; to: string | null; at: string };
/** First old value to last new value per initiative (and per linked issue); nothing when it ended where it started. */
function nets(feed: readonly FeedRow[], keep: (r: FeedRow) => boolean, key: (r: FeedRow) => string, show: (r: FeedRow, v: unknown) => string | null): Map<string, Net & { itemId: string; entity: string }> {
  const sorted = feed.filter(keep).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : Number(a.id) - Number(b.id)));
  const out = new Map<string, Net & { itemId: string; entity: string }>();
  for (const r of sorted) {
    const k = key(r);
    const have = out.get(k);
    if (have) { have.to = show(r, r.new); have.at = r.at; } else out.set(k, { itemId: r.item_id, entity: r.entity, from: show(r, r.old), to: show(r, r.new), at: r.at });
  }
  for (const [k, n] of out) if (n.from === n.to) out.delete(k);
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clean = (s: string) => s.replace(/[[\]]/g, "");

export function buildDigest(input: DigestInput): Digest {
  const { feed, rows, trackers, documents, rankMoves, flags, periodLabel, itemHref, documentHref, changesHref } = input;
  const limit = input.limit ?? 6;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ref = (id: string): DigestPart => { const r = byId.get(id)!; return { text: clean(`${r.item_code} ${r.initiative_name}`), href: itemHref(r.item_code), item: id }; };
  const rankOf = (id: string) => byId.get(id)?.stack_rank ?? 1e9;
  const inScope = (r: FeedRow) => byId.has(r.item_id);
  const touched = new Set<string>();
  const groups: DigestGroup[] = [];
  const counts: Record<string, number> = {};
  const add = (id: DigestGroupId, title: string, entries: { id: string; line: DigestLine }[]) => {
    if (entries.length === 0) return;
    counts[id] = entries.length;
    for (const e of entries) touched.add(e.id);
    const lines = entries.slice(0, limit).map((e) => e.line);
    if (entries.length > limit) lines.push([{ text: `and ${entries.length - limit} more in the Changes report`, href: changesHref }]);
    groups.push({ id, title, lines });
  };

  // ---- phase: Completed on its own, the other moves named from and to
  const phases = nets(feed, (r) => inScope(r) && changeTypeOf(r) === "phase", (r) => r.item_id, (_r, v) => str(v));
  const phaseList = [...phases.values()];
  add("completed", "Completed", phaseList.filter((n) => n.to === "Completed")
    .sort((a, b) => rankOf(a.itemId) - rankOf(b.itemId))
    .map((n) => ({ id: n.itemId, line: [ref(n.itemId), { text: n.from ? ` was completed (it moved from ${n.from} to Completed).` : " was completed." }] })));
  add("phase", "Phase moves", phaseList.filter((n) => n.to !== "Completed" && n.to !== null)
    .sort((a, b) => phaseIndex(b.to) - phaseIndex(a.to) || rankOf(a.itemId) - rankOf(b.itemId))
    .map((n) => {
      const back = n.from !== null && phaseIndex(n.to) < phaseIndex(n.from);
      return { id: n.itemId, line: [ref(n.itemId), { text: n.from === null ? ` entered ${n.to}.` : ` moved ${back ? "back " : ""}from ${n.from} to ${n.to}.` }] };
    }));

  // ---- health: worse first, then better
  const health = [...nets(feed, (r) => inScope(r) && changeTypeOf(r) === "health", (r) => r.item_id, (_r, v) => str(v)).values()];
  const worse = (n: Net) => (HEALTH_RANK[n.to ?? ""] ?? -1) - (HEALTH_RANK[n.from ?? ""] ?? -1);
  add("health", "Health", health.filter((n) => n.to !== null).sort((a, b) => worse(b) - worse(a) || rankOf(a.itemId) - rankOf(b.itemId))
    .map((n) => ({ id: n.itemId, line: [ref(n.itemId), { text: n.from === null ? ` health set to ${n.to}.` : ` health is now ${n.to} (was ${n.from}).` }] })));

  // ---- priority: the biggest net rank moves
  add("priority", "Priority", rankMoves.filter((m) => m.kind === "rank" && byId.has(m.itemId) && m.from !== undefined && m.to !== undefined)
    .sort((a, b) => Math.abs(b.from! - b.to!) - Math.abs(a.from! - a.to!) || rankOf(a.itemId) - rankOf(b.itemId))
    .map((m) => { const n = Math.abs(m.from! - m.to!); return { id: m.itemId, line: [ref(m.itemId), { text: ` moved ${m.to! < m.from! ? "up" : "down"} ${plural(n, "place", "places")} (#${m.from} to #${m.to}).` }] }; }));

  // ---- the tracker: what Jira or GitHub says, told apart from Product Velocity's Build Status
  const issue = nets(feed, (r) => inScope(r) && changeTypeOf(r) === "issue-status", (r) => `${r.item_id}|${r.entity}`, (r, v) => (r.entity === "item_github_links" ? GH[String(v)] ?? str(v) : str(v)));
  const build = nets(feed, (r) => inScope(r) && changeTypeOf(r) === "build-status", (r) => r.item_id, (_r, v) => str(v));
  const trackerItems = new Set<string>([...[...issue.values()].map((n) => n.itemId), ...build.keys()]);
  const finished = (v: string | null) => v === "Done" || v === "Closed";
  const trackerLines = [...trackerItems].map((id) => {
    const t = trackers.get(id);
    const line: DigestLine = [ref(id), { text: ": " }];
    const mine = [...issue.values()].filter((n) => n.itemId === id);
    mine.forEach((n, i) => {
      const tracker = n.entity === "item_github_links" ? "GitHub" : "Jira";
      if (i > 0) line.push({ text: "; " });
      line.push({ text: `${tracker} ` });
      if (t && t.tracker === tracker) line.push({ text: clean(t.key), ...(t.url ? { href: t.url } : {}) });
      else line.push({ text: "issue" });
      line.push({ text: ` moved from ${n.from ?? "no status"} to ${n.to}` });
    });
    const b = build.get(id);
    if (b) {
      if (mine.length === 0) line.push({ text: `Build Status in Product Velocity went from ${b.from ?? "not set"} to ${b.to}` }, ...(t ? [{ text: ` (${t.tracker} ` }, { text: clean(t.key), ...(t.url ? { href: t.url } : {}) }, { text: ")" }] : []));
      else line.push({ text: `. Build Status in Product Velocity: ${b.from ?? "not set"} to ${b.to}` });
    }
    line.push({ text: "." });
    const done = finished(mine.at(-1)?.to ?? null) || b?.to === "Done";
    return { id, line, done };
  }).sort((a, b) => Number(b.done) - Number(a.done) || rankOf(a.id) - rankOf(b.id));
  add("build", "Build and tracker status", trackerLines);

  // ---- new documents, files and links, each named and linked
  add("documents", "New documents and files", documents.filter((d) => byId.has(d.itemId)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((d) => {
      const code = byId.get(d.itemId)!.item_code;
      const what = d.entry === "document" ? DOC_TYPE[d.kind ?? "other"] ?? "Document" : d.entry === "file" ? "File" : "Link";
      return { id: d.itemId, line: [{ text: clean(d.title || "Untitled"), href: documentHref(code, d) }, { text: ` (${what}${d.aiDraft ? ", AI draft, not yet reviewed" : ""}) added to ` }, ref(d.itemId), { text: "." }] };
    }));

  // ---- follow up: initiatives that moved and carry a flag
  const moved = new Set(touched);
  const followups = [...moved].filter((id) => (flags.get(id) ?? []).length > 0).sort((a, b) => rankOf(a) - rankOf(b)).map((id) => {
    const f = flags.get(id)![0]!;
    return { id, line: [ref(id), { text: `: ${f.label}. ${f.text}${f.action ? ` Suggested: ${f.action.label}.` : ""}` }] as DigestLine };
  });
  // a follow up is not a change of its own: it does not add initiatives to the headline
  const before = new Set(touched);
  add("followup", "Needs a decision or action", followups);
  for (const id of [...touched]) if (!before.has(id)) touched.delete(id);

  const parts = [
    counts.completed ? `${counts.completed} completed` : "", counts.phase ? plural(counts.phase, "phase move", "phase moves") : "",
    counts.health ? plural(counts.health, "health change", "health changes") : "", counts.priority ? plural(counts.priority, "priority change", "priority changes") : "",
    counts.build ? plural(counts.build, "tracker update", "tracker updates") : "", counts.documents ? plural(counts.documents, "new document or file", "new documents or files") : "",
  ].filter(Boolean);
  const moves = groups.filter((g) => g.id !== "followup");
  const headline = moves.length === 0
    ? `No phase, health, priority, tracker or document changes ${periodLabel}.`
    : `${plural(touched.size, "initiative", "initiatives")} moved ${periodLabel}: ${parts.join(", ")}.`;
  return { headline, groups, itemIds: [...new Set([...touched, ...followups.map((f) => f.id)])] };
}

// ------------------------------------------------------------------ as update text (a small Markdown: [label](link), **bold**, "- " lists)
const href = (u: string) => u.replace(/\)/g, "%29").replace(/\s/g, "%20");
export const partsToMarkdown = (line: DigestLine): string => line.map((p) => (p.href ? `[${clean(p.text)}](${href(p.href)})` : p.text)).join("");

/** The lines of the digest for the weekly update text: the headline, then each group as a bold title and its lines. */
export function digestMarkdown(d: Digest): string[] {
  return [d.headline, ...d.groups.flatMap((g) => ["", `**${g.title}**`, ...g.lines.map((l) => `- ${partsToMarkdown(l)}`)])];
}
