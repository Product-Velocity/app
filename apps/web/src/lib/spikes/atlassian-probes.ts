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
const MARK = "pv spike j8";

/** The Product Discovery fields the build needs. Matched by NAME in /field (ids differ per site, never assumed). */
export const IDEA_FIELD_NAMES = ["Impact", "Effort", "Theme", "Idea short description", "Roadmap"] as const;

type Meta = { name?: unknown; schema?: Obj; allowedValues?: unknown };
type Attempt = { value: unknown; kind: string };
const adf = (...blocks: Obj[]): Obj => ({ type: "doc", version: 1, content: blocks });
const para = (t: string): Obj => ({ type: "paragraph", content: [{ type: "text", text: t }] });
/** Sent as the description: heading, paragraph with bold, bullet list. Only node TYPES are ever printed. */
const SPIKE_ADF = adf({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: MARK }] }, { type: "paragraph", content: [{ type: "text", text: MARK, marks: [{ type: "strong" }] }] }, { type: "bulletList", content: [{ type: "listItem", content: [para(MARK)] }] });
const nodeTypes = (n: unknown): string[] => { const o = obj(n); return [typeof o.type === "string" ? o.type : "?", ...(Array.isArray(o.content) ? (o.content as unknown[]).flatMap(nodeTypes) : [])]; };
const textOf = (n: unknown): string => { const o = obj(n); return (typeof o.text === "string" ? o.text : "") + (Array.isArray(o.content) ? (o.content as unknown[]).map(textOf).join("") : ""); };
const kindOf = (v: unknown): string => (v === null || v === undefined ? "empty" : Array.isArray(v) ? `array of ${v.length ? kindOf(v[0]) : "nothing"}` : typeof v === "object" ? (obj(v).type === "doc" ? "ADF" : `object{${Object.keys(obj(v)).sort().join(",")}}`) : typeof v);

/** Candidate values for one field, from the schema and allowed values Jira reports. The first that Jira accepts is the writable shape. */
export function valueCandidates(m: Meta): Attempt[] {
  const sc = obj(m.schema);
  const type = String(sc.type ?? ""), items = String(sc.items ?? ""), custom = String(sc.custom ?? "");
  const allowed = arr(m.allowedValues);
  if (allowed.length) {
    const a = allowed[0]!;
    const one = a.id !== undefined ? { id: String(a.id) } : { value: a.value };
    return type === "array" ? [{ value: [one], kind: "array of option{id}" }] : [{ value: one, kind: a.id !== undefined ? "option{id}" : "option{value}" }];
  }
  if (type === "number") return [{ value: 1, kind: "number" }];
  if (type === "date") return [{ value: "2026-12-31", kind: "date string" }];
  if (type === "array" && items === "string") return [{ value: [IDEA_LABEL], kind: "array of string" }];
  if (type === "string") return /textarea|rich|description/i.test(custom) ? [{ value: SPIKE_ADF, kind: "ADF" }, { value: MARK, kind: "plain string" }] : [{ value: MARK, kind: "plain string" }, { value: SPIKE_ADF, kind: "ADF" }];
  return [];
}

/** Same value read back, reduced to something comparable without printing it. */
function sameValue(sent: Attempt, got: unknown): boolean {
  if (sent.kind === "ADF") return JSON.stringify(nodeTypes(sent.value)) === JSON.stringify(nodeTypes(got)) && textOf(sent.value) === textOf(got);
  if (sent.kind.startsWith("option") || sent.kind.startsWith("array of option")) {
    const idOf = (x: unknown): string => String(obj(Array.isArray(x) ? x[0] : x).id ?? obj(Array.isArray(x) ? x[0] : x).value ?? "");
    return idOf(sent.value) !== "" && idOf(sent.value) === idOf(got);
  }
  return JSON.stringify(sent.value) === JSON.stringify(got);
}

const refused = (r: { status: number; json: unknown }) => whyJira(r.json) || `refused (${r.status})`;

