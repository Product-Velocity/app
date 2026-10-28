import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createUser, errorCode, twoTenantFixture, type TestDb } from "./helpers";

// Issue #219 (R-111) phase 1: platform admin access. Two tenants everywhere (rule 1); a platform admin is never a member.
let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;
let pat: string; // the platform admin (the product owner)
let item: { id: string; home_project_id: string };

const asPat = <T,>(fn: Parameters<TestDb["asUser"]>[1], o?: Parameters<TestDb["asUser"]>[2]) => db.asUser(pat, fn as never, o) as Promise<T>;
const enter = (tenant: string, reason = "support ticket") =>
  db.asUser(pat, async (q) => (await q("select * from public.platform_enter_account($1, $2)", [tenant, reason])).rows[0], { commit: true });
const reset = async () => {
  await db.admin.query("update platform.admins set access_level = null");
  await db.admin.query("update platform.settings set default_access_level = 'read_write'");
  await db.admin.query("delete from platform.account_overrides");
  await db.admin.query("update platform.entries set left_at = now() where left_at is null");
  await db.admin.query("update auth.users set last_sign_in_at = now() where id = $1", [pat]);
};

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
  pat = await createUser(db, "pat@platform.test");
  await db.admin.query(`update auth.users set raw_user_meta_data = '{"full_name":"Pat Owner"}', last_sign_in_at = now() where id = $1`, [pat]);
  await db.admin.query("insert into platform.admins (user_id) values ($1)", [pat]);
  await db.admin.query(`update auth.users set raw_user_meta_data = '{"full_name":"Alice Admin"}' where id = $1`, [f.alice]);
  item = (await db.admin.query("select id, home_project_id from public.items where tenant_id = $1 limit 1", [f.tenantA])).rows[0];
});
afterAll(async () => {
  await db.close();
});

describe("who can use the platform functions (FR-5.3: no leakage)", () => {
  it("ordinary users, including workspace admins, are refused every platform function", async () => {
    for (const sql of [
      "select * from public.platform_accounts()",
      "select * from public.platform_config()",
      "select * from public.platform_admin_list()",
      "select * from public.platform_audit_search()",
      "select * from public.platform_config_log()",
      `select public.platform_enter_account('${f.tenantA}')`,
      "select public.platform_set_default_level('read_only')",
      `select public.platform_set_account_level('${f.tenantA}', 'read_only')`,
      "select public.platform_set_admin('dave@example.test', true)",
    ]) {
      expect(await errorCode(db.asUser(f.alice, (q) => q(sql))), sql).toBe("42501");
    }
    expect((await db.asUser(f.alice, async (q) => (await q("select public.platform_is_admin() v")).rows[0].v))).toBe(false);
  });

  it("the platform tables are not reachable through the API roles", async () => {
    expect(await errorCode(db.asUser(f.alice, (q) => q("select * from platform.admins")))).toBe("42501");
    expect(await errorCode(db.asUser(pat, (q) => q("select * from platform.entries")))).toBe("42501");
    expect(await errorCode(db.asUser(pat, (q) => q("insert into platform.admins (user_id) values ($1)", [f.dave])))).toBe("42501");
  });

  it("a platform admin who has not entered an account sees none of its data (access is by entry, not blanket)", async () => {
    await reset();
    await asPat(async (q) => {
      for (const t of ["tenants", "projects", "items", "tenant_members", "audit_log"]) {
        expect((await q(`select 1 from public.${t}`)).rows, t).toHaveLength(0);
      }
    });
  });
});

describe("All accounts console (FR-2.2)", () => {
  it("lists every account with plan, owner, counts and last activity; search filters by name", async () => {
    const rows = await asPat<{ name: string; plan: string; owner_email: string; member_count: number; project_count: number; last_activity: string }[]>(
      async (q) => (await q("select * from public.platform_accounts()")).rows);
    expect(rows.map((r) => r.name).sort()).toEqual(expect.arrayContaining(["Tenant A", "Tenant B"]));
    const a = rows.find((r) => r.name.startsWith("Tenant A"))!;
    expect(a).toMatchObject({ plan: "Trial", owner_email: "alice@example.test", member_count: 2, project_count: 1 });
    expect(a.last_activity).toBeTruthy();
    const hit = await asPat<{ name: string }[]>(async (q) => (await q("select * from public.platform_accounts('Tenant B')")).rows);
    expect(hit.map((r) => r.name)).toEqual(["Tenant B"]);
  });
});

