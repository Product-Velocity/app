import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfluenceRequest } from "@/lib/confluence/client";

// The page tree endpoint (issue #693): who may browse, what it asks Confluence, and that only titles and ids come back.
type Rows = Record<string, unknown[]>;
const state = { user: { id: "u1" } as { id: string } | null, rows: {} as Rows, site: null as null | { connectionId: string; siteId: string; siteUrl: string; siteName: string; missingScopes: string[] }, confluence: null as null | ConfluenceRequest };

function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "in"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: (state.rows[table] ?? [])[0] ?? null, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.rows[table] ?? [], error: null });
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => query(t) }) }));
vi.mock("@/lib/confluence/server", () => ({ confluenceSiteFor: async () => state.site, confluenceRequest: () => (async (...a: Parameters<ConfluenceRequest>) => state.confluence!(...a)) as ConfluenceRequest }));

import { GET } from "./route";

const DOC = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: DOC }) };
const get = (qs: string) => GET(new Request(`http://x/api?${qs}`), ctx);
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  state.user = { id: "u1" };
  state.site = { connectionId: "c1", siteId: "s1", siteUrl: "https://acme.atlassian.net", siteName: "Acme", missingScopes: [] };
  state.rows = { item_documents: [{ id: DOC, tenant_id: "t1", item_id: "i1", kind: "prd", title: "PRD", body: "SECRET BODY", version: 1, ai_draft: false }], tenant_members: [{ role: "creator", is_service_account: false }] };
  state.confluence = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (path.startsWith("/api/v2/spaces?keys=GTM")) return { status: 200, json: { results: [{ id: "999", key: "GTM", name: "GTM", type: "global" }] } };
    if (path.startsWith("/api/v2/spaces/999/pages")) return { status: 200, json: { results: [{ id: "20", title: "Home", body: { storage: { value: "SECRET" } } }, { id: "10", title: "Archive" }] } };
    if (path.startsWith("/api/v2/pages/20/children")) return { status: 200, json: { results: [{ id: "21", title: "Plans" }] } };
    return { status: 500, json: null };
  };
});

describe("the page tree of a space", () => {
  it("lists the top-level pages of the chosen space, and only their titles and ids", async () => {
    const r = await get("space=GTM");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual({ pages: [{ id: "10", title: "Archive" }, { id: "20", title: "Home" }] });
    expect(JSON.stringify(j)).not.toContain("SECRET");
    expect(calls).toEqual(["GET /api/v2/spaces?keys=GTM&limit=1", "GET /api/v2/spaces/999/pages?depth=root&limit=250&status=current&sort=title"]);
  });
  it("lists the sub pages under a page", async () => {
    expect(await (await get("parent=20")).json()).toEqual({ pages: [{ id: "21", title: "Plans" }] });
  });
  it("needs a space or a parent, and refuses anything that is not a key or a page id", async () => {
    expect((await get("")).status).toBe(422);
    expect((await get("space=has space")).status).toBe(422);
    expect((await get("parent=../x")).status).toBe(422);
    expect(calls).toEqual([]);
  });
  it("only a person who may publish this document can browse: not signed in, a viewer, a service account", async () => {
    state.user = null;
    expect((await get("space=GTM")).status).toBe(401);
    state.user = { id: "u1" };
    state.rows.tenant_members = [{ role: "viewer", is_service_account: false }];
    expect((await get("space=GTM")).status).toBe(403);
    state.rows.tenant_members = [{ role: "creator", is_service_account: true }];
    expect((await get("space=GTM")).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("says so when Confluence is not connected, and shows Confluence's refusal in words", async () => {
    state.site = null;
    expect((await get("space=GTM")).status).toBe(409);
    state.site = { connectionId: "c1", siteId: "s1", siteUrl: "https://acme.atlassian.net", siteName: "Acme", missingScopes: [] };
    state.confluence = async () => ({ status: 403, json: { errors: [{ title: "Forbidden" }] } });
    const r = await get("space=GTM");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain("Confluence refused");
  });
});
