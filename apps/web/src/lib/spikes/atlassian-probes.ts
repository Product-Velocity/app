// Spikes J3, J5, J6, J8 (#257): probes for Ashu to run on the sandbox Jira site. Pure over an injected `call`, tested with a fake Jira.
// Nothing here prints a site URL, account id, email or issue text: only counts, status codes, header names and structure.
// Read probes (paging, development info) write nothing. The write probes (idea, webhook) create ONE object each and always remove it again.
import { withBackoff, whyJira, type Sleep } from "@/lib/atlassian/jira-write";

export type ProbeCall = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<{ status: number; json: unknown; retryAfterSec?: number; headers?: Record<string, string> }>;
export type ProbeStep = { label: string; status: number; note: string };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** Rate-limit headers Atlassian may send; only their presence and values are recorded (no issue data). */
const RATE_HEADERS = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-nearlimit", "ratelimit-reason", "beta-retry-after"];
export const pickRateHeaders = (h: Record<string, string> | undefined): string => RATE_HEADERS.filter((k) => h?.[k] !== undefined).map((k) => `${k}=${h![k]}`).join(", ") || "none";

/**
 * J6: pages through ALL issues of a JQL with nextPageToken and reports pages, issues, page size actually returned, seconds, 429s and rate headers.
 * Needs a site with more than 100 issues to prove anything (the sandbox has 10: create 250 with Jira's CSV import or bulk create first).
 */
export async function probePaging(call: ProbeCall, jql: string, opts: { now?: () => number; sleep?: Sleep; maxPages?: number } = {}): Promise<ProbeStep[]> {
  const now = opts.now ?? Date.now;
  const started = now();
  let token: string | undefined;
  let pages = 0, issues = 0, tooMany = 0;
  const sizes: number[] = [];
  let last = "none";
  const seen = new Set<string>();
  let dupes = 0;
  for (;;) {
    const q = new URLSearchParams({ jql, maxResults: "100", fields: "summary" });
    if (token) q.set("nextPageToken", token);
    const r = await withBackoff(async () => { const x = await call("GET", `/search/jql?${q}`); if (x.status === 429) tooMany++; return x; }, opts.sleep);
    last = pickRateHeaders((r as { headers?: Record<string, string> }).headers);
    if (r.status !== 200) return [{ label: "Paging (J6)", status: r.status, note: `stopped after ${pages} pages, ${issues} issues: ${whyJira(r.json) || "no detail"}; headers: ${last}` }];
    const list = arr(obj(r.json).issues);
    pages++; issues += list.length; sizes.push(list.length);
    for (const i of list) { const k = String(i.key); if (seen.has(k)) dupes++; seen.add(k); }
    const next = obj(r.json).nextPageToken;
    if (obj(r.json).isLast === true || typeof next !== "string" || pages >= (opts.maxPages ?? 50)) break;
    token = next;
  }
  return [{ label: "Paging (J6)", status: 200, note: `${pages} pages, ${issues} issues (${dupes} duplicates across pages)\npage sizes returned: ${sizes.slice(0, 12).join(", ")}${sizes.length > 12 ? ", ..." : ""} (asked for 100)\nseconds: ${((now() - started) / 1000).toFixed(1)}\n429 answers: ${tooMany}\nrate-limit headers on the last page: ${last}` }];
}

/**
 * J5, read only: does Jira expose the development information (branches, pull requests, builds) of an issue through the public REST API?
 * Jira keeps it in a "Development" summary custom field. The probe finds that field in /field and reports only the SHAPE of its value for one
 * issue (keys, counts), never text. The internal dev-status endpoint is not tried: it is not a supported API for OAuth apps.
 */
export async function probeDevInfo(call: ProbeCall, issueKey: string): Promise<ProbeStep[]> {
  if (!/^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/.test(issueKey)) return [{ label: "Development info (J5)", status: 0, note: "Not an issue key." }];
  const f = await call("GET", "/field");
  const field = arr(f.json).find((x) => /development/i.test(String(obj(x.schema).custom ?? "")) || String(x.name) === "Development");
  const steps: ProbeStep[] = [{ label: "Development field in the field list", status: f.status, note: field ? `found (${String(field.id)})` : "not found" }];
  if (!field) return steps;
  const r = await call("GET", `/issue/${issueKey}?fields=${encodeURIComponent(String(field.id))}`);
  const v = obj(obj(r.json).fields)[String(field.id)];
  const shape = typeof v === "string" ? `string of ${v.length} characters (summary JSON?)` : v === null || v === undefined ? "empty" : `keys: ${Object.keys(obj(v)).join(", ") || typeof v}`;
  steps.push({ label: "Value of that field on the issue", status: r.status, note: shape });
  return steps;
}

export const IDEA_LABEL = "pv-spike";

