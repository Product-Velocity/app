import { beforeEach, describe, expect, it, vi } from "vitest";

// "To send" for Confluence (issue #693): which kept-in-sync documents are ahead of their page, and for whom.
const state = { user: { id: "u1" } as { id: string } | null, rows: {} as Record<string, unknown[]>, site: true };
function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: (state.rows[table] ?? [])[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.rows[table] ?? [], error: null });
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => query(t) }) }));
const pageVersions: Record<string, number> = { "5": 3, "6": 3 };
const calls: string[] = [];
vi.mock("@/lib/confluence/server", () => ({ confluenceSiteFor: async () => (state.site ? { connectionId: "c", siteId: "s", siteUrl: "https://a.atlassian.net", siteName: "A", missingScopes: [] } : null), confluenceRequest: () => async (_m: string, path: string) => { calls.push(path); const id = /pages\/(\d+)/.exec(path)?.[1] ?? ""; return id in pageVersions ? { status: 200, json: { id, title: "T", spaceId: "9", version: { number: pageVersions[id] }, _links: { webui: "/x" } } } : { status: 404, json: null }; } }));
import { GET } from "./route";

const I1 = "11111111-1111-4111-8111-111111111111";
const I2 = "22222222-2222-4222-8222-222222222222";
const D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const get = (qs: string) => GET(new Request(`http://x/api/confluence/to-send?${qs}`));

beforeEach(() => {
  state.user = { id: "u1" }; state.site = true; calls.length = 0; pageVersions["5"] = 3; pageVersions["6"] = 3;
  state.rows = {
    items: [{ id: I1, tenant_id: "t1", item_code: "R-12", initiative_name: "Ticketing" }, { id: I2, tenant_id: "t1", item_code: "R-03", initiative_name: "Search" }],
    tenant_members: [{ role: "creator", is_service_account: false }],
    item_document_pages: [
      { id: "p1", document_id: D1, item_id: I1, page_id: "5", remote_version: 3, sync_direction: "to_confluence", page_url: "https://a.atlassian.net/wiki/spaces/X/pages/5", page_title: "PRD", space_key: "X", published_version: 1 },
      { id: "p2", document_id: D2, item_id: I2, page_id: "6", remote_version: 3, sync_direction: "to_confluence", page_url: "https://a.atlassian.net/wiki/spaces/X/pages/6", page_title: "GTM", space_key: "X", published_version: 3 },
    ],
    item_documents: [{ id: D1, title: "PRD", version: 2 }, { id: D2, title: "GTM", version: 3 }],
  };
});

describe("Confluence pages that are behind their document", () => {
  it("lists only the documents newer than their page, by initiative code, without any document text", async () => {
    const j = await (await get(`items=${I1},${I2}`)).json();
    expect(j.available).toBe(true);
    expect(j.documents).toEqual([{ id: D1, itemId: I1, code: "R-12", itemName: "Ticketing", title: "PRD", version: 2, publishedVersion: 1, pageTitle: "PRD", pageUrl: "https://a.atlassian.net/wiki/spaces/X/pages/5", spaceKey: "X", direction: "to_confluence", state: "send", pageVersion: null }]);
    expect(calls).toEqual([]); // a write-only link never reads the page
  });
  it("shows nothing to a viewer, a service account or a workspace without Confluence", async () => {
    state.rows.tenant_members = [{ role: "viewer", is_service_account: false }];
    expect(await (await get(`items=${I1}`)).json()).toEqual({ available: false, documents: [] });
    state.rows.tenant_members = [{ role: "creator", is_service_account: true }];
    expect(await (await get(`items=${I1}`)).json()).toEqual({ available: false, documents: [] });
    state.rows.tenant_members = [{ role: "admin", is_service_account: false }];
    state.site = false;
    expect(await (await get(`items=${I1}`)).json()).toEqual({ available: false, documents: [] });
  });
  it("refuses a signed-out person and bad ids", async () => {
    state.user = null;
    expect((await get(`items=${I1}`)).status).toBe(401);
    state.user = { id: "u1" };
    expect((await get("items=nope")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });
});

describe("links that read the page too (issue #714 slice 2)", () => {
  it("lists what the page has that the document lacks, and a conflict when both changed; a link in step is not listed", async () => {
    state.rows.item_document_pages = [
      { id: "p1", document_id: D1, item_id: I1, page_id: "5", remote_version: 3, sync_direction: "both", page_url: "https://a.atlassian.net/wiki/spaces/X/pages/5", page_title: "PRD", space_key: "X", published_version: 1 },
      { id: "p2", document_id: D2, item_id: I2, page_id: "6", remote_version: 3, sync_direction: "from_confluence", page_url: "https://a.atlassian.net/wiki/spaces/X/pages/6", page_title: "GTM", space_key: "X", published_version: 3 },
    ];
    pageVersions["5"] = 4; // changed on the page, and the document is ahead of the page too: conflict
    pageVersions["6"] = 4; // changed on the page
    const j = await (await get(`items=${I1},${I2}`)).json();
    expect(j.documents.map((d: { code: string; state: string }) => [d.code, d.state])).toEqual([["R-03", "receive"], ["R-12", "conflict"]]);
    pageVersions["6"] = 3;
    expect((await (await get(`items=${I1},${I2}`)).json()).documents.map((d: { code: string }) => d.code)).toEqual(["R-12"]);
  });
  it("only reads the version number of a page: no text is in the answer", async () => {
    state.rows.item_document_pages = [{ id: "p2", document_id: D2, item_id: I2, page_id: "6", remote_version: 2, sync_direction: "both", page_url: "https://a.atlassian.net/wiki/spaces/X/pages/6", page_title: "GTM", space_key: "X", published_version: 3 }];
    const text = JSON.stringify(await (await get(`items=${I2}`)).json());
    expect(text).toContain('"state":"receive"');
    expect(text).not.toContain("body");
  });
});