describe("read & write by default (FR-2.4, acceptance 2 and 4)", () => {
  it("entering requires a recent sign-in in write mode (FR-5.2)", async () => {
    await reset();
    await db.admin.query("update auth.users set last_sign_in_at = now() - interval '2 hours' where id = $1", [pat]);
    expect(await errorCode(db.asUser(pat, (q) => q("select * from public.platform_enter_account($1, 'x')", [f.tenantA])))).toBe("PV020");
    await db.admin.query("update auth.users set last_sign_in_at = now() where id = $1", [pat]);
    const e = await enter(f.tenantA);
    expect(e.access_level).toBe("read_write");
  });

  it("inside the account the platform admin sees its data and the banner details", async () => {
    await asPat(async (q) => {
      expect((await q("select 1 from public.items where tenant_id = $1", [f.tenantA])).rowCount).toBeGreaterThan(0);
      const b = (await q("select * from public.platform_current_entry()")).rows[0];
      expect(b).toMatchObject({ tenant_id: f.tenantA, access_level: "read_write", admin_name: "Pat Owner", admin_email: "pat@platform.test" });
      // still nothing of the other account
      expect((await q("select 1 from public.items where tenant_id = $1", [f.tenantB])).rows).toHaveLength(0);
      expect((await q("select 1 from public.tenants where id = $1", [f.tenantB])).rows).toHaveLength(0);
    });
  });

  it("edits a project item, and the audit log shows the platform admin with name, email, role, badge, project, old and new value", async () => {
    await asPat((q) => q("update public.items set initiative_name = 'Edited by platform' where id = $1", [item.id]), { via: "UI", commit: true });
    await db.asUser(f.alice, (q) => q("update public.items set initiative_name = 'Edited by customer admin' where id = $1", [item.id]), { via: "UI", commit: true });
    const rows = (await db.admin.query("select * from public.audit_log where tenant_id = $1 and entity = 'items' and entity_id = $2 and field = 'initiative_name' order by id", [f.tenantA, item.id])).rows.slice(-2);
    expect(rows[0]).toMatchObject({ actor_id: pat, actor_name: "Pat Owner", actor_email: "pat@platform.test", actor_role: "platform_admin", actor_platform_admin: true, project_id: item.home_project_id, new: "Edited by platform", via: "UI" });
    expect(rows[1]).toMatchObject({ actor_id: f.alice, actor_name: "Alice Admin", actor_email: "alice@example.test", actor_role: "admin", actor_platform_admin: false, project_id: item.home_project_id, old: "Edited by platform", new: "Edited by customer admin" });
  });

  it("entering and leaving are logged in the account's own audit log, visible to its admin", async () => {
    await asPat((q) => q("select public.platform_leave_account()"), { commit: true });
    const seen = await db.asUser(f.alice, async (q) => (await q("select field, actor_name, actor_email, actor_platform_admin from public.audit_log where entity = 'platform_access' order by id")).rows);
    expect(seen.map((r) => r.field)).toEqual(["entered", "left"]);
    expect(seen[0]).toMatchObject({ actor_name: "Pat Owner", actor_email: "pat@platform.test", actor_platform_admin: true });
    // after leaving there is no access any more
    await asPat(async (q) => expect((await q("select 1 from public.items")).rows).toHaveLength(0));
  });

  it("the other account's admin cannot see those entries (isolation)", async () => {
    const rows = await db.asUser(f.bob, async (q) => (await q("select 1 from public.audit_log where entity = 'platform_access'")).rows);
    expect(rows).toHaveLength(0);
  });

  it("entries expire", async () => {
    await reset();
    const e = await enter(f.tenantA);
    await db.admin.query("update platform.entries set expires_at = now() - interval '1 minute' where id = $1", [e.entry_id]);
    await asPat(async (q) => expect((await q("select 1 from public.items")).rows).toHaveLength(0));
    await reset();
  });

  it("entering a second account leaves the first, and logs both", async () => {
    await enter(f.tenantA);
    await enter(f.tenantB);
    const open = (await db.admin.query("select tenant_id from platform.entries where left_at is null")).rows;
    expect(open).toEqual([{ tenant_id: f.tenantB }]);
    expect((await db.admin.query("select count(*)::int n from public.audit_log where tenant_id = $1 and entity = 'platform_access' and field = 'left'", [f.tenantA])).rows[0].n).toBeGreaterThan(1);
    await reset();
  });
});

describe("hidden admin (acceptance 7)", () => {
  it("is not in the members grid, the directory or the member list while inside the account", async () => {
    await enter(f.tenantA);
    await db.asUser(f.alice, async (q) => {
      expect((await q("select 1 from public.members_grid($1) where user_id = $2 or email = 'pat@platform.test'", [f.tenantA, pat])).rows).toHaveLength(0);
      expect((await q("select 1 from public.tenant_directory($1) where user_id = $2", [f.tenantA, pat])).rows).toHaveLength(0);
      expect((await q("select 1 from public.tenant_members where user_id = $1", [pat])).rows).toHaveLength(0);
    });
    expect((await db.admin.query("select 1 from public.tenant_members where user_id = $1", [pat])).rowCount).toBe(0);
    await reset();
  });
});