/** J8: can an idea be written in a Jira Product Discovery project? Creates ONE idea (summary, label), edits its summary, then deletes it. */
export async function probeIdeaWrite(call: ProbeCall, projectKey: string): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];
  const created: string[] = [];
  try {
    const p = await call("GET", `/project/${projectKey}`);
    const pj = obj(p.json);
    if (pj.projectTypeKey !== "product_discovery") return [{ label: "Idea write (J8)", status: p.status, note: "That project is not a Product Discovery project; nothing was written." }];
    const idea = arr(pj.issueTypes).find((t) => String(t.name) === "Idea") ?? arr(pj.issueTypes).find((t) => Number(t.hierarchyLevel) === 0 && !t.subtask);
    if (!idea) return [{ label: "Idea write (J8)", status: p.status, note: "No Idea issue type; nothing was written." }];
    const c = await call("POST", "/issue", { fields: { project: { key: projectKey }, issuetype: { id: String(idea.id) }, summary: "PV spike J8 test idea (safe to delete)", labels: [IDEA_LABEL] } });
    const key = String(obj(c.json).key ?? "");
    if (key) created.push(key);
    steps.push({ label: "Create an idea", status: c.status, note: key ? `created ${key}` : (whyJira(c.json) || "refused") });
    if (key) {
      const u = await call("PUT", `/issue/${key}`, { fields: { summary: "PV spike J8 test idea, edited (safe to delete)" } });
      steps.push({ label: "Edit the idea's summary", status: u.status, note: u.status === 204 ? "updated" : (whyJira(u.json) || "refused") });
      const t = await call("GET", `/issue/${key}?expand=transitions&fields=summary`);
      steps.push({ label: "Transitions of an idea (read only)", status: t.status, note: arr(obj(t.json).transitions).map((x) => String(x.name)).join(", ") || "none" });
    }
  } finally {
    for (const key of created.reverse()) {
      const d = await call("DELETE", `/issue/${key}`);
      steps.push({ label: `Delete ${key}`, status: d.status, note: d.status === 204 ? "deleted" : `NOT deleted, remove it by hand (${whyJira(d.json) || "refused"})` });
    }
  }
  return steps;
}

/**
 * J3: dynamic webhook life cycle on the sandbox site: register one for issue created/updated with a JQL filter, list, refresh (extends the expiry)
 * and delete. `callbackUrl` must be https; delivery to it is observed separately (the spike route logs a count, never a body).
 * Needs the scope `manage:jira-webhook`.
 */
