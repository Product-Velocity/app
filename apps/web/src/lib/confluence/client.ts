import { withBackoff, type JiraRequest, type Sleep } from "@/lib/atlassian/jira-write";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";

// The Confluence Cloud client for publishing (issue #693 slice B). Pure over an injected `call` (the same shape as the Jira one), so it is tested with
// a fake Confluence. Written from the Confluence Cloud REST API documentation and checked against the first real site (decision 2026-11-26): every
// answer is read defensively and every refusal comes back as words for the person, never swallowed and never thrown.
// Only four calls exist: list spaces, read one page, create a page and update one page. There is no delete and no way to touch permissions.
// What Confluence says is data: its text is shown, short and as plain text, and never interpreted.

export type ConfluenceRequest = JiraRequest;
export type ConfluenceFailKind = "reconnect" | "forbidden" | "rejected" | "title_taken" | "conflict" | "gone" | "rate_limited" | "unavailable";
export type ConfluenceFail = { ok: false; kind: ConfluenceFailKind; message: string };
export type Space = { key: string; name: string; type: string };
export type Page = { id: string; title: string; version: number; spaceKey: string | null; url: string | null };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const plain = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

/** Confluence's own error text, short and as plain text. */
export function whyConfluence(json: unknown): string {
  const o = obj(json);
  const data = obj(o.data);
  const errors = Array.isArray(data.errors) ? (data.errors as unknown[]).map((e) => str(obj(obj(e).message).translation) || str(obj(e).message)).filter(Boolean) : [];
  return plain([str(o.message), ...errors].filter(Boolean).join("; "));
}

const RECONNECT: ConfluenceFail = { ok: false, kind: "reconnect", message: "Atlassian needs you to sign in again (Settings, Integrations, Jira). Nothing was written." };

async function run(req: () => ReturnType<ConfluenceRequest>, sleep?: Sleep): Promise<{ r: Awaited<ReturnType<ConfluenceRequest>> } | { fail: ConfluenceFail }> {
  try {
    return { r: await withBackoff(req, sleep) };
  } catch (e) {
    if (e instanceof ReconnectNeeded) return { fail: RECONNECT };
    return { fail: { ok: false, kind: "unavailable", message: "Confluence could not be reached. Nothing was written. Try again." } };
  }
}

/** The failure for a status that was not a success. `writing` is true for a create or update (the words say nothing was written). */
export function failure(status: number, json: unknown, writing: boolean): ConfluenceFail {
  const why = whyConfluence(json);
  const tail = writing ? " Nothing was written." : "";
  if (status === 401) return RECONNECT;
  if (status === 403) return { ok: false, kind: "forbidden", message: `Confluence refused (403): the Atlassian sign-in may not include Confluence permission, or you cannot ${writing ? "create or edit pages" : "see"} there. An admin can add Confluence in Settings, Integrations, Jira.${why ? ` Confluence says: ${why}.` : ""}${tail}` };
  if (status === 404) return { ok: false, kind: "gone", message: `Confluence could not find it (404): the page or space may have been deleted, or the sign-in cannot see it.${why ? ` Confluence says: ${why}.` : ""}${tail}` };
  if (status === 409) return { ok: false, kind: "conflict", message: `Somebody saved the page in Confluence while it was being written (409).${tail}` };
  if (status === 429) return { ok: false, kind: "rate_limited", message: `Confluence is asking for a pause (429). Try again in a minute.${tail}` };
  if (status === 400 && /already exists|same title|title/i.test(why)) return { ok: false, kind: "title_taken", message: `A page with this title already exists in the space. Change the title and try again.${tail}` };
  if (status >= 500) return { ok: false, kind: "unavailable", message: `Confluence is not available right now (${status}). Try again.${tail}` };
  return { ok: false, kind: "rejected", message: `Confluence refused it (${status}).${why ? ` Confluence says: ${why}.` : ""}${tail}` };
}