/**
 * J8: can an idea be written in a Jira Product Discovery project? Creates ONE idea, writes each Product Discovery field and the ADF description
 * one request at a time, reads everything back and compares, then deletes the idea. Prints status codes, field ids, kinds and structure only.
 * Refuses anything but a product_discovery project.
 */
export async function probeIdeaWrite(call: ProbeCall, projectKey: string): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];
  const created: string[] = [];
  try {
    const p = await call("GET", `/project/${projectKey}`);
    const pj = obj(p.json);
    if (pj.projectTypeKey !== "product_discovery") return [{ label: "Idea write (J8)", status: p.status, note: "That project is not a Product Discovery project; nothing was written." }];
    const idea = arr(pj.issueTypes).find((t) => String(t.name) === "Idea") ?? arr(pj.issueTypes).find((t) => Number(t.hierarchyLevel) === 0 && !t.subtask);
    if (!idea) return [{ label: "Idea write (J8)", status: p.status, note: "No Idea issue type; nothing was written." }];

    // Fields by name, from /field (ids are per site).
    const f = await call("GET", "/field");
    const all = arr(f.json);
    const found = IDEA_FIELD_NAMES.map((n) => ({ name: n, def: all.find((x) => String(x.name).toLowerCase() === n.toLowerCase()) }));
    steps.push({ label: "Product Discovery fields in /field (by name)", status: f.status, note: found.map((x) => x.def ? `${x.name}: ${String(x.def.id)} (${String(obj(x.def.schema).type ?? "?")}${obj(x.def.schema).custom ? `, ${String(obj(x.def.schema).custom).split(":").pop()}` : ""})` : `${x.name}: not found`).join("\n") });

    const c = await call("POST", "/issue", { fields: { project: { key: projectKey }, issuetype: { id: String(idea.id) }, summary: "PV spike J8 test idea (safe to delete)", labels: [IDEA_LABEL] } });
    const key = String(obj(c.json).key ?? "");
    if (key) created.push(key);
    steps.push({ label: "Create an idea (summary, label)", status: c.status, note: key ? `created ${key}` : refused(c) });
    if (!key) return steps;

    const u = await call("PUT", `/issue/${key}`, { fields: { summary: "PV spike J8 test idea, edited (safe to delete)" } });
    steps.push({ label: "Edit the idea's summary", status: u.status, note: u.status === 204 ? "updated" : refused(u) });
    const t = await call("GET", `/issue/${key}?expand=transitions&fields=summary`);
    steps.push({ label: "Transitions of an idea (read only)", status: t.status, note: arr(obj(t.json).transitions).map((x) => String(x.name)).join(", ") || "none" });

    // What the idea says is editable (shapes + allowed values).
    const em = await call("GET", `/issue/${key}/editmeta`);
    const editable = obj(obj(em.json).fields);
    steps.push({ label: "Editable fields of the idea (editmeta)", status: em.status, note: `${Object.keys(editable).length} editable fields; ${found.filter((x) => x.def && editable[String(x.def.id)]).map((x) => x.name).join(", ") || "none of the Product Discovery fields"} listed` });

    // Each field on its own, so one refusal does not hide the others.
    const written: { id: string; name: string; sent: Attempt }[] = [];
    for (const x of found) {
      if (!x.def) continue;
      const id = String(x.def.id);
      const meta: Meta = { name: x.name, schema: obj(editable[id]).schema ? obj(obj(editable[id]).schema) : obj(x.def.schema), allowedValues: obj(editable[id]).allowedValues };
      const cands = valueCandidates(meta);
      const inMeta = editable[id] ? "in editmeta" : "NOT in editmeta";
      if (!cands.length) { steps.push({ label: `Set ${x.name} (${id})`, status: 0, note: `${inMeta}; no known value shape for type ${String(obj(meta.schema).type ?? "?")}; not tried` }); continue; }
      let last = { status: 0, json: {} as unknown };
      let ok: Attempt | null = null;
      const tried: string[] = [];
      for (const cand of cands) {
        last = await call("PUT", `/issue/${key}`, { fields: { [id]: cand.value } });
        tried.push(`${cand.kind}: ${last.status}`);
        if (last.status === 204) { ok = cand; break; }
      }
      if (ok) written.push({ id, name: x.name, sent: ok });
      steps.push({ label: `Set ${x.name} (${id})`, status: last.status, note: ok ? `writable as ${ok.kind} (${inMeta}); tried ${tried.join(", ")}` : `refused (${inMeta}); tried ${tried.join(", ")}; ${refused(last)}` });
    }

    // Description as ADF (the system field).
    const d = await call("PUT", `/issue/${key}`, { fields: { description: SPIKE_ADF } });
    steps.push({ label: "Description as ADF (heading, bold paragraph, bullet list)", status: d.status, note: d.status === 204 ? "accepted" : refused(d) });

    // Read back and compare.
    const ids = ["summary", "labels", "description", ...written.map((w) => w.id)];
    const rb = await call("GET", `/issue/${key}?fields=${ids.map(encodeURIComponent).join(",")}`);
    const got = obj(obj(rb.json).fields);
    const lines: string[] = [];
    lines.push(`summary: ${String(got.summary ?? "").includes("edited") ? "round-trips" : "DIFFERS"}`);
    lines.push(`labels: ${Array.isArray(got.labels) && (got.labels as unknown[]).includes(IDEA_LABEL) ? "round-trips" : "DIFFERS"}`);
    if (d.status === 204) lines.push(`description: ${sameValue({ value: SPIKE_ADF, kind: "ADF" }, got.description) ? "round-trips (same node types and text)" : `DIFFERS; node types read back: ${nodeTypes(got.description).join(" > ") || "none"}`}`);
    for (const w of written) lines.push(`${w.name} (${w.id}): ${sameValue(w.sent, got[w.id]) ? "round-trips" : `DIFFERS (sent ${w.sent.kind}, read back ${kindOf(got[w.id])})`}`);
    steps.push({ label: "Read back and compare", status: rb.status, note: lines.join("\n") });
  } finally {
    for (const key of created.reverse()) {
      const d = await call("DELETE", `/issue/${key}`);
      steps.push({ label: `Delete ${key}`, status: d.status, note: d.status === 204 ? "deleted" : `NOT deleted, remove it by hand (${whyJira(d.json) || "refused"})` });
    }
  }
  return steps;
}

