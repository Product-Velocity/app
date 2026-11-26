import { withBackoff, type JiraRequest, type Sleep } from "@/lib/atlassian/jira-write";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";

// The Confluence Cloud client for publishing (issue #693). Pure over an injected `call` (the same shape as the Jira one), so it is tested with a fake
// Confluence. It uses the v2 REST API (`/wiki/api/v2`): the first real site answered 410 "This deprecated endpoint has been removed" to the v1 space
// list, so nothing here uses `/wiki/rest/api`. Every answer is read defensively and every refusal comes back as words for the person, never swallowed
// and never thrown. Only a few calls exist: list spaces, find a space by key or id, read one page (with or without its text), create a page and update one page. There is no delete and
// no way to touch permissions. What Confluence says is data: its text is shown short and as plain text, and never interpreted.

export type ConfluenceRequest = JiraRequest;
export type ConfluenceFailKind = "reconnect" | "forbidden" | "rejected" | "title_taken" | "conflict" | "gone" | "rate_limited" | "unavailable";
export type ConfluenceFail = { ok: false; kind: ConfluenceFailKind; message: string };
export type Space = { id: string; key: string; name: string; type: string };
export type Page = { id: string; title: string; version: number; spaceId: string | null; url: string | null };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const plain = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "").slice(0, 300);

/** Confluence's own error text, short and as plain text. The v2 API answers `{ errors: [{ status, code, title, detail }] }`; older answers had `message`. */
export function whyConfluence(json: unknown): string {
  const o = obj(json);
  const errors = Array.isArray(o.errors) ? (o.errors as unknown[]).map((e) => [str(obj(e).title), str(obj(e).detail)].filter(Boolean).join(": ") || str(obj(e).message)).filter(Boolean) : [];
  const legacy = Array.isArray(obj(o.data).errors) ? (obj(o.data).errors as unknown[]).map((e) => str(obj(obj(e).message).translation) || str(obj(e).message)).filter(Boolean) : [];
  return plain([str(o.message), ...errors, ...legacy].filter(Boolean).join("; "));
}

const RECONNECT: ConfluenceFail = { ok: false, kind: "reconnect", message: "Atlassian needs you to sign in to Confluence again (Settings, Integrations, Confluence, Reconnect). Nothing was written." };

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
  // A 401 with a token that was accepted usually means the sign-in lacks the exact permission this request needs ("Unauthorized; scope does not match"), not that
  // it expired (an expired token is refreshed before the request, and a refused refresh is ReconnectNeeded). So Atlassian's own words are shown.
  if (status === 401) return { ok: false, kind: "forbidden", message: `Confluence refused the sign-in (401).${why ? ` Atlassian says: ${why}.` : ""} The Confluence connection may lack a permission this needs: open Settings, Integrations, Confluence, check the permissions listed there and Reconnect.${tail}` };
  if (status === 403) return { ok: false, kind: "forbidden", message: `Confluence refused (403): the Atlassian sign-in may not include Confluence permission, or you cannot ${writing ? "create or edit pages" : "see"} there. An admin can check the connection in Settings, Integrations, Confluence.${why ? ` Confluence says: ${why}.` : ""}${tail}` };
  if (status === 404) return { ok: false, kind: "gone", message: `Confluence could not find it (404): the page or space may have been deleted, or the sign-in cannot see it.${why ? ` Confluence says: ${why}.` : ""}${tail}` };
  if (status === 409) return { ok: false, kind: "conflict", message: `Somebody saved the page in Confluence while it was being written (409).${tail}` };
  if (status === 410) return { ok: false, kind: "rejected", message: `Confluence says this request is no longer supported (410).${why ? ` Confluence says: ${why}.` : ""} This is a fault in Product Velocity, not in your Confluence: please report it.${tail}` };
  if (status === 429) return { ok: false, kind: "rate_limited", message: `Confluence is asking for a pause (429). Try again in a minute.${tail}` };
  if (status === 400 && /already exists|same title|title/i.test(why)) return { ok: false, kind: "title_taken", message: `A page with this title already exists in the space. Change the title and try again.${tail}` };
  if (status >= 500) return { ok: false, kind: "unavailable", message: `Confluence is not available right now (${status}). Try again.${tail}` };
  return { ok: false, kind: "rejected", message: `Confluence refused it (${status}).${why ? ` Confluence says: ${why}.` : ""}${tail}` };
}

