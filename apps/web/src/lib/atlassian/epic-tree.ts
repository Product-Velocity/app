// Read-only epics (issue #656, docs/decisions/2026-11-24-jira-read-only-mode.md): in a project set read only for Jira, the epics listed on an initiative
// are read BY KEY, with their children, into the same read-only tree a linked Jira Initiative gets: level 1 = the listed epics (their parent is their own
// key, there is no Jira issue above them), level 2 = their children. Delivery counts are counted at the leaves; the Build Status category comes from the
// epics (all done = done, none started = new, otherwise in progress). Pure over an injected `getPage`: it only produces search paths, so no write request
// can come out of it, and it is tested with a fake Jira. Text from Jira is data. A closed epic never completes the initiative (rule 6).
import { readIssuesByKey, type SearchPage } from "./read-issues";
import { epicCategory, readChildren, summariseTree, MAX_NODES, type Category, type TreeNode, type TreeSummary } from "./jira-tree";

export type EpicTreeDeps = {
  getPage(path: string): Promise<SearchPage>;
  /** jira_apply_epic_tree for ONE initiative. */
  apply(itemId: string, nodes: TreeNode[], summary: TreeSummary, category: Category | null): Promise<void>;
};
export type Attachment = { item_id: string; keys: string[] };
export type EpicTreeRefresh = {
  /** Initiatives whose tree was read and applied. */
  applied: number;
  /** Nodes (epics and children) read in total. */
  nodes: number;
  /** Initiatives whose tree could not be applied (too large, or the database refused). */
  failed: number;
  failedItems: string[];
  /** Listed keys Jira did not return (deleted, moved or not visible to the sign-in), by initiative id. */
  missing: Record<string, string[]>;
  /** Listed keys that are not at epic level, by initiative id: left out of the tree. */
  notEpics: Record<string, string[]>;
};

export async function refreshAttachedEpics(deps: EpicTreeDeps, attachments: Attachment[], siteUrl: string): Promise<EpicTreeRefresh> {
  const out: EpicTreeRefresh = { applied: 0, nodes: 0, failed: 0, failedItems: [], missing: {}, notEpics: {} };
  const wanted = [...new Set(attachments.flatMap((a) => a.keys))];
  if (wanted.length === 0) return out;
  // one read for all the epics, one for the children of those that are epics (a Jira failure that is not about one key is thrown before anything is applied)
  const read = await readIssuesByKey(deps.getPage, wanted, siteUrl);
  const rows = new Map(read.rows.map((r) => [r.key, r]));
  const epicKeys = read.rows.filter((r) => r.level === 1).map((r) => r.key);
  const kids = epicKeys.length > 0 ? await readChildren(deps.getPage, epicKeys, siteUrl) : { byParent: new Map(), unreadable: new Set<string>() };
  for (const a of attachments) {
    const missing = a.keys.filter((k) => !rows.has(k));
    const notEpics = a.keys.filter((k) => rows.has(k) && rows.get(k)!.level !== 1);
    if (missing.length > 0) out.missing[a.item_id] = missing;
    if (notEpics.length > 0) out.notEpics[a.item_id] = notEpics;
    const mine = a.keys.filter((k) => rows.get(k)?.level === 1 && !kids.unreadable.has(k));
    // nothing readable: leave the tree as it was rather than emptying it because of a failed read
    if (mine.length === 0) continue;
    const nodes: TreeNode[] = [];
    for (const k of mine) {
      const e = rows.get(k)!;
      nodes.push({ key: e.key, id: e.id, title: e.title, type: e.type, status: e.status, category: e.category, url: e.url, updated: e.updated, level: 1, parent: e.key, position: nodes.length, assignee: null });
      for (const c of kids.byParent.get(k) ?? []) {
        if (nodes.some((n) => n.key === c.row.key)) continue;
        nodes.push({ key: c.row.key, id: c.row.id, title: c.row.title, type: c.row.type, status: c.row.status, category: c.row.category, url: c.row.url, updated: c.row.updated, level: 2, parent: k, position: nodes.length, assignee: c.assignee });
      }
    }
    if (nodes.length > MAX_NODES) { out.failed++; out.failedItems.push(a.item_id); continue; }
    try {
      await deps.apply(a.item_id, nodes, summariseTree(nodes), epicCategory(nodes));
      out.applied++;
      out.nodes += nodes.length;
    } catch {
      out.failed++;
      out.failedItems.push(a.item_id);
    }
  }
  return out;
}
