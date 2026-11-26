import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfluenceRequest } from "@/lib/confluence/client";

// The Confluence routes of a document (issue #693 slice B): who may publish, what a missing connection says, and the preview then confirm flow
// against a fake Confluence. The database client is a small chainable fake: each table answers with the rows the test gave it.

type Rows = Record<string, unknown[]>;
const state = { user: { id: "u1" } as { id: string } | null, rows: {} as Rows, inserted: [] as { table: string; row: Record<string, unknown> }[], updated: [] as { table: string; patch: Record<string, unknown> }[], deleted: [] as string[], site: null as null | { connectionId: string; siteId: string; siteUrl: string; siteName: string }, confluence: null as null | ConfluenceRequest };

function query(table: string) {
  let patch: Record<string, unknown> | null = null;
  let removing = false;
  const q: Record<string, unknown> = {};
  const done = () => ({ data: state.rows[table] ?? [], error: null });
  for (const m of ["select", "eq", "is", "order", "limit", "in"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: (state.rows[table] ?? [])[0] ?? null, error: null });
  q.insert = (row: Record<string, unknown>) => { state.inserted.push({ table, row }); return Promise.resolve({ error: null }); };
  q.update = (p: Record<string, unknown>) => { patch = p; return q; };
  q.delete = () => { removing = true; return q; };
  q.then = (resolve: (v: unknown) => unknown) => { if (removing) { state.deleted.push(table); return resolve({ error: null }); } if (patch) { state.updated.push({ table, patch }); return resolve({ error: null }); } return resolve(done()); };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => query(t) }) }));
vi.mock("@/lib/confluence/server", () => ({ confluenceSiteFor: async () => state.site, confluenceRequest: () => (async (...a: Parameters<ConfluenceRequest>) => state.confluence!(...a)) as ConfluenceRequest }));
vi.mock("@/lib/site-url", () => ({ siteUrl: async () => "https://app.example.test" }));

import { GET, POST } from "./route";

const DOC = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: DOC }) };
const post = async (body: unknown): Promise<Response> => (await POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx)) as Response;
const SITE = { connectionId: "c1", siteId: "s1", siteUrl: "https://acme.atlassian.net", siteName: "Acme" };
const doc = { id: DOC, tenant_id: "t1", item_id: "i1", title: "PRD", body: "# PRD\n\nText.", version: 1, ai_draft: false };

beforeEach(() => {
  state.user = { id: "u1" }; state.inserted = []; state.updated = []; state.deleted = []; state.site = SITE;
  state.rows = { item_documents: [doc], tenant_members: [{ role: "creator", is_service_account: false }], item_document_pages: [], item_document_publish_requests: [], items: [{ item_code: "R-12", kr_metric: null, value_12m: null }] };
  // the v2 API: spaces (listed, or found by key) and pages created in a space by its id
  state.confluence = async (method, path) => {
    if (method === "GET" && path.startsWith("/api/v2/spaces")) return { status: 200, json: { results: [{ id: "777", key: "PRD", name: "Product", type: "global" }, { id: "999", key: "GTM", name: "Go-to-market", type: "global" }] } };
    if (method === "POST" && path === "/api/v2/pages") return { status: 200, json: { id: "9001", title: "PRD", spaceId: "777", version: { number: 1 }, _links: { webui: "/spaces/PRD/pages/9001/PRD" } } };
    return { status: 500, json: null };
  };
});

