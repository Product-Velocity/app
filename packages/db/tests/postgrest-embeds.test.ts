import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.close(); });

// loadMemberships (apps/web/src/lib/session.ts) embeds `tenants!tenant_members_tenant_id_fkey(name)`. The hint is needed because PostgREST also
// sees a junction path (a table whose primary key covers its foreign-key columns, with foreign keys to both tables) and answers HTTP 300 for a bare
// `tenants(name)` (issue #335, tenant_gate_approvers). These tests keep the constraint the hint names, and show that the second path exists.
describe("PostgREST embeds between tenant_members and tenants", () => {
  it("the foreign key named in the embed hint exists", async () => {
    const r = await db.admin.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'tenant_members_tenant_id_fkey' and conrelid = 'public.tenant_members'::regclass`);
    expect(r.rows[0]?.def).toContain("REFERENCES tenants(id)");
  });

  it("a junction table gives tenant_members a second path to tenants, so a bare embed would be ambiguous", async () => {
    const r = await db.admin.query(`
      select distinct p.conrelid::regclass::text as junction
        from pg_constraint p
        join pg_constraint a on a.conrelid = p.conrelid and a.contype = 'f' and a.confrelid = 'public.tenants'::regclass
        join pg_constraint b on b.conrelid = p.conrelid and b.contype = 'f' and b.confrelid = 'public.tenant_members'::regclass
       where p.contype = 'p' and p.conkey @> a.conkey and p.conkey @> b.conkey`);
    expect(r.rows.map((x) => x.junction)).toContain("tenant_gate_approvers");
  });
});
