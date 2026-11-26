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
vi.mock("@/lib/confluence/server", () => ({ confluenceSiteFor: async () => (state.site ? { connectionId: "c", siteId: "s", siteUrl: "https://a.atlassian.net", siteName: "A", missingScopes: [] } : null) }));
import { GET } from "./route";

const I1 = "11111111-1111-4111-8111-111111111111";
const I2 = "22222222-2222-4222-8222-222222222222";
const D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const get = (qs: string) => GET(new Request(`http://x/api/confluence/to-send?${qs}`));

beforeEach(() => {
  state.user = { id: "u1" }; state.site = true;
  state.rows = {
    items: [{ id: I1, tenant_id: "t1", item_code: "R-12", initiative_name: "Ticketing" }, { id: I2, tenant_id: "t1", item_code: "R-03", initiative_name: "Search" }],
    tenant_members: [{ role: "creator", is_service_account: false }],
    item_document_pages: [
      { id: "p1", document_id: D1, item_id: I1, page_url: "https://a.atlassian.net/wiki/spaces/X/pages/5", page_title: "PRD", space_key: "X", published_version: 1 },
      { id: "p2", document_id: D2, item_id: I2, page_url: "https://a.atlassian.net/wiki/spaces/X/pages/6", page_title: "GTM", space_key: "X", published_version: 3 },
    ],
    item_documents: [{ id: D1, title: "PRD", version: 2 }, { id: D2, title: "GTM", version: 3 }],
  };
});

describe("Confluence pages that are behind their document", () => {
  it("lists only the documents newer than their page, by initiative code, without any document text", async () => {
    const j = await (await get(`items=${I1},${I2}`)).json();
    expect(j.available).toBe(true);
    expect(j.documents).toEqual([{ id: D1, itemId: I1, code: "R-12", itemName: "Ticketing", title: "PRD", version: 2, publishedVersion: 1, pageTitle: "PRD", pageUrl: "https://a.atlassian.net/wiki/spaces/X/pages/5", spaceKey: "X" }]);
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