describe("who may publish", () => {
  it("asks for a sign-in, and does not reveal a document that is not visible", async () => {
    state.user = null;
    expect((await post({ action: "preview", mode: "once", spaceKey: "PRD" })).status).toBe(401);
    state.user = { id: "u1" }; state.rows.item_documents = [];
    expect((await post({ action: "preview", mode: "once", spaceKey: "PRD" })).status).toBe(404);
    expect((await POST(new Request("http://x", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: "not-a-uuid" }) })).status).toBe(404);
  });

  it.each([["viewer", false], ["creator", true], ["admin", true]])("a %s may publish: %s", async (role, may) => {
    state.rows.tenant_members = [{ role, is_service_account: false }];
    const r = await post({ action: "preview", mode: "once", spaceKey: "PRD" });
    expect(r.status === 403).toBe(!may);
  });

  it("a service account (an assistant's identity) and a person who is not a member are refused", async () => {
    state.rows.tenant_members = [{ role: "creator", is_service_account: true }];
    expect((await post({ action: "publish", mode: "once", spaceKey: "PRD", confirm: "x" })).status).toBe(403);
    state.rows.tenant_members = [];
    expect((await post({ action: "publish", mode: "once", spaceKey: "PRD", confirm: "x" })).status).toBe(403);
    expect(state.inserted).toEqual([]);
  });

  it("says Confluence is not connected, and rejects an unknown action or mode", async () => {
    state.site = null;
    expect(await (await post({ action: "preview", mode: "once", spaceKey: "PRD" })).json()).toMatchObject({ kind: "not_connected" });
    state.site = SITE;
    expect((await post({ action: "destroy" })).status).toBe(400);
    expect((await post({ action: "preview", mode: "sometimes", spaceKey: "PRD" })).status).toBe(400);
  });
});

describe("status", () => {
  it("tells whether Confluence is available and who can publish, without the spaces unless asked", async () => {
    const r = await (await GET(new Request("http://x/api"), ctx)).json();
    expect(r).toMatchObject({ canPublish: true, available: true, site: { name: "Acme" }, last: null });
    expect(r).not.toHaveProperty("spaces");
  });
  it("lists the spaces for a person who can publish; a viewer gets an empty list", async () => {
    expect(await (await GET(new Request("http://x/api?spaces=1"), ctx)).json()).toMatchObject({ spaces: [{ id: "999", key: "GTM", name: "Go-to-market" }, { id: "777", key: "PRD", name: "Product" }] });
    state.rows.tenant_members = [{ role: "viewer", is_service_account: false }];
    expect(await (await GET(new Request("http://x/api?spaces=1"), ctx)).json()).toMatchObject({ canPublish: false, spaces: [] });
  });
  it("shows the last publication and whether the page is out of date", async () => {
    state.rows.item_document_pages = [{ id: "p1", page_id: "5", page_url: "https://acme.atlassian.net/wiki/spaces/PRD/pages/5", page_title: "PRD", space_key: "PRD", sync_mode: "sync", published_version: 1, published_at: "2026-11-26T10:00:00Z", unlinked_at: null }];
    state.rows.item_documents = [{ ...doc, version: 3 }];
    expect(await (await GET(new Request("http://x/api"), ctx)).json()).toMatchObject({ last: { linked: true, outOfDate: true, syncMode: "sync" } });
  });
});

describe("preview, then confirm", () => {
  it("a preview writes nothing; the confirmation with its token creates the page and records it as the person", async () => {
    const p = await (await post({ action: "preview", mode: "sync", spaceKey: "PRD" })).json();
    expect(p.preview).toMatchObject({ action: "create", spaceKey: "PRD" });
    expect(state.inserted).toEqual([]);
    const d = await (await post({ action: "publish", mode: "sync", spaceKey: "PRD", confirm: p.preview.confirm })).json();
    expect(d.done).toMatchObject({ ok: true, action: "create", page: { id: "9001", url: "https://acme.atlassian.net/wiki/spaces/PRD/pages/9001/PRD" } });
    expect(state.inserted).toEqual([expect.objectContaining({ table: "item_document_pages", row: expect.objectContaining({ tenant_id: "t1", item_id: "i1", document_id: DOC, site_id: "s1", space_key: "PRD", page_id: "9001", source: "pv", sync_mode: "sync", published_version: 1 }) })]);
  });

  it("a confirmation without the token, or with another one, writes nothing", async () => {
    const r = await post({ action: "publish", mode: "sync", spaceKey: "PRD" });
    expect(r.status).toBe(409);
    expect((await post({ action: "publish", mode: "sync", spaceKey: "PRD", confirm: "0".repeat(64) })).status).toBe(409);
    expect(state.inserted).toEqual([]);
  });

  it("a Confluence refusal comes back in words, with the right status, and nothing is recorded", async () => {
    state.confluence = async () => ({ status: 403, json: { message: "no permission" } });
    const r = await post({ action: "preview", mode: "once", spaceKey: "PRD", parentUrl: "https://acme.atlassian.net/wiki/spaces/PRD/pages/7/Parent" });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain("Confluence refused");
    expect(state.inserted).toEqual([]);
  });

  it("the commercial terms of the initiative are used for the warning", async () => {
    state.rows.item_documents = [{ ...doc, body: "We aim for Reduce churn to 4% and worth 1,200,000." }];
    state.rows.items = [{ item_code: "R-12", kr_metric: "Reduce churn to 4%", value_12m: 1200000 }];
    const p = await (await post({ action: "preview", mode: "once", spaceKey: "PRD" })).json();
    expect(p.preview.warnings).toEqual(expect.arrayContaining([{ kind: "key_result", what: "The key result of this initiative" }, { kind: "value", what: "The business value of this initiative" }]));
  });

  it("unlink ends the link and leaves the page; nothing to unlink is a 404", async () => {
    expect((await post({ action: "unlink" })).status).toBe(404);
    state.rows.item_document_pages = [{ id: "p1", page_id: "5", page_url: "https://x.test/5", page_title: "PRD", space_key: "PRD", sync_mode: "sync", published_version: 1, published_at: "2026-11-26T10:00:00Z", unlinked_at: null }];
    expect((await post({ action: "unlink" })).status).toBe(200);
    expect(state.updated).toEqual([{ table: "item_document_pages", patch: { unlinked_at: expect.any(String) } }]);
  });
});

