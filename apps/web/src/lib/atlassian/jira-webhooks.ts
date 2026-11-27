import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { whyJira, withBackoff, type JiraRequest, type Sleep } from "./jira-write";

// Jira webhooks for automated status updates (spike J3, #257; decision 2026-11-03-jira-webhooks). Pure: tested with a fake Jira.
// The delivery is a HINT. Nothing in its body is trusted or stored: the receiver takes the issue key, re-reads the issue from Jira and applies
// it through the existing refresh (compare before write, older answers ignored, Build Status from the status category, Initiative Status never).
// A forged, repeated, late or out-of-order delivery therefore cannot change anything Jira does not say. Reading only; nothing is written to Jira
// except the registration of the webhook itself.

export const WEBHOOK_EVENTS = ["jira:issue_created", "jira:issue_updated"];
/** Jira expires dynamic webhooks after 30 days (documented, unverified here: the J3 spike shows the real date). Refresh when fewer than this are left. */
export const REFRESH_WHEN_DAYS_LEFT = 20;
const KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;
const PROJECT = /^[A-Z][A-Z0-9_]{1,19}$/;

// ---- the secret in the callback URL ----
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const newSecret = () => randomBytes(24).toString("base64url");
export function secretMatches(storedHash: string, presented: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashSecret(presented), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
/** `<link id>.<secret>` is the last path segment of the callback URL. */
export const callbackUrl = (origin: string, linkId: string, secret: string) => `${origin.replace(/\/$/, "")}/api/jira/webhook/${linkId}.${secret}`;
export function parseToken(token: string): { linkId: string; secret: string } | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
  return m ? { linkId: m[1]!, secret: m[2]! } : null;
}

// ---- reading a delivery ----
/** The issue key a delivery is about, or null. Only the key is taken; every other field of the body is ignored. */
export function eventIssueKey(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const o = body as { webhookEvent?: unknown; issue?: { key?: unknown } };
  if (typeof o.webhookEvent !== "string" || !WEBHOOK_EVENTS.includes(o.webhookEvent)) return null;
  const k = o.issue?.key;
  return typeof k === "string" && KEY.test(k) ? k : null;
}

// ---- keeping webhooks alive ----
export type WebhookRow = { link_id: string; jira_webhook_id: string | null; state: "active" | "needs_scope" | "failed"; expires_at: string | null };
export type WebhookLink = { id: string; jira_project_key: string };
export type WebhookAction = { link: string; do: "register" | "refresh" | "skip"; why: string };

