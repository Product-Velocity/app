// Children of a linked initiative (issue #67, #71): the Jira twin of the issue tree of GitHub (packages/github/src/tree.ts, docs/04).
// Pure over an injected `getPage` and `apply`, so paging, batches and counting are tested with a fake Jira. READ ONLY: nothing is written to
// Jira. Text from Jira is data: titles are cleaned and cut, nothing in it is interpreted. A closed child means the build is progressing,
// never that the initiative is complete (rule 6): only the roll-up counts are derived here, never any status.
import type { ReceivedLine } from "@/lib/github/push-types";
import { cleanTitle, KEY_BATCH, mapIssue, readIssuesByKey, type JiraIssueRow, type RawIssue, type SearchPage } from "./read-issues";
import { ReconnectNeeded } from "./token-provider";

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
export const TREE_FIELDS = "summary,issuetype,status,assignee,parent,updated";
/** Token pages per batch of parents (100 per page): a batch with more children than this is not applied half. */
export const TREE_MAX_PAGES = 20;
/** The database takes at most 500 nodes per initiative. */
export const MAX_NODES = 500;

/** A child (level 1) or a sub-task of a child (level 2). */
export type TreeNode = Pick<JiraIssueRow, "key" | "id" | "title" | "type" | "status" | "category" | "url" | "updated"> & { level: 1 | 2; parent: string; position: number; assignee: string | null };
export type TreeSummary = { total: number; closed: number; progressPct: number | null };

export class TreeTooLarge extends Error {}

/** `parent in (...)` for up to KEY_BATCH keys; every key is validated, so nothing from outside can shape the query. */
export function childrenJql(parents: string[]): string {
  if (parents.length === 0 || parents.length > KEY_BATCH || !parents.every((k) => ISSUE_KEY.test(k))) throw new Error("Not a list of Jira issue keys");
  return `parent in (${parents.map((k) => `"${k}"`).join(", ")}) ORDER BY key ASC`;
}

export function childrenPath(parents: string[], pageToken?: string): string {
  const q = new URLSearchParams({ jql: childrenJql(parents), maxResults: String(KEY_BATCH), fields: TREE_FIELDS });
  if (pageToken) q.set("nextPageToken", pageToken);
  return `/search/jql?${q.toString()}`;
}

const isBadRequest = (e: unknown) => e instanceof Error && /answered 400\b/.test(e.message);
const numberOf = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));
/** Children of one parent in a stable order: by project, then by number (epics of one Initiative can come from several projects). */
const byKey = (a: Kid, b: Kid) => {
  const pa = a.row.key.slice(0, a.row.key.lastIndexOf("-")), pb = b.row.key.slice(0, b.row.key.lastIndexOf("-"));
  return pa === pb ? numberOf(a.row.key) - numberOf(b.row.key) : pa < pb ? -1 : 1;
};
const assigneeOf = (raw: RawIssue): string | null => {
  const n = raw.fields?.assignee?.displayName;
  return typeof n === "string" && n.trim() ? cleanTitle(n).slice(0, 100) : null;
};

type Kid = { row: JiraIssueRow; assignee: string | null };

async function readBatch(getPage: (path: string) => Promise<SearchPage>, parents: string[], siteUrl: string, out: Map<string, Kid[]>, unreadable: Set<string>): Promise<void> {
  const found = new Map<string, Kid[]>();
  try {
    let token: string | undefined;
    for (let pages = 1; ; pages++) {
      const page = await getPage(childrenPath(parents, token));
      for (const raw of page.issues ?? []) {
        const row = mapIssue(raw, siteUrl);
        if (!row || !row.parent || !parents.includes(row.parent)) continue;
        const list = found.get(row.parent) ?? [];
        if (!list.some((k) => k.row.key === row.key)) list.push({ row, assignee: assigneeOf(raw) });
        found.set(row.parent, list);
      }
      if (page.isLast !== false || !page.nextPageToken) break;
      if (pages >= TREE_MAX_PAGES) throw new TreeTooLarge("An initiative has more children than can be read in one go.");
      token = page.nextPageToken;
    }
    for (const [k, v] of found) out.set(k, v);
  } catch (e) {
    // Jira refuses a query that names an issue that does not exist or is not visible (400): halve the batch until the one key is found; that
    // key is reported as unreadable (its tree is left as it was), the others are read. Any other error (401, 429, 5xx, too large) is thrown.
    if (!isBadRequest(e)) throw e;
    if (parents.length === 1) { unreadable.add(parents[0]!); return; }
    const mid = Math.ceil(parents.length / 2);
    await readBatch(getPage, parents.slice(0, mid), siteUrl, out, unreadable);
    await readBatch(getPage, parents.slice(mid), siteUrl, out, unreadable);
  }
}

