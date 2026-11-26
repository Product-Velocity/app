import { beforeEach, describe, expect, it, vi } from "vitest";

// Which Confluence site a workspace reaches, and which permissions its sign-in lacks (issue #693: Confluence has its own connection).
let rows: unknown[] = [];
const queried: { table: string; filters: [string, unknown][] }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = { table, filters: [] as [string, unknown][] };
      queried.push(q);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit"]) b[m] = () => b;
      b.eq = (k: string, v: unknown) => { q.filters.push([k, v]); return b; };
      b.then = (r: (v: unknown) => unknown) => r({ data: rows, error: null });
      return b;
    },
  }),
}));
vi.mock("@/lib/atlassian/server", () => ({ accessTokenFor: vi.fn(async () => "tok") }));

import { confluenceSiteFor } from "./server";
import { CONFLUENCE_REQUIRED } from "@/lib/atlassian/oauth";

beforeEach(() => { rows = []; queried.length = 0; });

describe("the Confluence site of a workspace", () => {
  it("reads only the Confluence connection of that workspace that is connected, and returns ids and names, never a token", async () => {
    rows = [{ id: "c1", sites: [{ id: "s1", name: "Acme", url: "https://acme.atlassian.net" }], scopes: CONFLUENCE_REQUIRED.join(" ") }];
    const s = await confluenceSiteFor("t1");
    expect(s).toEqual({ connectionId: "c1", siteId: "s1", siteUrl: "https://acme.atlassian.net", siteName: "Acme", missingScopes: [] });
    expect(queried[0]).toMatchObject({ table: "confluence_connections", filters: [["tenant_id", "t1"], ["state", "connected"]] });
    expect(JSON.stringify(s)).not.toMatch(/token|secret/i);
  });
  it("says which permissions the sign-in was not granted", async () => {
    rows = [{ id: "c1", sites: [{ id: "s1", name: "Acme", url: "https://acme.atlassian.net" }], scopes: "read:space:confluence offline_access" }];
    expect((await confluenceSiteFor("t1"))?.missingScopes).toEqual(["read:page:confluence", "write:page:confluence"]);
  });
  it("is null when there is no connection or it reaches no site", async () => {
    expect(await confluenceSiteFor("t1")).toBeNull();
    rows = [{ id: "c1", sites: [], scopes: "" }];
    expect(await confluenceSiteFor("t1")).toBeNull();
  });
});
