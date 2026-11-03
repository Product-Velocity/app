import { ReconnectNeeded } from "./token-provider";

// The Jira write client for Sync (issue #67/#71). Pure over an injected `call`, so it is tested with a fake Jira. It creates or updates ONE issue
// per call, retries a 429 (and 503) with back-off that honours Retry-After, never retries a refusal (4xx), and turns ReconnectNeeded into
// "sign in again" without a loop. It has no way to transition an issue or to delete one: only create and update (rule 6). The one transition that exists (closing the issue of a removed initiative) lives in jira-close.ts.

export type JiraRequest = (method: "GET" | "POST" | "PUT", path: string, body?: unknown) => Promise<{ status: number; json: unknown; retryAfterSec?: number }>;
export type WriteOutcome =
  | { ok: true; key: string; id: string | null; created: boolean }
  | { ok: false; kind: "reconnect" | "rejected" | "rate_limited" | "unavailable" | "gone"; message: string };

const MAX_TRIES = 4;
const BASE_MS = 1000;
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

/** Jira's own error text, short and as plain text (it is data, never interpreted). */
export function whyJira(json: unknown): string {
  const o = obj(json);
  const parts = [...(Array.isArray(o.errorMessages) ? (o.errorMessages as unknown[]).map(String) : []), ...Object.entries(obj(o.errors)).map(([k, v]) => `${k}: ${String(v)}`)];
  return parts.join("; ").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
}

/** One request with back-off. Returns the last answer; throws only what the transport throws (ReconnectNeeded among it). */
export async function withBackoff(req: () => ReturnType<JiraRequest>, sleep: Sleep = realSleep): Promise<Awaited<ReturnType<JiraRequest>>> {
  let last!: Awaited<ReturnType<JiraRequest>>;
  for (let n = 0; n < MAX_TRIES; n++) {
    last = await req();
    if (last.status !== 429 && last.status !== 503) return last;
    if (n < MAX_TRIES - 1) await sleep(Math.min(30000, Math.max(last.retryAfterSec ? last.retryAfterSec * 1000 : 0, BASE_MS * 2 ** n)));
  }
  return last;
}

async function run(req: () => ReturnType<JiraRequest>, sleep: Sleep): Promise<{ r: Awaited<ReturnType<JiraRequest>> } | { fail: Extract<WriteOutcome, { ok: false }> }> {
  try {
    return { r: await withBackoff(req, sleep) };
  } catch (e) {
    if (e instanceof ReconnectNeeded) return { fail: { ok: false, kind: "reconnect", message: "Jira needs you to sign in again (Settings, Integrations, Jira). Nothing was written." } };
    return { fail: { ok: false, kind: "unavailable", message: "Jira could not be reached. Try again." } };
  }
}

/** Create an issue; the body is built by buildJiraPayload. 201 gives the key. */
export async function createIssue(call: JiraRequest, fields: Record<string, unknown>, sleep: Sleep = realSleep): Promise<WriteOutcome> {
  const x = await run(() => call("POST", "/issue", { fields }), sleep);
  if ("fail" in x) return x.fail;
  const { status, json } = x.r;
  if (status === 201 && typeof obj(json).key === "string") return { ok: true, key: String(obj(json).key), id: typeof obj(json).id === "string" ? String(obj(json).id) : null, created: true };
  return failure(status, json);
}
/** Update an issue's fields (PUT answers 204). A 404 means the issue is gone or hidden: nothing is recreated. */
export async function updateIssue(call: JiraRequest, key: string, fields: Record<string, unknown>, sleep: Sleep = realSleep): Promise<WriteOutcome> {
  if (!/^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/.test(key)) return { ok: false, kind: "rejected", message: "Not a Jira issue key." };
  const x = await run(() => call("PUT", `/issue/${key}`, { fields }), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status === 204 || x.r.status === 200) return { ok: true, key, id: null, created: false };
  return failure(x.r.status, x.r.json);
}
function failure(status: number, json: unknown): Extract<WriteOutcome, { ok: false }> {
  const why = whyJira(json);
  if (status === 401) return { ok: false, kind: "reconnect", message: "Jira refused the sign-in. Sign in again (Settings, Integrations, Jira)." };
  if (status === 404) return { ok: false, kind: "gone", message: "The Jira issue no longer exists or you cannot see it. Nothing was recreated." };
  if (status === 429) return { ok: false, kind: "rate_limited", message: "Jira is limiting requests right now. Try again in a minute." };
  if (status >= 500) return { ok: false, kind: "unavailable", message: "Jira had a problem. Try again." };
  return { ok: false, kind: "rejected", message: why ? `Jira refused it: ${why}` : `Jira refused it (${status}).` };
}