/**
 * J8, linking: creates ONE idea (discovery project) and ONE Epic (software project), tries every issue link type between them (each link is removed
 * again straight away), then tries the epic's `parent` field pointed at the idea. Deletes both. Only runs on the explicit mode `idea-link`
 * with arg "DISCOVERYKEY,SOFTWAREKEY". Prints link type names (site configuration, not issue text), status codes and structure.
 */
export async function probeIdeaLink(call: ProbeCall, arg: string): Promise<ProbeStep[]> {
  const [discKey = "", swKey = ""] = arg.split(",").map((x) => x.trim());
  const keyOk = (k: string) => /^[A-Z][A-Z0-9_]{1,19}$/.test(k);
  if (!keyOk(discKey) || !keyOk(swKey) || discKey === swKey) return [{ label: "Idea to epic link (J8)", status: 0, note: "Needs arg=DISCOVERYKEY,SOFTWAREKEY (two different project keys); nothing was written." }];
  const steps: ProbeStep[] = [];
  const created: string[] = [];
  const links: string[] = [];
  try {
    const [dp, sp] = [await call("GET", `/project/${discKey}`), await call("GET", `/project/${swKey}`)];
    if (obj(dp.json).projectTypeKey !== "product_discovery") return [{ label: "Idea to epic link (J8)", status: dp.status, note: `${discKey} is not a Product Discovery project; nothing was written.` }];
    if (obj(sp.json).projectTypeKey !== "software") return [{ label: "Idea to epic link (J8)", status: sp.status, note: `${swKey} is not a software project; nothing was written.` }];
    const ideaType = arr(obj(dp.json).issueTypes).find((t) => String(t.name) === "Idea") ?? arr(obj(dp.json).issueTypes).find((t) => Number(t.hierarchyLevel) === 0 && !t.subtask);
    const epicType = arr(obj(sp.json).issueTypes).find((t) => Number(t.hierarchyLevel) === 1);
    if (!ideaType || !epicType) return [{ label: "Idea to epic link (J8)", status: 200, note: "No Idea type or no Epic type; nothing was written." }];

    const lt = await call("GET", "/issueLinkType");
    const types = arr(obj(lt.json).issueLinkTypes);
    steps.push({ label: "Issue link types", status: lt.status, note: types.map((x) => `${String(x.name)} (${String(x.outward)} / ${String(x.inward)})`).join("\n") || "none" });

    const i = await call("POST", "/issue", { fields: { project: { key: discKey }, issuetype: { id: String(ideaType.id) }, summary: "PV spike J8 link test idea (safe to delete)", labels: [IDEA_LABEL] } });
    const idea = String(obj(i.json).key ?? "");
    if (idea) created.push(idea);
    steps.push({ label: "Create the idea", status: i.status, note: idea ? `created ${idea}` : refused(i) });
    if (!idea) return steps;
    const e = await call("POST", "/issue", { fields: { project: { key: swKey }, issuetype: { id: String(epicType.id) }, summary: "PV spike J8 link test epic (safe to delete)", labels: [IDEA_LABEL] } });
    const epic = String(obj(e.json).key ?? "");
    if (epic) created.push(epic);
    steps.push({ label: "Create the epic", status: e.status, note: epic ? `created ${epic}` : refused(e) });
    if (!epic) return steps;

    // Every link type, one at a time, outward = the idea.
    const results: string[] = [];
    for (const lk of types.slice(0, 12)) {
      const name = String(lk.name);
      const r = await call("POST", "/issueLink", { type: { name }, outwardIssue: { key: idea }, inwardIssue: { key: epic } });
      let note = `${name}: ${r.status}`;
      if (r.status === 201) {
        const rb = await call("GET", `/issue/${idea}?fields=issuelinks`);
        const found = arr(obj(obj(rb.json).fields).issuelinks).filter((l) => obj(l.type).name === name);
        const seenFromIdea = found.length > 0;
        const rbEpic = await call("GET", `/issue/${epic}?fields=issuelinks`);
        const seenFromEpic = arr(obj(obj(rbEpic.json).fields).issuelinks).some((l) => obj(l.type).name === name);
        note += ` (visible on idea: ${seenFromIdea ? "yes" : "NO"}, on epic: ${seenFromEpic ? "yes" : "NO"})`;
        for (const l of found) {
          const id = String(l.id);
          links.push(id);
          const d = await call("DELETE", `/issueLink/${id}`);
          note += d.status === 204 ? ", removed" : `, NOT removed (${d.status})`;
          links.splice(links.indexOf(id), 1);
        }
      } else note += ` ${refused(r)}`.slice(0, 160);
      results.push(note);
    }
    steps.push({ label: "Link idea (outward) to epic (inward), per link type", status: 200, note: results.join("\n") || "no link types" });

    // Parent: expected to be refused (an idea is level 0, an epic cannot be its child), recorded either way.
    const pr = await call("PUT", `/issue/${epic}`, { fields: { parent: { key: idea } } });
    steps.push({ label: "Epic parent = idea (hierarchy)", status: pr.status, note: pr.status === 204 ? "ACCEPTED (check the hierarchy!)" : refused(pr) });
  } finally {
    for (const l of links) await call("DELETE", `/issueLink/${l}`);
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
