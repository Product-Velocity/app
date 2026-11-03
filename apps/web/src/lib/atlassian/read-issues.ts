// Slice C1 of issue #67: read the OPEN work of one linked Jira project into light rows (key, title, type, status category, parent).
// Pure over an injected `getPage`, so paging, limits and mapping are tested without a network. Text from Jira is data: titles are
// cleaned and cut, nothing in it is ever interpreted. Reading never writes to Jira.

export type JiraIssueRow = {
  key: string;
  id: string | null;
  title: string;
  type: string | null;
  level: number | null;
  labels: string[];
  status: string | null;
  category: "new" | "indeterminate" | "done" | null;
  parent: string | null;
  url: string | null;
  updated: string | null;
};

export type RawIssue = {
  id?: string;
  key?: string;
  fields?: {
    summary?: unknown;
    issuetype?: { name?: unknown; hierarchyLevel?: unknown };
    status?: { name?: unknown; statusCategory?: { key?: unknown } };
    labels?: unknown;
    parent?: { key?: unknown };
    updated?: unknown;
    assignee?: { displayName?: unknown } | null;
  };
};
export type SearchPage = { issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean };

export const PAGE_SIZE = 100;
export const MAX_PAGES = 10;
const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;

/** Titles are shown as text only: control characters go, whitespace collapses, 300 characters at most. */
export function cleanTitle(v: unknown): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "(no title)";
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const category = (v: unknown): JiraIssueRow["category"] => (v === "new" || v === "indeterminate" || v === "done" ? v : null);

export function mapIssue(raw: RawIssue, siteUrl: string): JiraIssueRow | null {
  const key = raw.key;
  if (typeof key !== "string" || !KEY.test(key)) return null;
  const f = raw.fields ?? {};
  const parent = typeof f.parent?.key === "string" && KEY.test(f.parent.key) ? f.parent.key : null;
  const level = typeof f.issuetype?.hierarchyLevel === "number" && Number.isInteger(f.issuetype.hierarchyLevel) ? f.issuetype.hierarchyLevel : null;
  const updated = typeof f.updated === "string" && !Number.isNaN(Date.parse(f.updated)) ? new Date(f.updated).toISOString() : null;
  return {
    key,
    id: typeof raw.id === "string" && /^[0-9]{1,20}$/.test(raw.id) ? raw.id : null,
    title: cleanTitle(f.summary),
    type: text(f.issuetype?.name, 80),
    level,
    labels: Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === "string" && l.length > 0 && l.length <= 100).slice(0, 50) : [],
    status: text(f.status?.name, 100),
    category: category(f.status?.statusCategory?.key),
    parent,
    url: /^https:\/\/[A-Za-z0-9.-]+$/.test(siteUrl) ? `${siteUrl}/browse/${key}` : null,
    updated,
  };
}

/** The JQL for the open work of one project; the key was validated when the project was linked. */
export function openWorkJql(projectKey: string): string {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey)) throw new Error("Not a Jira project key");
  return `project = "${projectKey}" AND statusCategory != Done ORDER BY updated DESC`;
}

export function searchPath(projectKey: string, pageToken?: string): string {
  const q = new URLSearchParams({ jql: openWorkJql(projectKey), maxResults: String(PAGE_SIZE), fields: "summary,issuetype,status,labels,parent,updated" });
  if (pageToken) q.set("nextPageToken", pageToken);
  return `/search/jql?${q.toString()}`;
}

/** Reads page after page (token paging) up to MAX_PAGES; `truncated` says there was more than that. */
export async function readOpenWork(getPage: (path: string) => Promise<SearchPage>, projectKey: string, siteUrl: string): Promise<{ rows: JiraIssueRow[]; truncated: boolean; pages: number }> {
  const rows: JiraIssueRow[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await getPage(searchPath(projectKey, token));
    pages++;
    for (const raw of page.issues ?? []) {
      const row = mapIssue(raw, siteUrl);
      if (row && row.key.startsWith(`${projectKey}-`) && !seen.has(row.key)) {
        seen.add(row.key);
        rows.push(row);
      }
    }
    if (page.isLast !== false || !page.nextPageToken) return { rows, truncated: false, pages };
    if (pages >= MAX_PAGES) return { rows, truncated: true, pages };
    token = page.nextPageToken;
  }
}

// ---- Refresh of linked issues (issue #67, #71): read specific issues by key, to follow their status. Read only, like everything here. ----

export const KEY_BATCH = 100;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;

/** `key in (...)` for up to KEY_BATCH keys; every key is validated, so nothing from outside can shape the query. */
export function keysJql(keys: string[]): string {
  if (keys.length === 0 || keys.length > KEY_BATCH || !keys.every((k) => ISSUE_KEY.test(k))) throw new Error("Not a list of Jira issue keys");
  return `key in (${keys.map((k) => `"${k}"`).join(", ")})`;
}

export function keysPath(keys: string[], pageToken?: string): string {
  const q = new URLSearchParams({ jql: keysJql(keys), maxResults: String(KEY_BATCH), fields: "summary,issuetype,status,labels,parent,updated" });
  if (pageToken) q.set("nextPageToken", pageToken);
  return `/search/jql?${q.toString()}`;
}

const isBadRequest = (e: unknown) => e instanceof Error && /answered 400\b/.test(e.message);

async function readBatch(getPage: (path: string) => Promise<SearchPage>, keys: string[], siteUrl: string, out: Map<string, JiraIssueRow>, gone: Set<string>): Promise<void> {
  try {
    let token: string | undefined;
    for (let pages = 0; pages < 3; pages++) {
      const page = await getPage(keysPath(keys, token));
      for (const raw of page.issues ?? []) {
        const row = mapIssue(raw, siteUrl);
        if (row && keys.includes(row.key)) out.set(row.key, row);
      }
      if (page.isLast !== false || !page.nextPageToken) return;
      token = page.nextPageToken;
    }
  } catch (e) {
    // Jira refuses a `key in (...)` that names an issue that does not exist or is not visible (400). Halve the batch until the one
    // key is found; that key is reported as gone instead of failing the whole read. Any other error (401, 429, 5xx) is thrown.
    if (!isBadRequest(e)) throw e;
    if (keys.length === 1) { gone.add(keys[0]!); return; }
    const mid = Math.ceil(keys.length / 2);
    await readBatch(getPage, keys.slice(0, mid), siteUrl, out, gone);
    await readBatch(getPage, keys.slice(mid), siteUrl, out, gone);
  }
}

/** Reads the given issues by key, 100 per call. `missing` = asked for but not returned (deleted, moved or not visible): never an error, never a change. */
export async function readIssuesByKey(getPage: (path: string) => Promise<SearchPage>, keys: string[], siteUrl: string): Promise<{ rows: JiraIssueRow[]; missing: string[] }> {
  const wanted = [...new Set(keys.filter((k) => ISSUE_KEY.test(k)))];
  const found = new Map<string, JiraIssueRow>();
  const gone = new Set<string>();
  for (let i = 0; i < wanted.length; i += KEY_BATCH) await readBatch(getPage, wanted.slice(i, i + KEY_BATCH), siteUrl, found, gone);
  return { rows: [...found.values()], missing: wanted.filter((k) => !found.has(k)) };
}
