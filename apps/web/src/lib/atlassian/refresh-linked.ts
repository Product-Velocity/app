// Refresh of linked initiatives from Jira (issue #67, #71), the READ side. Pure over injected dependencies, so it is tested with a fake
// Jira and a fake database. It reads the linked issues by key (100 per call), applies their status to the initiatives through
// jira_apply_statuses (compare before write, older answers ignored, Build Status from the status CATEGORY, Initiative Status never)
// and keeps the light records current. Nothing is written to Jira.
import type { ReceivedLine } from "@/lib/github/push-types";
import { readIssuesByKey, type JiraIssueRow, type SearchPage } from "./read-issues";

export type ApplyRow = { key: string; status: string | null; category: JiraIssueRow["category"]; updated: string | null };
export type ApplyResult = { key: string; item_id: string; stale: boolean; changes: { status?: [string | null, string | null]; jira_status?: [string | null, string | null] } };
export type RefreshDeps = {
  getPage(path: string): Promise<SearchPage>;
  /** jira_apply_statuses for ONE connection and site (rows of other links are not sent). */
  apply(rows: ApplyRow[]): Promise<ApplyResult[]>;
  /** jira_upsert_issues: keeps the light record of each issue current (and so also issues that became Done). */
  upsert(rows: JiraIssueRow[]): Promise<void>;
};
export type LinkedIssue = { item_id: string; issue_key: string };
export type RefreshSummary = {
  /** Linked initiatives whose issue was read. */
  checked: number;
  /** Initiatives whose Build Status or Jira status changed. */
  changed: number;
  /** Answers older than what was known, ignored. */
  stale: number;
  /** Issues Jira did not return (deleted, moved or not visible): nothing is changed for them. */
  missing: string[];
  /** What changed, per initiative, in the words of the Sync dialog's "Received". */
  received: Record<string, ReceivedLine[]>;
};

const CHUNK = 500;

/** The lines of one initiative's card: Build Status (what the initiative shows) and the Jira status it came from. */
export function receivedLines(changes: ApplyResult["changes"]): ReceivedLine[] {
  const out: ReceivedLine[] = [];
  if (changes.status) out.push({ label: "Build Status", from: changes.status[0], to: changes.status[1] });
  if (changes.jira_status) out.push({ label: "Jira status", from: changes.jira_status[0], to: changes.jira_status[1] });
  return out;
}

/**
 * Reads the given linked issues and applies them. `known` holds rows that were just read (the open work), so those are not read twice.
 * A failure to read Jira throws (ReconnectNeeded and the like) before anything is applied for the batch.
 */
export async function refreshLinkedStatuses(deps: RefreshDeps, links: LinkedIssue[], siteUrl: string, known: Map<string, JiraIssueRow> = new Map()): Promise<RefreshSummary> {
  const summary: RefreshSummary = { checked: 0, changed: 0, stale: 0, missing: [], received: {} };
  const keys = [...new Set(links.map((l) => l.issue_key))];
  if (keys.length === 0) return summary;
  const rows = new Map<string, JiraIssueRow>();
  const need: string[] = [];
  for (const k of keys) { const r = known.get(k); if (r) rows.set(k, r); else need.push(k); }
  if (need.length > 0) {
    const read = await readIssuesByKey(deps.getPage, need, siteUrl);
    for (const r of read.rows) rows.set(r.key, r);
    summary.missing = read.missing;
  }
  const all = [...rows.values()];
  for (let i = 0; i < all.length; i += CHUNK) {
    const part = all.slice(i, i + CHUNK);
    await deps.upsert(part);
    const results = await deps.apply(part.map((r) => ({ key: r.key, status: r.status, category: r.category, updated: r.updated })));
    for (const res of results) {
      summary.checked++;
      if (res.stale) { summary.stale++; continue; }
      const lines = receivedLines(res.changes ?? {});
      if (lines.length > 0) { summary.changed++; summary.received[res.item_id] = lines; }
    }
  }
  return summary;
}