export async function probeWebhook(call: ProbeCall, projectKey: string, callbackUrl: string): Promise<ProbeStep[]> {
  if (!/^https:\/\//.test(callbackUrl) || !/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey)) return [{ label: "Webhook (J3)", status: 0, note: "Needs an https callback URL and a project key; nothing was registered." }];
  const steps: ProbeStep[] = [];
  let id = "";
  try {
    const r = await call("POST", "/webhook", { url: callbackUrl, webhooks: [{ events: ["jira:issue_created", "jira:issue_updated"], jqlFilter: `project = ${projectKey}` }] });
    const res = arr(obj(r.json).webhookRegistrationResult)[0] ?? {};
    id = String(arr([res])[0]?.createdWebhookId ?? "");
    steps.push({ label: "Register (events issue created/updated, JQL filter)", status: r.status, note: id ? "registered" : (JSON.stringify(res.errors ?? obj(r.json).errorMessages ?? whyJira(r.json)).slice(0, 300) || "refused") });
    if (id) {
      const l = await call("GET", "/webhook");
      const mine = arr(obj(l.json).values).find((w) => String(w.id) === id);
      steps.push({ label: "List", status: l.status, note: mine ? `expires: ${String(mine.expirationDate ?? "not reported")}` : "registered webhook not in the list" });
      const f = await call("PUT", "/webhook/refresh", { webhookIds: [Number(id)] });
      steps.push({ label: "Refresh (extend expiry)", status: f.status, note: f.status === 200 ? `new expiry: ${String(obj(f.json).expirationDate ?? "not reported")}` : (whyJira(f.json) || "refused") });
      const failed = await call("GET", "/webhook/failed");
      steps.push({ label: "Failed deliveries list", status: failed.status, note: failed.status === 200 ? `${arr(obj(failed.json).values).length} failed` : (whyJira(failed.json) || "refused") });
    }
  } finally {
    if (id) {
      const d = await call("DELETE", "/webhook", { webhookIds: [Number(id)] });
      steps.push({ label: "Delete the webhook", status: d.status, note: d.status === 202 || d.status === 204 ? "deleted" : `NOT deleted, remove it by hand (${whyJira(d.json) || "refused"})` });
    }
  }
  return steps;
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const count = (names: string[]) => [...names.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>())].map(([n, c]) => `${n} ${c}`).join(", ") || "none";

/**
 * J2 (issue #431), READ ONLY: the Initiative level and its tree on a real site. Reports which issue types sit at which hierarchy level, finds one
 * Initiative-level issue (or uses the key given), and reads what Product Velocity would read under it with the same `parent in (...)` query as
 * `jira-tree.ts`: how many children, of which types, **in how many different projects** (the cross-project question), then their children, and the
 * shape of the `parent` field on one child. Prints keys, counts and type names only; no summaries, people or addresses. Writes nothing.
 * Jira hides issues of projects the signed-in user cannot browse, so a count lower than the Jira screen shows is the permissions answer.
 */
export async function probeInitiativeTree(call: ProbeCall, issueKey = ""): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];
  const t = await call("GET", "/issuetype");
  const byLevel = new Map<number, string[]>();
  const above: string[] = [];
  for (const x of arr(t.json)) {
    const level = Number(x.hierarchyLevel);
    if (!Number.isFinite(level)) continue;
    byLevel.set(level, [...(byLevel.get(level) ?? []), String(x.name)]);
    if (level >= 2 && /^\d+$/.test(String(x.id))) above.push(String(x.id));
  }
  steps.push({ label: "Issue types by hierarchy level", status: t.status, note: [...byLevel].sort((a, b) => b[0] - a[0]).map(([l, n]) => `level ${l}: ${[...new Set(n)].join(", ")}`).join("\n") || (whyJira(t.json) || "none") });
  if (above.length === 0) return [...steps, { label: "Initiative level", status: t.status, note: "No issue type above Epic on this site (or the sign-in cannot read issue types): there is no Initiative level to read." }];

  let key = ISSUE_KEY.test(issueKey) ? issueKey : "";
  if (!key) {
    const s = await call("GET", `/search/jql?${new URLSearchParams({ jql: `issuetype in (${[...new Set(above)].join(",")}) ORDER BY key ASC`, maxResults: "1", fields: "summary" })}`);
    key = String(arr(obj(s.json).issues)[0]?.key ?? "");
    steps.push({ label: "Find an issue at the level above Epic", status: s.status, note: key ? `found ${key}` : "none found (create an Initiative with at least one epic under it, or pass its key)" });
    if (!key) return steps;
  }
  const i = await call("GET", `/issue/${key}?fields=issuetype,project`);
  const f = obj(obj(i.json).fields);
  const projectKey = String(obj(f.project).key ?? "");
  const p = PROJECT_KEY.test(projectKey) ? await call("GET", `/project/${projectKey}`) : null;
  const style = p ? `style ${String(obj(p.json).style ?? "-")}, simplified ${String(obj(p.json).simplified ?? "-")}, type ${String(obj(p.json).projectTypeKey ?? "-")}` : "unknown";
  steps.push({ label: `The Initiative-level issue ${key}`, status: i.status, note: `type ${String(obj(f.issuetype).name ?? "?")}, hierarchy level ${String(obj(f.issuetype).hierarchyLevel ?? "?")}, project ${projectKey || "?"} (${style})` });

  const children = await call("GET", `/search/jql?${new URLSearchParams({ jql: `parent in ("${key}") ORDER BY key ASC`, maxResults: "100", fields: "issuetype,project,status" })}`);
  const kids = arr(obj(children.json).issues);
  const kidProjects = kids.map((k) => String(obj(obj(obj(k).fields).project).key ?? "?"));
  const distinct = new Set(kidProjects);
  steps.push({
    label: "Children (the same `parent in (...)` query Product Velocity uses)", status: children.status,
    note: children.status === 200
      ? `${kids.length} children (isLast ${String(obj(children.json).isLast)})\ntypes: ${count(kids.map((k) => String(obj(obj(obj(k).fields).issuetype).name ?? "?")))}\nprojects: ${count(kidProjects)}\n${distinct.size > 1 ? "CROSS-PROJECT: children come from more than one project" : distinct.size === 1 ? `all in one project${distinct.has(projectKey) ? " (the Initiative's own)" : " (a different one from the Initiative's)"}` : "no children"}`
      : (whyJira(children.json) || "refused"),
  });
  if (kids.length === 0) return steps;

  const keys = kids.map((k) => String(k.key)).filter((k) => ISSUE_KEY.test(k)).slice(0, 50);
  const grand = await call("GET", `/search/jql?${new URLSearchParams({ jql: `parent in (${keys.map((k) => `"${k}"`).join(", ")}) ORDER BY key ASC`, maxResults: "100", fields: "issuetype,project" })}`);
  const g = arr(obj(grand.json).issues);
  steps.push({ label: `Children of those children (first ${keys.length})`, status: grand.status, note: grand.status === 200 ? `${g.length} issues\ntypes: ${count(g.map((x) => String(obj(obj(obj(x).fields).issuetype).name ?? "?")))}\nprojects: ${count(g.map((x) => String(obj(obj(obj(x).fields).project).key ?? "?")))}` : (whyJira(grand.json) || "refused") });

  const c = await call("GET", `/issue/${keys[0]}?fields=parent`);
  const parent = obj(obj(obj(c.json).fields).parent);
  steps.push({ label: "Shape of the parent field on one child", status: c.status, note: Object.keys(parent).length ? `keys: ${Object.keys(parent).join(", ")}; parent key ${String(parent.key ?? "?")} matches: ${String(parent.key) === key}` : "no parent field returned" });
  steps.push({ label: "Permissions check by hand", status: 200, note: "Compare the children count above with the Initiative's child count on the Jira screen. A lower number here means the signed-in user cannot browse some projects (Jira hides them silently)." });
  return steps;
}