describe("configurable access level (FR-2.5, FR-2.6, FR-2.7, acceptance 3)", () => {
  const writeAttempts = [
    ["a table write", (q: (s: string, p?: unknown[]) => Promise<unknown>) => q("update public.items set initiative_name = 'blocked' where id = $1", [item.id])],
    ["an insert", (q: (s: string, p?: unknown[]) => Promise<unknown>) => q("insert into public.projects (tenant_id, name) values ($1, 'Blocked project')", [f.tenantA])],
    ["a delete", (q: (s: string, p?: unknown[]) => Promise<unknown>) => q("delete from public.saved_scope_projects where tenant_id = $1", [f.tenantA])],
    ["a settings change", (q: (s: string, p?: unknown[]) => Promise<unknown>) => q("update public.tenants set name = 'Blocked' where id = $1", [f.tenantA])],
  ] as const;

  async function expectReadOnly() {
    await asPat(async (q) => {
      expect((await q("select 1 from public.items where tenant_id = $1", [f.tenantA])).rowCount).toBeGreaterThan(0); // still sees data
    });
    for (const [label, attempt] of writeAttempts) {
      const code = await errorCode(db.asUser(pat, (q) => attempt(q as never), { via: "UI", commit: true }));
      expect(code, label).toBe("PV021");
    }
    expect((await db.admin.query("select initiative_name from public.items where id = $1", [item.id])).rows[0].initiative_name).not.toBe("blocked");
  }

  it("global read-only: rejected by the server", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_default_level('read_only')"), { commit: true });
    const e = await enter(f.tenantA);
    expect(e.access_level).toBe("read_only");
    await expectReadOnly();
    await asPat((q) => q("select public.platform_leave_account()"), { commit: true });
  });

  it("the switch takes effect immediately for an open entry", async () => {
    await reset();
    await enter(f.tenantA);
    await asPat((q) => q("update public.items set initiative_name = 'still allowed' where id = $1", [item.id]), { commit: true });
    await asPat((q) => q("select public.platform_set_admin_level($1, 'read_only')", [pat]), { commit: true });
    await expectReadOnly();
  });

  it("per-admin override beats the platform default (read-only admin under a read-write default, and the reverse)", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_admin_level($1, 'read_only')", [pat]), { commit: true });
    expect((await enter(f.tenantA)).access_level).toBe("read_only");
    await asPat((q) => q("select public.platform_set_default_level('read_only')"), { commit: true });
    await asPat((q) => q("select public.platform_set_admin_level($1, 'read_write')", [pat]), { commit: true });
    expect((await enter(f.tenantA)).access_level).toBe("read_write");
  });

  it("per-account override restricts only that account", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_account_level($1, 'read_only')", [f.tenantA]), { commit: true });
    expect((await enter(f.tenantA)).access_level).toBe("read_only");
    await expectReadOnly();
    const b = await enter(f.tenantB);
    expect(b.access_level).toBe("read_write");
    expect(await errorCode(asPat((q) => q("select public.platform_set_account_level($1, 'read_write')", [f.tenantA])))).toBe("22023");
  });

  it("writes through a security-definer function are refused too", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_account_level($1, 'read_only')", [f.tenantA]), { commit: true });
    await enter(f.tenantA);
    const code = await errorCode(db.asUser(pat, (q) => q("select public.touch_membership_login($1)", [f.tenantA])));
    expect(code).toBeNull(); // not a member: touches nothing, and writes nothing
    const res = await errorCode(db.asUser(pat, (q) => q("select * from public.move_item($1, 1)", [item.id]), { commit: true }));
    expect(res).toBeTruthy();
  });

  it("every configuration change is in the log with the admin's name and email, and the account change is in that account's audit log", async () => {
    const log = await asPat<{ field: string; actor_name: string; actor_email: string }[]>(async (q) => (await q("select * from public.platform_config_log()")).rows);
    expect(log.map((r) => r.field)).toEqual(expect.arrayContaining(["default_access_level", "admin_access_level", "account_access_level"]));
    expect(log[0]).toMatchObject({ actor_name: "Pat Owner", actor_email: "pat@platform.test" });
    const inTenant = await db.asUser(f.alice, async (q) => (await q("select field, actor_name, actor_email, new from public.audit_log where field = 'account_access_level'")).rows);
    expect(inTenant.length).toBeGreaterThan(0);
    expect(inTenant[0]).toMatchObject({ actor_name: "Pat Owner", actor_email: "pat@platform.test", new: "read_only" });
    await reset();
  });
});

