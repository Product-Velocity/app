import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { loadMemberships } = await import("./session");

// PostgREST answers HTTP 300 (PGRST201) when an embed has more than one path. After the decision gates migration (0.98) tenant_gate_approvers
// (primary key tenant_id, gate, user_id; foreign keys to tenants and to tenant_members) became a second path from tenant_members to tenants,
// so the bare `tenants(name)` of loadMemberships failed on every signed-in page. The test database has no PostgREST, so the select is pinned here
// and the constraint name it depends on is pinned in packages/db/tests/postgrest-embeds.test.ts.
describe("loadMemberships", () => {
  it("names the foreign key of the tenants embed so a second path cannot make it ambiguous", async () => {
    let selected = "";
    const q: Record<string, unknown> = {};
    q.select = (s: string) => { selected = s; return q; };
    q.eq = () => q;
    q.order = () => Promise.resolve({ data: [{ tenant_id: "t1", role: "admin", is_approver: false, last_login_at: null, tenants: { name: "Meridian Media" } }], error: null });
    const out = await loadMemberships({ from: () => q } as never, "u1");
    expect(selected).toContain("tenants!tenant_members_tenant_id_fkey(name)");
    expect(selected).not.toMatch(/[^!_]tenants\(/);
    expect(out[0]).toMatchObject({ tenantId: "t1", tenantName: "Meridian Media" });
  });
});
