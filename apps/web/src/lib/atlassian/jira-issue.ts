import { withBackoff, type JiraRequest, type Sleep } from "./jira-write";
import type { JiraNow } from "./jira-sync-core";

// Reading ONE issue (and finding an issue by its marker label) for Sync with Jira. Read only; text from Jira is data and is cut and cleaned
// by the comparison, never interpreted. Pure over an injected request, so it is tested with a fake Jira.

const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

export type IssueRead = { ok: true; issue: JiraNow & { key: string; id: string | null } } | { ok: false; kind: "gone" | "reconnect" | "unavailable"; message: string };

export async function readIssue(call: JiraRequest, key: string, sleep?: Sleep): Promise<IssueRead> {
  if (!KEY.test(key)) return { ok: false, kind: "gone", message: "Not a Jira issue key." };
  const r = await withBackoff(() => call("GET", `/issue/${key}?fields=summary,description,labels`), sleep);
  if (r.status === 404) return { ok: false, kind: "gone", message: "Jira did not return this issue (deleted, moved or not visible to the connection). Nothing was changed." };
  if (r.status === 401) return { ok: false, kind: "reconnect", message: "Jira refused the sign-in. Sign in again (Settings, Integrations, Jira)." };
  if (r.status !== 200) return { ok: false, kind: "unavailable", message: "Jira could not be read just now. Try again in a minute." };
  const o = obj(r.json);
  const f = obj(o.fields);
  return { ok: true, issue: { key, id: typeof o.id === "string" ? o.id : null, summary: typeof f.summary === "string" ? f.summary : "", description: f.description ?? null, labels: Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === "string") : [] } };
}

/** An issue of the project that already carries the marker label (a create whose answer was lost): its key and id, or null. */
export async function findByMarker(call: JiraRequest, projectKey: string, marker: string, sleep?: Sleep): Promise<{ key: string; id: string | null } | null> {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey) || !/^[A-Za-z0-9:_.-]{1,24}\/[0-9a-f]{16}$/.test(marker)) return null;
  const jql = `project = ${projectKey} AND labels = "${marker}"`;
  const r = await withBackoff(() => call("GET", `/search/jql?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=2`), sleep);
  if (r.status !== 200) return null;
  const first = Array.isArray(obj(r.json).issues) ? (obj(r.json).issues as unknown[])[0] : null;
  const k = obj(first).key;
  return typeof k === "string" && KEY.test(k) ? { key: k, id: typeof obj(first).id === "string" ? String(obj(first).id) : null } : null;
}