describe("a request to publish (issue #693 slice C)", () => {
  const request = { space_key: "GTM", parent_url: "https://acme.atlassian.net/wiki/spaces/GTM/pages/42/Plans", page_title: "GTM plan", sync_mode: "once", note: "Ready for the team", ai_model: "Claude Sonnet 5.5", created_via: "MCP" };

  it("the status shows an open request and who made it, so the dialog can open filled in", async () => {
    state.rows.item_document_publish_requests = [request];
    expect(await (await GET(new Request("http://x/api"), ctx)).json()).toMatchObject({ request: { mode: "once", spaceKey: "GTM", title: "GTM plan", note: "Ready for the team", requestedBy: "Claude", aiModel: "Claude Sonnet 5.5" } });
    state.rows.item_document_publish_requests = [{ ...request, created_via: "UI" }];
    expect(await (await GET(new Request("http://x/api"), ctx)).json()).toMatchObject({ request: { requestedBy: "a person" } });
    state.rows.item_document_publish_requests = [];
    expect((await (await GET(new Request("http://x/api"), ctx)).json()).request).toBeNull();
  });

  it("a request alone publishes nothing: only the confirmed publish writes, and it then clears the request", async () => {
    state.rows.item_document_publish_requests = [request];
    const p = await (await post({ action: "preview", mode: "once", spaceKey: "GTM" })).json();
    expect(state.inserted).toEqual([]);
    expect(state.deleted).toEqual([]);
    await post({ action: "publish", mode: "once", spaceKey: "GTM", confirm: p.preview.confirm });
    expect(state.inserted).toHaveLength(1);
    expect(state.deleted).toEqual(["item_document_publish_requests"]);
  });

  it("a failed publish leaves the request where it is", async () => {
    state.rows.item_document_publish_requests = [request];
    state.confluence = async () => ({ status: 403, json: { message: "no" } });
    await post({ action: "publish", mode: "once", spaceKey: "GTM", confirm: "0".repeat(64) });
    expect(state.deleted).toEqual([]);
  });

  it("dismiss removes the request and touches no page; a viewer, a service account and a stranger cannot", async () => {
    expect((await post({ action: "dismiss" })).status).toBe(200);
    expect(state.deleted).toEqual(["item_document_publish_requests"]);
    state.deleted = [];
    state.rows.tenant_members = [{ role: "viewer", is_service_account: false }];
    expect((await post({ action: "dismiss" })).status).toBe(403);
    state.rows.tenant_members = [{ role: "creator", is_service_account: true }];
    expect((await post({ action: "dismiss" })).status).toBe(403);
    expect(state.deleted).toEqual([]);
    expect(state.inserted).toEqual([]);
  });
});