/** The address of a page from the answer: the site's base plus the page's web path; only https addresses are kept. */
function pageUrl(json: Obj, id: string, spaceKey: string | null, siteUrl: string | null): string | null {
  const links = obj(json._links);
  const base = str(links.base) || (siteUrl ? `${siteUrl.replace(/\/$/, "")}/wiki` : "");
  const web = str(links.webui) || (spaceKey ? `/spaces/${spaceKey}/pages/${id}` : "");
  const url = base && web ? `${base.replace(/\/$/, "")}${web.startsWith("/") ? "" : "/"}${web}` : "";
  return /^https:\/\//i.test(url) && url.length <= 2000 ? url : null;
}

function toPage(json: unknown, siteUrl: string | null): Page | null {
  const o = obj(json);
  const id = str(o.id);
  const version = Number(obj(o.version).number);
  if (!/^\d{1,20}$/.test(id) || !Number.isInteger(version) || version < 1) return null;
  const spaceKey = str(obj(o.space).key) || null;
  return { id, title: str(o.title), version, spaceKey, url: pageUrl(o, id, spaceKey, siteUrl) };
}

const BAD_ANSWER = (what: string): ConfluenceFail => ({ ok: false, kind: "rejected", message: `Confluence answered, but not in the shape expected for ${what}. Nothing more was done.` });

/** The spaces the sign-in can see (global spaces first). */
export async function listSpaces(call: ConfluenceRequest, sleep?: Sleep): Promise<{ ok: true; spaces: Space[] } | ConfluenceFail> {
  const x = await run(() => call("GET", "/space?limit=100&type=global"), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const results = obj(x.r.json).results;
  if (!Array.isArray(results)) return BAD_ANSWER("the list of spaces");
  const spaces = results.map((r) => ({ key: str(obj(r).key), name: str(obj(r).name), type: str(obj(r).type) })).filter((s) => /^[~A-Za-z0-9_-]{1,255}$/.test(s.key));
  return { ok: true, spaces: spaces.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** One page: its title, version and space. */
export async function getPage(call: ConfluenceRequest, id: string, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: Page } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, kind: "rejected", message: "That is not a Confluence page id." };
  const x = await run(() => call("GET", `/content/${id}?expand=version,space`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const page = toPage(x.r.json, siteUrl);
  return page ? { ok: true, page } : BAD_ANSWER("a page");
}

export type NewPage = { spaceKey: string; parentId: string | null; title: string; body: string };

/** Creates a page in a space, under a parent page when given. */
export async function createPage(call: ConfluenceRequest, p: NewPage, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: Page } | ConfluenceFail> {
  const payload = { type: "page", title: p.title, space: { key: p.spaceKey }, ...(p.parentId ? { ancestors: [{ id: p.parentId }] } : {}), body: { storage: { value: p.body, representation: "storage" } } };
  const x = await run(() => call("POST", "/content", payload), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, true);
  const page = toPage(x.r.json, siteUrl);
  return page ? { ok: true, page: { ...page, spaceKey: page.spaceKey ?? p.spaceKey } } : BAD_ANSWER("the new page");
}

export type PageUpdate = { id: string; /** The version the page has now; the write makes the next one. */ currentVersion: number; title: string; body: string };

/** Writes a new version of a page. Confluence refuses it (409) when the page moved on since `currentVersion`, so nothing is overwritten unseen. */
export async function updatePage(call: ConfluenceRequest, p: PageUpdate, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: Page } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(p.id)) return { ok: false, kind: "rejected", message: "That is not a Confluence page id." };
  const payload = { type: "page", title: p.title, version: { number: p.currentVersion + 1 }, body: { storage: { value: p.body, representation: "storage" } } };
  const x = await run(() => call("PUT", `/content/${p.id}`, payload), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, true);
  const page = toPage(x.r.json, siteUrl);
  return page ? { ok: true, page } : BAD_ANSWER("the updated page");
}