/** What to do for each linked project today. Pure. `needs_scope` is retried only after a new sign-in (the caller clears it). */
export function planWebhooks(links: WebhookLink[], rows: WebhookRow[], now: number): WebhookAction[] {
  const byLink = new Map(rows.map((r) => [r.link_id, r]));
  return links.map((l): WebhookAction => {
    const r = byLink.get(l.id);
    if (!r || !r.jira_webhook_id) return { link: l.id, do: "register", why: "none yet" };
    if (r.state === "needs_scope") return { link: l.id, do: "skip", why: "sign in to Jira again to allow webhooks" };
    const left = r.expires_at ? (Date.parse(r.expires_at) - now) / 86_400_000 : 0;
    if (r.state === "failed" || left <= 0) return { link: l.id, do: "register", why: left <= 0 ? "expired" : "failed before" };
    return left < REFRESH_WHEN_DAYS_LEFT ? { link: l.id, do: "refresh", why: `${Math.floor(left)} days left` } : { link: l.id, do: "skip", why: "fresh" };
  });
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

export type RegisterOutcome = { ok: true; id: string } | { ok: false; kind: "needs_scope" | "rejected" | "unavailable" | "single_url"; message: string };

/** Registers one webhook for one project (events: issue created/updated, JQL filter on the project). The URL must be https. */
export async function registerWebhook(call: JiraRequest, url: string, projectKey: string, sleep?: Sleep): Promise<RegisterOutcome> {
  if (!/^https:\/\//.test(url) || !PROJECT.test(projectKey)) return { ok: false, kind: "rejected", message: "Needs an https address and a Jira project key." };
  const r = await withBackoff(() => call("POST", "/webhook", { url, webhooks: [{ events: WEBHOOK_EVENTS, jqlFilter: `project = ${projectKey}` }] }), sleep);
  if (r.status === 401 || r.status === 403) return { ok: false, kind: "needs_scope", message: "Jira did not allow webhooks for this sign-in. Sign in again to Jira with the webhook permission." };
  if (r.status >= 500 || r.status === 429) return { ok: false, kind: "unavailable", message: "Jira could not register the webhook now. It is tried again tomorrow." };
  const first = obj(Array.isArray(obj(r.json).webhookRegistrationResult) ? (obj(r.json).webhookRegistrationResult as unknown[])[0] : null);
  const id = first.createdWebhookId;
  if (r.status === 200 && (typeof id === "number" || typeof id === "string") && /^[0-9]{1,20}$/.test(String(id))) return { ok: true, id: String(id) };
  const errs = Array.isArray(first.errors) ? (first.errors as unknown[]).map(String).join("; ") : "";
  const why = errs || whyJira(r.json) || `Jira refused it (${r.status}).`;
  // Jira allows ONE callback address per sign-in; one still held from before a reconnect blocks the new one (issue 744): the answer names it, so it is kept whole
  if (/single URL per user/i.test(why)) return { ok: false, kind: "single_url", message: why.slice(0, 600) };
  return { ok: false, kind: "rejected", message: why.slice(0, 300) };
}

// ---- an address Jira still holds from before a reconnect (issue 744) ----
export type HeldUrl = { url: string; linkId: string; secret: string };
/** The address Jira says it already holds for this sign-in ("Only a single URL per user ... The currently used URL: <url>"), only when it is OUR address with a well-formed token. */
export function heldUrlFrom(message: string, origin: string): HeldUrl | null {
  if (!/single URL per user/i.test(message)) return null;
  const m = /currently used URL:\s*(https:\/\/\S+)/i.exec(message);
  if (!m) return null;
  const url = m[1]!.replace(/[.,;)]+$/, "");
  const base = `${origin.replace(/\/$/, "")}/api/jira/webhook/`;
  if (!url.startsWith(base)) return null;
  const t = parseToken(url.slice(base.length));
  return t ? { url, linkId: t.linkId, secret: t.secret } : null;
}
export type HeldDecision = { do: "adopt"; secret: string } | { do: "remove_stale" } | { do: "leave"; why: string };
/** What to do about the held address. Its own link: adopt it. A link that exists nowhere in Product Velocity (left over from a reconnect): it can never be delivered to, so remove it. Anything else: change nothing. */
export function decideHeld(held: HeldUrl | null, thisLinkId: string, existingLinkIds: ReadonlySet<string>): HeldDecision {
  if (!held) return { do: "leave", why: "Jira already holds a webhook address for this sign-in that is not one of Product Velocity's, so it was left alone. Remove it in Jira or sign in with another account." };
  if (held.linkId === thisLinkId) return { do: "adopt", secret: held.secret };
  if (!existingLinkIds.has(held.linkId)) return { do: "remove_stale" };
  return { do: "leave", why: "Jira allows one webhook address per sign-in and this sign-in's address belongs to another linked project, so this project is read at the daily check." };
}

export type ListedWebhook = { id: string; jqlFilter: string; expiresAt: string | null };
/** The dynamic webhooks of this sign-in, from GET /webhook. Only ids, the filter and the expiry are kept. */
export function listedWebhooksFrom(json: unknown): ListedWebhook[] {
  const out: ListedWebhook[] = [];
  for (const v of Array.isArray(obj(json).values) ? (obj(json).values as unknown[]) : []) {
    const o = obj(v);
    const id = o.id;
    if ((typeof id !== "number" && typeof id !== "string") || !/^[0-9]{1,20}$/.test(String(id))) continue;
    const exp = typeof o.expirationDate === "string" && !Number.isNaN(Date.parse(o.expirationDate)) ? new Date(o.expirationDate).toISOString() : null;
    out.push({ id: String(id), jqlFilter: typeof o.jqlFilter === "string" ? o.jqlFilter.slice(0, 300) : "", expiresAt: exp });
  }
  return out;
}
/** Reads (no write) the webhooks registered for this sign-in; null when Jira could not be read. */
export async function listWebhooks(call: JiraRequest, sleep?: Sleep): Promise<ListedWebhook[] | null> {
  const r = await withBackoff(() => call("GET", "/webhook?maxResults=100"), sleep);
  return r.status === 200 ? listedWebhooksFrom(r.json) : null;
}
/** The listed webhook that watches exactly this project. */
export const webhookOfProject = (list: ListedWebhook[], projectKey: string): ListedWebhook | null =>
  list.find((x) => x.jqlFilter.replace(/\s+/g, " ").trim().toLowerCase() === `project = ${projectKey}`.toLowerCase()) ?? null;

/** Extends the given webhooks (up to 100 per call). Returns the new expiry, or null when Jira no longer knows them (register again). */
export async function refreshWebhooks(call: JiraRequest, ids: string[], sleep?: Sleep): Promise<{ expiresAt: string | null; unknown: boolean }> {
  const r = await withBackoff(() => call("PUT", "/webhook/refresh", { webhookIds: ids.map(Number) }), sleep);
  const exp = obj(r.json).expirationDate;
  if (r.status === 200 && typeof exp === "string" && !Number.isNaN(Date.parse(exp))) return { expiresAt: new Date(exp).toISOString(), unknown: false };
  return { expiresAt: null, unknown: r.status === 400 || r.status === 404 };
}