describe("carve-outs (CLAUDE.md rule 3 and 10)", () => {
  it("a platform admin cannot change members, roles, Approver or statuses, or invite", async () => {
    await reset();
    await enter(f.tenantA);
    for (const sql of [
      `update public.tenant_members set is_approver = true where tenant_id = '${f.tenantA}'`,
      `update public.tenant_members set role = 'admin' where tenant_id = '${f.tenantA}' and user_id = '${f.carol}'`,
      `delete from public.tenant_members where tenant_id = '${f.tenantA}' and user_id = '${f.carol}'`,
      `insert into public.tenant_members (tenant_id, user_id, role) values ('${f.tenantA}', '${f.dave}', 'viewer')`,
      `insert into public.invitations (tenant_id, email, role, token_hash) values ('${f.tenantA}', 'x@y.test', 'viewer', 'hh')`,
      `select * from public.set_member_status(array(select id from public.tenant_members where user_id = '${f.carol}' and tenant_id = '${f.tenantA}'), 'paused')`,
    ]) {
      const code = await errorCode(db.asUser(pat, (q) => q(sql), { commit: true }));
      expect(code, sql).toBe("PV022");
    }
    expect((await db.admin.query("select count(*)::int n from public.tenant_members where is_approver")).rows[0].n).toBe(0);
    await reset();
  });

  it("a platform admin who is ALSO a member keeps the rights of that membership", async () => {
    await db.admin.query("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'creator')", [f.tenantB, pat]);
    await asPat((q) => q("select public.platform_set_account_level($1, 'read_only')", [f.tenantB]), { commit: true });
    await enter(f.tenantB);
    await asPat((q) => q("update public.items set initiative_name = 'as a member' where tenant_id = $1", [f.tenantB]), { commit: true });
    const row = (await db.admin.query("select actor_role, actor_platform_admin from public.audit_log where tenant_id = $1 and field = 'initiative_name' order by id desc limit 1", [f.tenantB])).rows[0];
    expect(row).toEqual({ actor_role: "creator", actor_platform_admin: false });
    await db.admin.query("delete from public.tenant_members where tenant_id = $1 and user_id = $2", [f.tenantB, pat]);
    await reset();
  });
});

describe("granting and removing platform admins", () => {
  it("only an active platform admin can; changes are logged; you cannot remove yourself; removal ends open entries", async () => {
    await reset();
    await asPat((q) => q("select public.platform_set_admin('dave@example.test', true)"), { commit: true });
    expect((await db.asUser(f.dave, async (q) => (await q("select public.platform_is_admin() v")).rows[0].v))).toBe(true);
    expect(await errorCode(asPat((q) => q("select public.platform_set_admin('pat@platform.test', false)")))).toBe("PV023");
    await db.admin.query("update auth.users set last_sign_in_at = now() where id = $1", [f.dave]);
    await db.asUser(f.dave, (q) => q("select public.platform_enter_account($1, 'x')", [f.tenantA]), { commit: true });
    await asPat((q) => q("select public.platform_set_admin('dave@example.test', false)"), { commit: true });
    expect((await db.admin.query("select count(*)::int n from platform.entries where user_id = $1 and left_at is null", [f.dave])).rows[0].n).toBe(0);
    expect(await errorCode(db.asUser(f.dave, (q) => q("select * from public.platform_accounts()")))).toBe("42501");
    const log = await asPat<{ field: string }[]>(async (q) => (await q("select * from public.platform_config_log()")).rows);
    expect(log.filter((r) => r.field === "platform_admin")).toHaveLength(2);
  });

  it("the configuration log is append-only", async () => {
    expect(await errorCode(db.admin.query("update platform.config_log set field = 'x'"))).toBeTruthy();
    expect(await errorCode(db.admin.query("delete from platform.config_log"))).toBeTruthy();
  });
});

describe("platform-wide audit log (FR-6.6)", () => {
  it("a platform admin can search every account's log; filters work", async () => {
    const all = await asPat<{ tenant_id: string }[]>(async (q) => (await q("select * from public.platform_audit_search()")).rows);
    expect(new Set(all.map((r) => r.tenant_id))).toEqual(new Set([f.tenantA, f.tenantB]));
    const one = await asPat<{ tenant_id: string; actor_email: string }[]>(async (q) => (await q("select * from public.platform_audit_search($1, 'pat@')", [f.tenantA])).rows);
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((r) => r.tenant_id === f.tenantA && r.actor_email === "pat@platform.test")).toBe(true);
  });
});

describe("guard coverage", () => {
  it("every public table with a tenant has the read-only guard, so a new table cannot be forgotten", async () => {
    const { rows } = await db.admin.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
          and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = case when c.relname = 'tenants' then 'id' else 'tenant_id' end and not a.attisdropped)
          and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'a_platform_readonly_guard')`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
