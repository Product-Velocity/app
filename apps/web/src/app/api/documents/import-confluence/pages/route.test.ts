import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfluenceRequest } from "@/lib/confluence/client";

// Browsing Confluence for a page to import (issue #693 slice A2): who may, and that only titles, ids and the site address come back.
const state = { user: { id: "u1" } as { id: string } | null, rows: {} as Record<string, unknown[]>, site: null as null | { connectionId: string; siteId: string; siteUrl: string; siteName: string; missingScopes: string[] } };
function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is"]) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: (state.rows[table] ?? [])[0] ?? null, error: null });
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => query(t) }) }));
const confluence: ConfluenceRequest = async (_m, path) => {
  if (path.startsWith("/api/v2/spaces?") && path.includes("keys=")) return { status: 200, json: { results: [{ id: "999", key: "GTM", name: "GTM", type: "global" }] } };
  if (path.startsWith("/api/v2/spaces/999/pages")) return { status: 200, json: { results: [{ id: "20", title: "Home", body: { storage: { value: "SECRET" } } }] } };
  if (path.startsWith("/api/v2/spaces")) return { status: 200, json: { results: [{ id: "999", key: "GTM", name: "Go to market", type: "global" }] } };
  return { status: 500, json: null };
};
vi.mock("@/lib/confluence/server", () => ({ confluenceSiteFor: async () => state.site, confluenceRequest: () => confluence }));

import { GET } from "./route";
const ITEM = "11111111-1111-4111-8111-111111111111";
const get = (qs: string) => GET(new Request(`http://x/api?${qs}`));

beforeEach(() => {
  state.user = { id: "u1" };
  state.site = { connectionId: "c1", siteId: "s1", siteUrl: "https://acme.atlassian.net", siteName: "Acme", missingScopes: [] };
  state.rows = { items: [{ tenant_id: "t1" }], tenant_members: [{ role: "creator", is_service_account: false }] };
});

describe("browse Confluence to import a page", () => {
  it("lists the spaces with the site address, and a space's pages by title only", async () => {
    expect(await (await get(`item=${ITEM}&spaces=1`)).json()).toMatchObject({ siteUrl: "https://acme.atlassian.net", spaces: [{ key: "GTM" }] });
    const j = await (await get(`item=${ITEM}&space=GTM`)).json();
    expect(j).toEqual({ pages: [{ id: "20", title: "Home" }] });
    expect(JSON.stringify(j)).not.toContain("SECRET");
  });
  it("refuses a signed-out person, a bad id, a viewer, a service account and a workspace without Confluence", async () => {
    state.user = null;
    expect((await get(`item=${ITEM}&spaces=1`)).status).toBe(401);
    state.user = { id: "u1" };
    expect((await get("item=nope&spaces=1")).status).toBe(400);
    state.rows.tenant_members = [{ role: "viewer", is_service_account: false }];
    expect((await get(`item=${ITEM}&spaces=1`)).status).toBe(403);
    state.rows.tenant_members = [{ role: "creator", is_service_account: true }];
    expect((await get(`item=${ITEM}&spaces=1`)).status).toBe(403);
    state.rows.tenant_members = [{ role: "creator", is_service_account: false }];
    state.site = null;
    expect((await get(`item=${ITEM}&spaces=1`)).status).toBe(409);
  });
});