/**
 * J2/J4 (issue #431), WRITES, removes everything it makes: creates ONE Initiative in `initiativeProject` and ONE epic in `epicProject` (both labelled
 * "pv-spike"), makes the epic a child of the Initiative, reads the parent back and the children query, then deletes the epic and the Initiative.
 * Answers: can an Initiative be created there (a team-managed project cannot), can an epic of another project take it as parent, and does the
 * children query see it. Needs Ashu's go-ahead per run (the write probes are separate links).
 */
export async function probeInitiativeWrite(call: ProbeCall, initiativeProject: string, epicProject: string): Promise<ProbeStep[]> {
  if (!PROJECT_KEY.test(initiativeProject) || !PROJECT_KEY.test(epicProject)) return [{ label: "Initiative write (J2/J4)", status: 0, note: "Needs two project keys (arg=INITIATIVES,EPICS); nothing was written." }];
  const steps: ProbeStep[] = [];
  const created: string[] = [];
  const typeAt = async (project: string, level: number) => {
    const p = await call("GET", `/project/${project}`);
    const t = arr(obj(p.json).issueTypes).find((x) => Number(x.hierarchyLevel) === level && !x.subtask);
    return { status: p.status, id: t ? String(t.id) : "", name: t ? String(t.name) : "" };
  };
  try {
    const it = await typeAt(initiativeProject, 2);
    if (!it.id) return [{ label: "Initiative type in the Initiative project", status: it.status, note: "That project has no issue type above Epic (a team-managed project cannot have one). Nothing was written." }];
    const et = await typeAt(epicProject, 1);
    if (!et.id) return [{ label: "Epic type in the epic project", status: et.status, note: "That project has no Epic level type. Nothing was written." }];
    const i = await call("POST", "/issue", { fields: { project: { key: initiativeProject }, issuetype: { id: it.id }, summary: "PV spike J2 test initiative (safe to delete)", labels: [IDEA_LABEL] } });
    const initiative = String(obj(i.json).key ?? "");
    if (initiative) created.push(initiative);
    steps.push({ label: `Create an ${it.name}`, status: i.status, note: initiative ? `created ${initiative}` : (whyJira(i.json) || "refused") });
    if (!initiative) return steps;
    const e = await call("POST", "/issue", { fields: { project: { key: epicProject }, issuetype: { id: et.id }, summary: "PV spike J2 test epic (safe to delete)", labels: [IDEA_LABEL] } });
    const epic = String(obj(e.json).key ?? "");
    if (epic) created.push(epic);
    steps.push({ label: `Create an ${et.name} in ${epicProject}`, status: e.status, note: epic ? `created ${epic}` : (whyJira(e.json) || "refused") });
    if (!epic) return steps;
    const u = await call("PUT", `/issue/${epic}`, { fields: { parent: { key: initiative } } });
    steps.push({ label: "Set the Initiative as the epic's parent", status: u.status, note: u.status === 204 ? `done${initiativeProject === epicProject ? " (same project)" : " (a different project)"}` : (whyJira(u.json) || "refused") });
    const r = await call("GET", `/issue/${epic}?fields=parent`);
    steps.push({ label: "Read the parent back", status: r.status, note: `parent key matches: ${String(obj(obj(obj(r.json).fields).parent).key) === initiative}` });
    const c = await call("GET", `/search/jql?${new URLSearchParams({ jql: `parent in ("${initiative}")`, maxResults: "10", fields: "summary" })}`);
    steps.push({ label: "The children query sees the epic", status: c.status, note: c.status === 200 ? `${arr(obj(c.json).issues).length} child(ren) found` : (whyJira(c.json) || "refused") });
  } finally {
    for (const key of created.reverse()) {
      const d = await call("DELETE", `/issue/${key}`);
      steps.push({ label: `Delete ${key}`, status: d.status, note: d.status === 204 ? "deleted" : `NOT deleted, remove it by hand (${whyJira(d.json) || "refused"})` });
    }
  }
  return steps;
}