/** Reads the children of the given issues (100 parents per call, token paging). `unreadable` = parents Jira refused: nothing is known about them. */
export async function readChildren(getPage: (path: string) => Promise<SearchPage>, parents: string[], siteUrl: string): Promise<{ byParent: Map<string, Kid[]>; unreadable: Set<string> }> {
  const wanted = [...new Set(parents.filter((k) => ISSUE_KEY.test(k)))];
  const byParent = new Map<string, Kid[]>();
  const unreadable = new Set<string>();
  for (let i = 0; i < wanted.length; i += KEY_BATCH) await readBatch(getPage, wanted.slice(i, i + KEY_BATCH), siteUrl, byParent, unreadable);
  for (const list of byParent.values()) list.sort(byKey);
  return { byParent, unreadable };
}

/**
 * Delivery counts, the one counting rule: work is counted at the leaves (a child counts only while it has no sub-tasks) and a child in the
 * done CATEGORY is closed (status names mean nothing; only the category does). Progress = closed / total, null while there is nothing.
 */
export function summariseTree(nodes: TreeNode[]): TreeSummary {
  const withSubtasks = new Set(nodes.filter((n) => n.level === 2).map((n) => n.parent));
  const leaves = nodes.filter((n) => n.level === 2 || !withSubtasks.has(n.key));
  const closed = leaves.filter((n) => n.category === "done").length;
  return { total: leaves.length, closed, progressPct: leaves.length === 0 ? null : Math.round((closed / leaves.length) * 100) };
}

/** `level` = the hierarchy level of the linked issue when it is known (item_jira_links.issue_level): 1 Epic, 2 and up above Epic (a Jira Initiative). */
export type LinkedIssue = { item_id: string; issue_key: string; level?: number | null };
export type Category = "new" | "indeterminate" | "done";
export type TreeDeps = {
  getPage(path: string): Promise<SearchPage>;
  /** jira_apply_tree for ONE initiative of this connection and site. */
  apply(itemId: string, nodes: TreeNode[], summary: TreeSummary): Promise<void>;
  /** jira_apply_link_level: stores the level of the linked issue and, above Epic only, the Build Status derived from the epics. Returns what changed. */
  applyLink(itemId: string, level: number, category: Category | null): Promise<{ status?: [string | null, string | null] }>;
};
export type TreeRefresh = {
  /** Initiatives whose tree was read and applied. */
  applied: number;
  /** Children and sub-tasks read in total. */
  nodes: number;
  /** Initiatives whose issue Jira refused (deleted, moved or not visible): their tree is left as it was. */
  unreadable: string[];
  /** Initiatives whose tree could not be applied (too many children, or the database refused): the others are not affected. */
  failed: number;
  /** The same initiatives as `failed`, by id, so the Sync dialog can say which ones. */
  failedItems: string[];
  /** Build Status changes derived from the epics of an initiative linked above Epic, in the words of the Sync dialog's "Received", by initiative id. */
  received: Record<string, ReceivedLine[]>;
  /** Initiatives whose tree was saved but whose level or derived Build Status could not be (retried on the next read). */
  levelFailed: number;
};

/**
 * The Build Status category of an initiative linked ABOVE Epic, from the status categories of its epics (the first level of its tree, whatever
 * their type: Epic, Workstream...): all done = done, all not started = new, anything else = in progress. Issues Jira did not classify are left
 * out; with nothing left there is no answer (null) and Build Status stays as it is. Status names mean nothing; only the category does.
 */