/** The address of a page from the answer: the site's base plus the page's web path; only https addresses are kept. */
function pageUrl(json: Obj, id: string, siteUrl: string | null): string | null {
  const links = obj(json._links);
  const base = str(links.base) || (siteUrl ? `${siteUrl.replace(/\/$/, "")}/wiki` : "");
  const web = str(links.webui);
  const url = base && web ? `${base.replace(/\/$/, "")}${web.startsWith("/") ? "" : "/"}${web}` : "";
  if (/^https:\/\//i.test(url) && url.length <= 2000) return url;
  // no web path in the answer: the page's own address by id still opens it
  const byId = siteUrl ? `${siteUrl.replace(/\/$/, "")}/wiki/pages/viewpage.action?pageId=${id}` : "";
  return /^https:\/\//i.test(byId) ? byId : null;
}

function toPage(json: unknown, siteUrl: string | null): Page | null {
  const o = obj(json);
  const id = str(o.id);
  const version = Number(obj(o.version).number);
  if (!/^\d{1,20}$/.test(id) || !Number.isInteger(version) || version < 1) return null;
  const spaceId = str(o.spaceId) || null;
  return { id, title: str(o.title), version, spaceId, url: pageUrl(o, id, siteUrl) };
}

const toSpace = (r: unknown): Space | null => {
  const o = obj(r);
  const id = str(o.id);
  const key = str(o.key);
  return /^\d{1,20}$/.test(id) && /^[~A-Za-z0-9_-]{1,255}$/.test(key) ? { id, key, name: str(o.name) || key, type: str(o.type) } : null;
};

const BAD_ANSWER = (what: string): ConfluenceFail => ({ ok: false, kind: "rejected", message: `Confluence answered, but not in the shape expected for ${what}. Nothing more was done.` });

/** The spaces the sign-in can see (global spaces, by name). One page of up to 250. */
export async function listSpaces(call: ConfluenceRequest, sleep?: Sleep): Promise<{ ok: true; spaces: Space[] } | ConfluenceFail> {
  const x = await run(() => call("GET", "/api/v2/spaces?limit=250&type=global&status=current"), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const results = obj(x.r.json).results;
  if (!Array.isArray(results)) return BAD_ANSWER("the list of spaces");
  const spaces = results.map(toSpace).filter((s): s is Space => s !== null);
  return { ok: true, spaces: spaces.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** One space by its key (v2 creates pages by space id, not by key). */
export async function getSpaceByKey(call: ConfluenceRequest, key: string, sleep?: Sleep): Promise<{ ok: true; space: Space } | ConfluenceFail> {
  if (!/^[~A-Za-z0-9_-]{1,255}$/.test(key)) return { ok: false, kind: "rejected", message: "That is not a Confluence space key." };
  const x = await run(() => call("GET", `/api/v2/spaces?keys=${encodeURIComponent(key)}&limit=1`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const results = obj(x.r.json).results;
  if (!Array.isArray(results)) return BAD_ANSWER("a space");
  const space = results.map(toSpace).find((s): s is Space => s !== null && s.key === key);
  return space ? { ok: true, space } : { ok: false, kind: "gone", message: `Confluence has no space with the key ${key}, or the sign-in cannot see it.` };
}

/** One page: its title, version and space. */
export async function getPage(call: ConfluenceRequest, id: string, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: Page } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, kind: "rejected", message: "That is not a Confluence page id." };
  const x = await run(() => call("GET", `/api/v2/pages/${id}`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const page = toPage(x.r.json, siteUrl);
  return page ? { ok: true, page } : BAD_ANSWER("a page");
}

export type NewPage = { spaceId: string; parentId: string | null; title: string; body: string };

/** Creates a page in a space (by its id), under a parent page when given. */
export async function createPage(call: ConfluenceRequest, p: NewPage, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: Page } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(p.spaceId)) return { ok: false, kind: "rejected", message: "That is not a Confluence space id. Nothing was written." };
  const payload = { spaceId: p.spaceId, status: "current", title: p.title, ...(p.parentId ? { parentId: p.parentId } : {}), body: { representation: "storage", value: p.body } };
  const x = await run(() => call("POST", "/api/v2/pages", payload), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, true);
  const page = toPage(x.r.json, siteUrl);
  return page ? { ok: true, page: { ...page, spaceId: page.spaceId ?? p.spaceId } } : BAD_ANSWER("the new page");
}

export type PageUpdate = { id: string; /** The version the page has now; the write makes the next one. */ currentVersion: number; title: string; body: string };

/** Writes a new version of a page. Confluence refuses it (409) when the page moved on since `currentVersion`, so nothing is overwritten unseen. */
export async function updatePage(call: ConfluenceRequest, p: PageUpdate, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: Page } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(p.id)) return { ok: false, kind: "rejected", message: "That is not a Confluence page id." };
  const payload = { id: p.id, status: "current", title: p.title, body: { representation: "storage", value: p.body }, version: { number: p.currentVersion + 1, message: "Published from Product Velocity" } };
  const x = await run(() => call("PUT", `/api/v2/pages/${p.id}`, payload), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, true);
  const page = toPage(x.r.json, siteUrl);
  return page ? { ok: true, page } : BAD_ANSWER("the updated page");
}

/** One entry of the page tree. Confluence folders are not pages: they hold pages (and other folders) but cannot be published to or imported. */
export type PageSummary = { id: string; title: string; kind: "page" | "folder" };
const toSummaries = (json: unknown): PageSummary[] | null => {
  const results = obj(json).results;
  if (!Array.isArray(results)) return null;
  return results
    .filter((r) => { const t = str(obj(r).type); return t === "" || t === "page" || t === "folder"; }) // whiteboards, databases and smart links are skipped
    .map((r): PageSummary => ({ id: str(obj(r).id), title: str(obj(r).title), kind: str(obj(r).type) === "folder" ? "folder" : "page" }))
    .filter((p) => /^\d{1,20}$/.test(p.id))
    .sort((a, b) => a.title.localeCompare(b.title));
};

/** The top-level pages of a space (those with no parent page; the space's home page is one of them), by title. One page of up to 250. Folders are not included: see `listRootFolders`. */
export async function listRootPages(call: ConfluenceRequest, spaceId: string, sleep?: Sleep): Promise<{ ok: true; pages: PageSummary[] } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(spaceId)) return { ok: false, kind: "rejected", message: "That is not a Confluence space id." };
  const x = await run(() => call("GET", `/api/v2/spaces/${spaceId}/pages?depth=root&limit=250&status=current&sort=title`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const pages = toSummaries(x.r.json);
  return pages ? { ok: true, pages } : BAD_ANSWER("the pages of a space");
}

/**
 * The top-level folders of a space. Confluence has no call that lists them (and `depth=root` hides every page that sits in a folder), so they are found from the
 * pages: every page in the space says what its parent is, and each folder named that way is read and followed up until its parent is the space itself. Folders that
 * sit under a page are not top-level (they come with that page's children), and a folder with nothing in it is not found. Bounded: 20 pages of results, 300 folder reads.
 */
export async function listRootFolders(call: ConfluenceRequest, spaceId: string, sleep?: Sleep): Promise<{ ok: true; folders: PageSummary[] } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(spaceId)) return { ok: false, kind: "rejected", message: "That is not a Confluence space id." };
  const inFolders = new Set<string>();
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const path = `/api/v2/spaces/${spaceId}/pages?limit=250&status=current${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const x = await run(() => call("GET", path), sleep);
    if ("fail" in x) return x.fail;
    if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
    const results = obj(x.r.json).results;
    if (!Array.isArray(results)) return BAD_ANSWER("the pages of a space");
    for (const r of results) if (str(obj(r).parentType) === "folder" && /^\d{1,20}$/.test(str(obj(r).parentId))) inFolders.add(str(obj(r).parentId));
    const next = str(obj(obj(x.r.json)._links).next);
    cursor = next ? (/[?&]cursor=([^&]+)/.exec(next)?.[1] ? decodeURIComponent(/[?&]cursor=([^&]+)/.exec(next)![1]!) : "") : "";
    if (!cursor) break;
  }
  const known = new Map<string, { title: string; parentId: string; parentType: string }>();
  let reads = 0;
  const read = async (id: string): Promise<ConfluenceFail | null> => {
    if (known.has(id)) return null;
    if (reads++ >= 300) return null;
    const x = await run(() => call("GET", `/api/v2/folders/${id}`), sleep);
    if ("fail" in x) return x.fail;
    if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
    const o = obj(x.r.json);
    known.set(id, { title: str(o.title), parentId: str(o.parentId), parentType: str(o.parentType) });
    return null;
  };
  const roots = new Map<string, string>();
  for (const start of inFolders) {
    let id = start;
    for (let depth = 0; depth < 12; depth++) {
      const fail = await read(id);
      if (fail) return fail;
      const f = known.get(id);
      if (!f) break;
      if (f.parentType === "folder" && /^\d{1,20}$/.test(f.parentId)) { id = f.parentId; continue; }
      if (f.parentType !== "page") roots.set(id, f.title); // its parent is the space (or nothing): a top-level folder
      break;
    }
  }
  const folders = [...roots].map(([id, title]): PageSummary => ({ id, title, kind: "folder" })).sort((a, b) => a.title.localeCompare(b.title));
  return { ok: true, folders };
}

/**
 * What sits directly under a page or a folder, by title: sub pages and folders. One page of up to 250. A page is read with the direct-children call (which also
 * lists its folders); a sign-in without the permission for that falls back to the older sub pages call, so existing connections keep working (without folders).
 */
export async function listChildren(call: ConfluenceRequest, id: string, kind: "page" | "folder" = "page", sleep?: Sleep): Promise<{ ok: true; pages: PageSummary[] } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, kind: "rejected", message: `That is not a Confluence ${kind} id.` };
  const x = await run(() => call("GET", `/api/v2/${kind === "folder" ? "folders" : "pages"}/${id}/direct-children?limit=250`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status >= 200 && x.r.status < 300) {
    const pages = toSummaries(x.r.json);
    return pages ? { ok: true, pages } : BAD_ANSWER("the sub pages of a page");
  }
  if (kind === "page" && [401, 403, 404, 410].includes(x.r.status)) return listChildPages(call, id, sleep);
  return failure(x.r.status, x.r.json, false);
}

/** The sub pages directly under a page (not folders), by title. One page of up to 250. */
export async function listChildPages(call: ConfluenceRequest, pageId: string, sleep?: Sleep): Promise<{ ok: true; pages: PageSummary[] } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(pageId)) return { ok: false, kind: "rejected", message: "That is not a Confluence page id." };
  const x = await run(() => call("GET", `/api/v2/pages/${pageId}/children?limit=250`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const pages = toSummaries(x.r.json);
  return pages ? { ok: true, pages } : BAD_ANSWER("the sub pages of a page");
}

export type PageWithText = Page & { /** The page as Confluence stores it (storage format), to be converted to Markdown. */ storage: string };

/** One page with its text in storage format. Reading the text needs the permission to read page content (`read:page:confluence`). */
export async function getPageWithText(call: ConfluenceRequest, id: string, siteUrl: string | null = null, sleep?: Sleep): Promise<{ ok: true; page: PageWithText } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, kind: "rejected", message: "That is not a Confluence page id." };
  const x = await run(() => call("GET", `/api/v2/pages/${id}?body-format=storage`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const page = toPage(x.r.json, siteUrl);
  if (!page) return BAD_ANSWER("a page");
  const value = obj(obj(obj(x.r.json).body).storage).value;
  if (typeof value !== "string") return { ok: false, kind: "rejected", message: "Confluence answered, but without the text of the page. The sign-in may lack the permission to read page content (an admin can check the permissions and Reconnect under Settings, Integrations, Confluence)." };
  return { ok: true, page: { ...page, storage: value } };
}

/** One space by its id (a page answers with the space id; the person and the stored link use the key). */
export async function getSpaceById(call: ConfluenceRequest, id: string, sleep?: Sleep): Promise<{ ok: true; space: Space } | ConfluenceFail> {
  if (!/^\d{1,20}$/.test(id)) return { ok: false, kind: "rejected", message: "That is not a Confluence space id." };
  const x = await run(() => call("GET", `/api/v2/spaces/${id}`), sleep);
  if ("fail" in x) return x.fail;
  if (x.r.status < 200 || x.r.status >= 300) return failure(x.r.status, x.r.json, false);
  const space = toSpace(x.r.json);
  return space ? { ok: true, space } : BAD_ANSWER("a space");
}

