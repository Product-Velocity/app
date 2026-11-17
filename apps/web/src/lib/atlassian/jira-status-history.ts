// Who moved a Jira issue to a status, and when (issue #472, Ashu 2026-11-17). Read from Jira's OWN history of the issues linked to initiatives (the changelog of
// the issue), never from a webhook body (a delivery is a hint: decision 2026-11-03-jira-webhooks.md), so a forged delivery cannot name anyone. READ ONLY.
// Pure over an injected `getPage`/`save`, so the parsing, the batches and the "no name" cases are tested without a network. Text from Jira is data: a display name is
// cut to 120 characters and stripped of control characters; no email and no account id is kept (personal data of Jira users: docs/14-GO-LIVE-CHECKLIST.md).
import { KEY_BATCH, type SearchPage } from "./read-issues";
import { ReconnectNeeded } from "./token-provider";

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
type History = { created?: unknown; author?: { displayName?: unknown } | null; items?: { field?: unknown; fromString?: unknown; toString?: unknown }[] };
export type HistoryIssue = { key?: unknown; changelog?: { histories?: History[] } };
/** One status change as it is stored: Jira's time, the statuses and the display name of the Jira user (null when Jira did not say). */
export type StatusChangeRow = { issue_key: string; changed_at: string; from_status: string | null; to_status: string; actor_name: string | null };

const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
// eslint-disable-next-line no-control-regex
const name = (v: unknown): string | null => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || null : null);
const status = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 100) : null);

/** Every move of the issue to a status found in its history, oldest first. Other fields, a move without a "to" and a history without a time are left out. */
export function statusChangesOf(issue: HistoryIssue): StatusChangeRow[] {
  const key = typeof issue.key === "string" && ISSUE_KEY.test(issue.key) ? issue.key : null;
  if (!key) return [];
  const out: StatusChangeRow[] = [];
  for (const h of issue.changelog?.histories ?? []) {
    const at = iso(h.created);
    if (!at) continue;
    for (const it of h.items ?? []) {
      if (it.field !== "status") continue;
      const to = status(it.toString);
      if (!to) continue;
      out.push({ issue_key: key, changed_at: at, from_status: status(it.fromString), to_status: to, actor_name: name(h.author?.displayName) });
    }
  }
  return out.sort((a, b) => (a.changed_at < b.changed_at ? -1 : a.changed_at > b.changed_at ? 1 : 0));
}

export function historyPath(keys: string[]): string {
  if (keys.length === 0 || keys.length > KEY_BATCH || !keys.every((k) => ISSUE_KEY.test(k))) throw new Error("Not a list of Jira issue keys");
  const q = new URLSearchParams({ jql: `key in (${keys.map((k) => `"${k}"`).join(", ")})`, maxResults: String(KEY_BATCH), fields: "status", expand: "changelog" });
  return `/search/jql?${q.toString()}`;
}

export type HistoryDeps = {
  getPage(path: string): Promise<SearchPage>;
  /** Stores the rows (insert, an existing change is left as it is). */
  save(rows: StatusChangeRow[]): Promise<void>;
};
export type HistoryRecord = { issues: number; changes: number; error: string | null };

/**
 * Reads the history of these linked issues and stores every status change with its Jira user. Reading the whole history also fills in changes made before this existed.
 * A failure is returned as `error` and never fails the status read (the name is a nicety, the status is the job); ReconnectNeeded propagates.
 */
export async function recordStatusHistory(deps: HistoryDeps, keys: string[]): Promise<HistoryRecord> {
  const valid = [...new Set(keys.filter((k) => ISSUE_KEY.test(k)))];
  const out: HistoryRecord = { issues: 0, changes: 0, error: null };
  for (let i = 0; i < valid.length; i += KEY_BATCH) {
    const batch = valid.slice(i, i + KEY_BATCH);
    try {
      const page = (await deps.getPage(historyPath(batch))) as { issues?: HistoryIssue[] };
      const rows: StatusChangeRow[] = [];
      for (const raw of page.issues ?? []) {
        if (typeof raw.key !== "string" || !batch.includes(raw.key)) continue; // only what was asked for
        out.issues++;
        rows.push(...statusChangesOf(raw));
      }
      for (let j = 0; j < rows.length; j += 500) await deps.save(rows.slice(j, j + 500));
      out.changes += rows.length;
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      out.error = e instanceof Error ? e.message.slice(0, 200) : "unknown";
    }
  }
  return out;
}