export function epicCategory(nodes: TreeNode[]): Category | null {
  const cats = nodes.filter((n) => n.level === 1 && n.category !== null).map((n) => n.category as Category);
  if (cats.length === 0) return null;
  if (cats.every((c) => c === "done")) return "done";
  if (cats.every((c) => c === "new")) return "new";
  return "indeterminate";
}

/**
 * Reads the children of every linked issue, then the sub-tasks of those children (one more level), and applies one tree per initiative. A
 * Jira failure that is not specific to one initiative (a 401, a 429, ReconnectNeeded) is thrown before anything is applied, so a half-read
 * tree is never written; a tree that is too large or that the database refuses counts as `failed` for that initiative only.
 */
export async function refreshTrees(deps: TreeDeps, links: LinkedIssue[], siteUrl: string): Promise<TreeRefresh> {
  const out: TreeRefresh = { applied: 0, nodes: 0, unreadable: [], failed: 0, failedItems: [], received: {}, levelFailed: 0 };
  const epics = [...new Set(links.map((l) => l.issue_key))];
  if (epics.length === 0) return out;
  // the hierarchy level of a linked issue is read once (then kept on the link): only the ones not known yet are asked for
  const levels = new Map<string, number>();
  const unknown = [...new Set(links.filter((l) => l.level == null).map((l) => l.issue_key))];
  if (unknown.length > 0) for (const r of (await readIssuesByKey(deps.getPage, unknown, siteUrl)).rows) if (r.level !== null) levels.set(r.key, r.level);
  const first = await readChildren(deps.getPage, epics, siteUrl);
  const kids = [...first.byParent.values()].flat().map((k) => k.row.key);
  const second = await readChildren(deps.getPage, kids, siteUrl);
  for (const l of links) {
    if (first.unreadable.has(l.issue_key)) { out.unreadable.push(l.item_id); continue; }
    const nodes: TreeNode[] = [];
    const seen = new Set<string>([l.issue_key]);
    const push = (k: Kid, level: 1 | 2, parent: string) => {
      if (seen.has(k.row.key)) return;
      seen.add(k.row.key);
      nodes.push({ key: k.row.key, id: k.row.id, title: k.row.title, type: k.row.type, status: k.row.status, category: k.row.category, url: k.row.url, updated: k.row.updated, level, parent, position: nodes.length, assignee: k.assignee });
    };
    for (const c of first.byParent.get(l.issue_key) ?? []) {
      push(c, 1, l.issue_key);
      for (const s of second.byParent.get(c.row.key) ?? []) push(s, 2, c.row.key);
    }
    if (nodes.length > MAX_NODES) { out.failed++; out.failedItems.push(l.item_id); continue; }
    try {
      await deps.apply(l.item_id, nodes, summariseTree(nodes));
      out.applied++;
      out.nodes += nodes.length;
    } catch {
      out.failed++;
      out.failedItems.push(l.item_id);
      continue;
    }
    // the tree is saved: now the level of the linked issue and, above Epic, the Build Status the epics give (never fails the tree)
    const level = l.level ?? levels.get(l.issue_key) ?? null;
    if (level !== null && (level >= 2 || level !== (l.level ?? null))) {
      try {
        const changed = await deps.applyLink(l.item_id, level, level >= 2 ? epicCategory(nodes) : null);
        if (changed.status) out.received[l.item_id] = [{ label: "Build Status", from: changed.status[0], to: changed.status[1] }];
      } catch {
        out.levelFailed++;
      }
    }
  }
  return out;
}

/**
 * The tree refresh as the status refresh calls it: a failure of the tree (Jira refused, too large, the database function not applied yet) must
 * not fail the status refresh, so it is returned as `error`. ReconnectNeeded is the exception: it propagates and is never retried.
 */
export async function refreshTreesTolerant(deps: TreeDeps, links: LinkedIssue[], siteUrl: string): Promise<TreeRefresh & { error: string | null }> {
  try {
    return { ...(await refreshTrees(deps, links, siteUrl)), error: null };
  } catch (e) {
    if (e instanceof ReconnectNeeded) throw e;
    return { applied: 0, nodes: 0, unreadable: [], failed: links.length, failedItems: links.map((l) => l.item_id), received: {}, levelFailed: 0, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" };
  }
}
