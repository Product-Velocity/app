// Issue #421: Start Building and Build Completed from Jira's own dates (docs/decisions/2026-11-11-tracker-build-dates.md). READ ONLY.
// Start Building = the earliest time the linked issue or any of its children / sub-tasks first moved into the in-progress or done status
// CATEGORY (read from the issue history; status names mean nothing). Build Completed = the linked issue's resolution date while it is done.
// Jira's own "Start date" fields are never used: people edit them by hand. Pure over an injected `getPage`/`getStatuses`/`apply`, so history
// parsing, batches and the "no history" cases are tested without a network. Text from Jira is data: only ids, categories and timestamps are used.
import { KEY_BATCH, type SearchPage } from "./read-issues";
import { ReconnectNeeded } from "./token-provider";

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
export const DATE_FIELDS = "status,resolutiondate";
export type Category = "new" | "indeterminate" | "done";

type History = { created?: unknown; items?: { field?: unknown; to?: unknown }[] };
export type DatedIssue = {
  key?: string;
  fields?: { status?: { statusCategory?: { key?: unknown } }; resolutiondate?: unknown };
  changelog?: { histories?: History[] };
};
export type StatusList = { id?: unknown; statusCategory?: { key?: unknown } }[];

/** Jira status id -> status category, from GET /status (every status of the site). */
export function categoryMap(list: StatusList): Map<string, Category> {
  const out = new Map<string, Category>();
  for (const s of Array.isArray(list) ? list : []) {
    const k = s.statusCategory?.key;
    if (typeof s.id === "string" && (k === "new" || k === "indeterminate" || k === "done")) out.set(s.id, k);
  }
  return out;
}

const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** The earliest time the issue's status moved into the in-progress or done category, from its history; null when its history shows none. */
export function firstWorkStart(issue: DatedIssue, categories: Map<string, Category>): string | null {
  let best: string | null = null;
  for (const h of issue.changelog?.histories ?? []) {
    const at = iso(h.created);
    if (!at) continue;
    for (const it of h.items ?? []) {
      if (it.field !== "status" || typeof it.to !== "string") continue;
      const c = categories.get(it.to);
      if ((c === "indeterminate" || c === "done") && (best === null || at < best)) best = at;
    }
  }
  return best;
}

export type BuildDateRow = { key: string; started: string | null; resolved: string | null };
export type DateTarget = { item_id: string; issue_key: string; childKeys: string[] };

export function datedPath(keys: string[]): string {
  if (keys.length === 0 || keys.length > KEY_BATCH || !keys.every((k) => ISSUE_KEY.test(k))) throw new Error("Not a list of Jira issue keys");
  const q = new URLSearchParams({ jql: `key in (${keys.map((k) => `"${k}"`).join(", ")})`, maxResults: String(KEY_BATCH), fields: DATE_FIELDS, expand: "changelog" });
  return `/search/jql?${q.toString()}`;
}

const isBadRequest = (e: unknown) => e instanceof Error && /answered 400\b/.test(e.message);

async function readBatch(getPage: (path: string) => Promise<SearchPage>, keys: string[], out: Map<string, DatedIssue>): Promise<void> {
  try {
    let token: string | undefined;
    for (let pages = 0; pages < 3; pages++) {
      const path = datedPath(keys) + (token ? `&nextPageToken=${encodeURIComponent(token)}` : "");
      const page = (await getPage(path)) as { issues?: DatedIssue[]; nextPageToken?: string; isLast?: boolean };
      for (const raw of page.issues ?? []) if (typeof raw.key === "string" && keys.includes(raw.key)) out.set(raw.key, raw);
      if (page.isLast !== false || !page.nextPageToken) return;
      token = page.nextPageToken;
    }
  } catch (e) {
    // an issue Jira refuses (deleted or not visible, 400) must not hide the others: halve the batch; a single refused key is simply left out
    if (!isBadRequest(e)) throw e;
    if (keys.length === 1) return;
    const mid = Math.ceil(keys.length / 2);
    await readBatch(getPage, keys.slice(0, mid), out);
    await readBatch(getPage, keys.slice(mid), out);
  }
}

/** One row per linked issue: started = earliest first work start over the issue and its children; resolved = its resolution date while done. */
export async function readBuildDates(getPage: (path: string) => Promise<SearchPage>, categories: Map<string, Category>, targets: DateTarget[]): Promise<BuildDateRow[]> {
  const all = [...new Set(targets.flatMap((t) => [t.issue_key, ...t.childKeys]).filter((k) => ISSUE_KEY.test(k)))];
  const read = new Map<string, DatedIssue>();
  for (let i = 0; i < all.length; i += KEY_BATCH) await readBatch(getPage, all.slice(i, i + KEY_BATCH), read);
  const rows: BuildDateRow[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const root = read.get(t.issue_key);
    if (!root || seen.has(t.issue_key)) continue; // not read (deleted, moved, not visible): nothing is known, nothing changes
    seen.add(t.issue_key);
    let started: string | null = null;
    for (const k of [t.issue_key, ...t.childKeys]) {
      const s = read.get(k) ? firstWorkStart(read.get(k)!, categories) : null;
      if (s && (started === null || s < started)) started = s;
    }
    const done = root.fields?.status?.statusCategory?.key === "done";
    rows.push({ key: t.issue_key, started, resolved: done ? iso(root.fields?.resolutiondate) : null });
  }
  return rows;
}

export type DateDeps = {
  getPage(path: string): Promise<SearchPage>;
  getStatuses(): Promise<StatusList>;
  /** jira_apply_build_dates for the rows of ONE connection and site. */
  apply(rows: BuildDateRow[]): Promise<{ key: string; changes: Record<string, unknown> }[]>;
};
export type DatesRefresh = { read: number; changed: number; error: string | null };

/** The date refresh as the status refresh calls it: a failure is returned as `error` and never fails the status read. ReconnectNeeded propagates. */
export async function refreshBuildDatesTolerant(deps: DateDeps, targets: DateTarget[]): Promise<DatesRefresh> {
  if (targets.length === 0) return { read: 0, changed: 0, error: null };
  try {
    const rows = await readBuildDates(deps.getPage, categoryMap(await deps.getStatuses()), targets);
    let changed = 0;
    for (let i = 0; i < rows.length; i += 500) changed += (await deps.apply(rows.slice(i, i + 500))).filter((r) => Object.keys(r.changes).length > 0).length;
    return { read: rows.length, changed, error: null };
  } catch (e) {
    if (e instanceof ReconnectNeeded) throw e;
    return { read: 0, changed: 0, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" };
  }
}
