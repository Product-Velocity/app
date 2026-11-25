// The rows of the Jira epics grid on an initiative's Jira tab: the epics a person listed, with what Jira last reported about each and its children.
// Pure, so it is tested without a screen.
import type { JiraEpicRequestRow, JiraTreeRow } from "./types";

export type CheckResult = { ok: boolean; text: string };

export type EpicGridRow = {
  key: string;
  /** An epic a person listed (can be checked and taken off the list while it is not linked) or one of its children (copy and filter only). */
  kind: "epic" | "child";
  /** Epics only: the request that lists it. */
  request: JiraEpicRequestRow | null;
  title: string | null;
  type: string | null;
  status: string | null;
  category: JiraTreeRow["category"];
  assignee: string | null;
  url: string | null;
  /** Epics only: the last check with Jira, if there was one this session. */
  check: CheckResult | null;
};

export const NOT_READ = "Not read yet";

/** The listed epics in list order, each followed by its children as Jira last reported them. A tree row that no request lists is left out. */
export function buildEpicRows(requests: JiraEpicRequestRow[], tree: JiraTreeRow[], checks: Record<string, CheckResult>): EpicGridRow[] {
  const byKey = new Map(tree.map((t) => [t.key, t]));
  const out: EpicGridRow[] = [];
  for (const r of requests) {
    const t = byKey.get(r.key);
    out.push({
      key: r.key, kind: "epic", request: r, title: t?.title ?? null, type: t?.type ?? null, status: t?.status ?? null, category: t?.category ?? null,
      assignee: t?.assignee ?? null, url: t?.url ?? null, check: checks[r.key] ?? null,
    });
    for (const c of tree.filter((x) => x.level === 2 && x.parentKey === r.key)) {
      out.push({ key: c.key, kind: "child", request: null, title: c.title, type: c.type, status: c.status, category: c.category, assignee: c.assignee, url: c.url, check: null });
    }
  }
  return out;
}

export type EpicFilter = { type: string; status: string; text: string };
export const NO_FILTER: EpicFilter = { type: "", status: "", text: "" };

export const typeOf = (r: EpicGridRow) => r.type ?? NOT_READ;
export const statusOf = (r: EpicGridRow) => r.status ?? NOT_READ;

/** The distinct values of a column, in the order they first appear. */
export function distinct(rows: EpicGridRow[], pick: (r: EpicGridRow) => string): string[] {
  return [...new Set(rows.map(pick))];
}

export function filterEpicRows(rows: EpicGridRow[], f: EpicFilter): EpicGridRow[] {
  const q = f.text.trim().toLowerCase();
  return rows.filter((r) =>
    (!f.type || typeOf(r) === f.type) && (!f.status || statusOf(r) === f.status) &&
    (!q || r.key.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q) || (r.assignee ?? "").toLowerCase().includes(q)));
}

/** The rows a bulk action covers: the selected ones, or every row now shown when nothing is selected. */
export function targetRows(shown: EpicGridRow[], selected: ReadonlySet<string>): EpicGridRow[] {
  return selected.size === 0 ? shown : shown.filter((r) => selected.has(r.key));
}

/** Listed epics that a check can look at: not linked yet. */
export const checkable = (r: EpicGridRow) => r.kind === "epic" && r.request?.state !== "linked";
/** Listed epics that can be taken off the list: not linked yet (a linked one is already in Jira). */
export const removable = checkable;

/** The Jira site address, from any link the rows already carry. */
export function siteOrigin(rows: EpicGridRow[]): string | null {
  for (const r of rows) {
    if (!r.url) continue;
    try { return new URL(r.url).origin; } catch { /* not a link */ }
  }
  return null;
}

/** The links of the rows, one per line and nothing else, ready to paste. A row with no known link uses the site address from another row; with none known, its key. */
export function linksText(rows: EpicGridRow[], origin: string | null = siteOrigin(rows)): { text: string; withoutLink: string[] } {
  const seen = new Set<string>();
  const lines: string[] = [];
  const withoutLink: string[] = [];
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    if (r.url) lines.push(r.url);
    else if (origin) lines.push(`${origin}/browse/${r.key}`);
    else { lines.push(r.key); withoutLink.push(r.key); }
  }
  return { text: lines.join("\n"), withoutLink };
}

/** What the Check column says for an epic, in words (colour is never the only signal). */
export function resultText(r: EpicGridRow, readOnly: boolean): { label: string; detail: string; tone: "ok" | "bad" | "plain" } {
  const q = r.request;
  if (q?.state === "linked") return { label: "Linked", detail: `under the Initiative${q.previousParent ? ` (was under ${q.previousParent})` : ""}`, tone: "ok" };
  if (q?.state === "failed") return { label: "Jira refused it", detail: q.lastError ?? "no reason given", tone: "bad" };
  if (r.check) {
    const t = r.check.text.startsWith(r.key) ? r.check.text.slice(r.key.length).replace(/^[\s:]+/, "") : r.check.text;
    return { label: r.check.ok ? "OK" : readOnly ? "Cannot be read" : "Cannot be linked", detail: t, tone: r.check.ok ? "ok" : "bad" };
  }
  return { label: "Not checked yet", detail: "", tone: "plain" };
}

/** One line for a person after a check: how many are fine and what to do next. */
export function checkSummary(lines: { ok: boolean }[], readOnly: boolean): string | null {
  if (lines.length === 0) return null;
  const bad = lines.filter((l) => !l.ok).length;
  const verb = readOnly ? "read" : "link";
  if (bad === 0) return `Checked with Jira: ${lines.length === 1 ? "the epic is" : `all ${lines.length} epics are`} OK. Press Sync with Jira to ${verb} ${lines.length === 1 ? "it" : "them"}.`;
  return `Checked with Jira: ${lines.length - bad} OK, ${bad} to fix or take off the list. Press Sync with Jira to ${verb} the OK ones.`;
}

/** Initiatives as a pasteable list, "R-104 PushAds Format", one per line (the Depends On copy button). */
export function initiativeListText(items: { code: string; name: string }[]): string {
  return items.map((i) => `${i.code} ${i.name}`.trim()).join("\n");
}
