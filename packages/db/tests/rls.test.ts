import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, errorCode, twoTenantFixture, type TestDb } from "./helpers";

const DENIED = "42501"; // insufficient_privilege, also raised for RLS WITH CHECK violations

let db: TestDb;
let f: Awaited<ReturnType<typeof twoTenantFixture>>;

beforeAll(async () => {
  db = await createTestDb();
  f = await twoTenantFixture(db);
});
afterAll(async () => {
  await db.close();
});

/**
 * Every table in `public` must be listed here with probes that try to cross the
 * tenant boundary. A new table without an entry fails the "covers every table"
 * test below (CLAUDE.md rule 1: no table without RLS and an isolation test).
 *
 * `attack(otherTenant, ownTenant)` runs as a user of ownTenant against rows of
 * otherTenant and must leave them untouched.
 */
type Probe = {
  table: string;
  /** Rows visible to a user of the *other* tenant must be zero. */
  tenantColumn: string;
  /** Personal data: nobody reads the table through the API at all (functions only), so reads must be denied even for the tenant's own admin. */
  private?: boolean;
  /** Statements run as the attacker; each must either be denied or affect 0 rows. */
  attacks: (victim: { tenantId: string; memberId: string }, attacker: { userId: string; tenantId: string }) => { sql: string; params: unknown[] }[];
};

const probes: Probe[] = [
  {
    table: "tenants",
    tenantColumn: "id",
    attacks: (v) => [
      { sql: "update public.tenants set name = 'pwned' where id = $1", params: [v.tenantId] },
      { sql: "delete from public.tenants where id = $1", params: [v.tenantId] },
      { sql: "insert into public.tenants (id, name) values (gen_random_uuid(), 'x')", params: [] },
    ],
  },
  {
    table: "tenant_members",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.tenant_members set role = 'viewer' where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.tenant_members set is_approver = true where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.tenant_members where tenant_id = $1", params: [v.tenantId] },
      {
        sql: "insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'admin')",
        params: [v.tenantId, a.userId],
      },
      // try to move the attacker's own membership into the victim tenant
      { sql: "update public.tenant_members set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "projects",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.projects set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.projects where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.projects (tenant_id, name) values ($1, 'Injected')", params: [v.tenantId] },
      { sql: "update public.projects set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "teams",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.teams set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.teams where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.teams (tenant_id, name) values ($1, 'Injected')", params: [v.tenantId] },
      { sql: "update public.teams set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "items",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.items set initiative_name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.items where tenant_id = $1", params: [v.tenantId] },
      {
        sql: "insert into public.items (tenant_id, initiative_name, home_project_id) select $1, 'Injected', id from public.projects where tenant_id = $1",
        params: [v.tenantId],
      },
      { sql: "update public.items set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
      // the re-rank function must refuse items of another tenant
      { sql: "select public.move_item(id, 1) from public.items where tenant_id = $1 and stack_rank = 3", params: [v.tenantId] },
    ],
  },
  {
    table: "saved_scopes",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.saved_scopes set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.saved_scopes where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.saved_scopes (tenant_id, name) values ($1, 'Injected')", params: [v.tenantId] },
      { sql: "update public.saved_scopes set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "saved_scope_projects",
    tenantColumn: "tenant_id",
    attacks: (v) => [
      { sql: "delete from public.saved_scope_projects where tenant_id = $1", params: [v.tenantId] },
      {
        sql: "insert into public.saved_scope_projects (tenant_id, scope_id, project_id) select $1, scope_id, project_id from public.saved_scope_projects where tenant_id = $1",
        params: [v.tenantId],
      },
    ],
  },
  {
    table: "item_teams",
    tenantColumn: "tenant_id",
    attacks: (v) => [
      { sql: "delete from public.item_teams where tenant_id = $1", params: [v.tenantId] },
      {
        sql: "insert into public.item_teams (tenant_id, item_id, team_id) select $1, i.id, t.id from public.items i, public.teams t where i.tenant_id = $1 and t.tenant_id = $1",
        params: [v.tenantId],
      },
    ],
  },
  {
    table: "weekly_updates",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.weekly_updates set body = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.weekly_updates where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.weekly_updates (tenant_id, week_start, scope_key, body) values ($1, '2026-10-19', 'injected', 'x')", params: [v.tenantId] },
      { sql: "update public.weekly_updates set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "github_connections",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.github_connections set state = 'disconnected' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.github_connections where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.github_connections (tenant_id, expected_account) values ($1, 'attacker')", params: [v.tenantId] },
      { sql: "update public.github_connections set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "item_github_links",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.item_github_links set sync_state = 'error' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.item_github_links where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name) select tenant_id, item_id, connection_id, 'evil/repo' from public.item_github_links where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.item_github_links set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "item_issue_tree",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.item_issue_tree set title = 'x' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.item_issue_tree where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_issue_tree (tenant_id, item_id, repo_full_name, issue_number, level, title, state) select tenant_id, item_id, 'evil/repo', 99, 1, 'x', 'open' from public.item_issue_tree where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.item_issue_tree set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "tracker_issues",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.tracker_issues set pull_state = 'ignored' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.tracker_issues where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.tracker_issues (tenant_id, connection_id, repo_full_name, issue_number, title) select tenant_id, connection_id, 'evil/repo', 99, 'x' from public.tracker_issues where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.tracker_issues set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "tracker_rules",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.tracker_rules set removed_at = now() where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.tracker_rules where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.tracker_rules (tenant_id, connection_id, kind, value) select tenant_id, connection_id, 'type', 'Evil' from public.tracker_rules where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.tracker_rules set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "alignment_sessions",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.alignment_sessions set status = 'closed' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.alignment_sessions where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.alignment_sessions (tenant_id, name, method) values ($1, 'Injected', 'coins')", params: [v.tenantId] },
      { sql: "update public.alignment_sessions set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "alignment_participants",
    tenantColumn: "tenant_id",
    private: true,
    attacks: (v, a) => [
      { sql: "update public.alignment_participants set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.alignment_participants where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.alignment_participants (tenant_id, session_id, email, group_id) select tenant_id, session_id, 'x@example.test', 'everyone' from public.alignment_participants where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.alignment_participants set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "alignment_ballots",
    tenantColumn: "tenant_id",
    private: true,
    attacks: (v, a) => [
      { sql: "update public.alignment_ballots set state = 'submitted' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.alignment_ballots where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.alignment_ballots (tenant_id, session_id, group_id) select tenant_id, session_id, 'everyone' from public.alignment_ballots where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.alignment_ballots set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "alignment_votes",
    tenantColumn: "tenant_id",
    private: true,
    attacks: (v, a) => [
      { sql: "update public.alignment_votes set coins = 99 where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.alignment_votes where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.alignment_votes (tenant_id, session_id, ballot_id, alignment_item_id, coins) select tenant_id, session_id, ballot_id, alignment_item_id, 5 from public.alignment_votes where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.alignment_votes set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "alignment_mailings",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.alignment_mailings set status = 'confirmed' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.alignment_mailings where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.alignment_mailings (tenant_id, session_id, kind, subject, body) select tenant_id, session_id, 'invitation', 'x', 'y' from public.alignment_mailings where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.alignment_mailings set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "alignment_items",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.alignment_items set shown_name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.alignment_items where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.alignment_items (tenant_id, session_id, position) select tenant_id, session_id, 99 from public.alignment_items where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.alignment_items set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "sync_events",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.sync_events set state = 'processed' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.sync_events where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.sync_events (tenant_id, connection_id, delivery_id, event) select tenant_id, connection_id, 'evil', 'issues' from public.sync_events where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.sync_events set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "github_repositories",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.github_repositories set removed_at = now() where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.github_repositories where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.github_repositories (tenant_id, connection_id, github_repo_id, full_name) select tenant_id, id, 99, 'evil/repo' from public.github_connections where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.github_repositories set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "item_groups",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.item_groups set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.item_groups where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_groups (tenant_id, name) values ($1, 'Injected')", params: [v.tenantId] },
      { sql: "update public.item_groups set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "saved_views",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.saved_views set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.saved_views where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.saved_views (tenant_id, name, columns) values ($1, 'Injected', array['item_code'])", params: [v.tenantId] },
      { sql: "update public.saved_views set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "item_tags",
    tenantColumn: "tenant_id",
    attacks: (v) => [
      { sql: "delete from public.item_tags where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_tags (tenant_id, item_id, kind, value) select $1, item_id, 'tag', 'injected' from public.item_tags where tenant_id = $1", params: [v.tenantId] },
    ],
  },
  {
    table: "item_links",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.item_links set url = 'https://evil.test' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.item_links where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_links (tenant_id, item_id, label, url) select $1, item_id, 'x', 'https://evil.test' from public.item_links where tenant_id = $1", params: [v.tenantId] },
      { sql: "update public.item_links set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "item_files",
    tenantColumn: "tenant_id",
    attacks: (v) => [
      { sql: "update public.item_files set name = 'pwned' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.item_files where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_files (tenant_id, item_id, name, storage_path) select $1, item_id, 'x', 'x' from public.item_files where tenant_id = $1", params: [v.tenantId] },
    ],
  },
  {
    table: "item_relations",
    tenantColumn: "tenant_id",
    attacks: (v) => [
      { sql: "delete from public.item_relations where tenant_id = $1", params: [v.tenantId] },
      { sql: "insert into public.item_relations (tenant_id, item_id, related_item_id, kind) select $1, related_item_id, item_id, 'related_to' from public.item_relations where tenant_id = $1", params: [v.tenantId] },
    ],
  },
  {
    table: "invitations",
    tenantColumn: "tenant_id",
    attacks: (v, a) => [
      { sql: "update public.invitations set revoked_at = now() where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.invitations where tenant_id = $1", params: [v.tenantId] },
      {
        sql: "insert into public.invitations (tenant_id, email, role, token_hash) values ($1, 'x@example.test', 'admin', 'h-' || $2)",
        params: [v.tenantId, a.userId],
      },
      { sql: "update public.invitations set tenant_id = $1 where tenant_id = $2", params: [v.tenantId, a.tenantId] },
    ],
  },
  {
    table: "audit_log",
    tenantColumn: "tenant_id",
    attacks: (v) => [
      { sql: "update public.audit_log set field = 'x' where tenant_id = $1", params: [v.tenantId] },
      { sql: "delete from public.audit_log where tenant_id = $1", params: [v.tenantId] },
      {
        sql: "insert into public.audit_log (tenant_id, entity, field, via) values ($1, 'tenants', 'name', 'UI')",
        params: [v.tenantId],
      },
    ],
  },
];

describe("RLS covers every table", () => {
  it("every public table has RLS enabled", async () => {
    const { rows } = await db.admin.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("every public table has an isolation probe in this file", async () => {
    const { rows } = await db.admin.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
    );
    const tables = rows.map((r) => r.relname as string);
    expect(probes.map((p) => p.table).sort()).toEqual(tables);
  });

  it("internal trigger functions are not callable by API roles, and no function has a mutable search_path", async () => {
    for (const fn of ["audit_row()", "set_write_meta()", "guard_approver()", "audit_log_append_only()", "guard_last_admin()", "items_before_insert()", "items_guard()", "items_compact()", "items_system_fields()"]) {
      for (const role of ["anon", "authenticated"]) {
        const { rows } = await db.admin.query("select has_function_privilege($1, $2, 'execute') as ok", [role, `public.${fn}`]);
        expect(rows[0].ok, `${role} can execute ${fn}`).toBe(false);
      }
    }
    const { rows } = await db.admin.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
         and (p.proconfig is null or not exists (
         select 1 from unnest(p.proconfig) c where c like 'search_path=%'))`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("anonymous users cannot touch any table", async () => {
    for (const p of probes) {
      expect(await errorCode(db.asAnon((q) => q(`select * from public.${p.table}`)))).toBe(DENIED);
    }
  });
});

describe.each([
  { name: "A cannot reach B", get: () => ({ attackerKey: "alice" as const, own: "tenantA" as const, victim: "tenantB" as const }) },
  { name: "B cannot reach A", get: () => ({ attackerKey: "bob" as const, own: "tenantB" as const, victim: "tenantA" as const }) },
])("two-tenant isolation: $name", ({ get }) => {
  for (const p of probes) {
    describe(p.table, () => {
      it("reads: no rows of the other tenant are visible", async () => {
        const { attackerKey, victim } = get();
        const userId = f[attackerKey];
        // audit_log is admin-only, and both attackers are admins of their own tenant
        if (p.private) {
          expect(await errorCode(db.asUser(userId, (q) => q(`select * from public.${p.table} where ${p.tenantColumn} = $1`, [f[victim]])))).toBe(DENIED);
          return;
        }
        const rows = await db.asUser(userId, async (q) =>
          (await q(`select * from public.${p.table} where ${p.tenantColumn} = $1`, [f[victim]])).rows,
        );
        expect(rows).toHaveLength(0);
      });

      it("positive control: the user does see their own tenant's rows", async () => {
        const { attackerKey, own } = get();
        if (p.private) {
          // the rows exist, but only the server reads them; the admin's own read is refused as well
          expect(Number((await db.admin.query(`select count(*) from public.${p.table} where ${p.tenantColumn} = $1`, [f[own]])).rows[0].count)).toBeGreaterThan(0);
          expect(await errorCode(db.asUser(f[attackerKey], (q) => q(`select * from public.${p.table} where ${p.tenantColumn} = $1`, [f[own]])))).toBe(DENIED);
          return;
        }
        const rows = await db.asUser(f[attackerKey], async (q) =>
          (await q(`select * from public.${p.table} where ${p.tenantColumn} = $1`, [f[own]])).rows,
        );
        expect(rows.length).toBeGreaterThan(0);
      });

      it("writes: every cross-tenant write is denied or affects no rows", async () => {
        const { attackerKey, own, victim } = get();
        const before = await snapshot(p.table, f[victim], p.tenantColumn);
        const { rows: m } = await db.admin.query(
          "select id from public.tenant_members where tenant_id = $1 limit 1",
          [f[victim]],
        );
        const attacks = p.attacks(
          { tenantId: f[victim], memberId: m[0].id },
          { userId: f[attackerKey], tenantId: f[own] },
        );
        for (const a of attacks) {
          let affected = 0;
          const code = await errorCode(
            db.asUser(f[attackerKey], async (q) => {
              affected = (await q(a.sql, a.params)).rowCount ?? 0;
            }, { commit: true }),
          );
          expect(code === DENIED || (code === null && affected === 0), `${a.sql} -> code=${code} affected=${affected}`).toBe(true);
        }
        expect(await snapshot(p.table, f[victim], p.tenantColumn)).toEqual(before);
      });
    });
  }
});

async function snapshot(table: string, tenantId: string, col: string) {
  const { rows } = await db.admin.query(
    `select * from public.${table} where ${col} = $1 order by 1`,
    [tenantId],
  );
  // audit rows from the snapshot reads themselves do not exist; writes by attackers must not change these
  return rows.map((r) => JSON.stringify(r));
}

describe("roles inside a tenant", () => {
  it("a viewer sees the tenant and its members but not the audit log", async () => {
    await db.asUser(f.carol, async (q) => {
      expect((await q("select * from public.tenants")).rows).toHaveLength(1);
      expect((await q("select * from public.tenant_members")).rows).toHaveLength(2);
      expect((await q("select * from public.audit_log")).rows).toHaveLength(0);
    });
  });

  it("a viewer cannot change members, tenant name or grant Approver", async () => {
    for (const sql of [
      "update public.tenant_members set is_approver = true",
      "update public.tenant_members set role = 'admin'",
      "update public.tenants set name = 'x'",
      "delete from public.tenant_members where user_id <> auth.uid()", // leaving is allowed for one's own row (0030, tests/leave-workspace.test.ts), never for others
    ]) {
      const affected = await db.asUser(f.carol, async (q) => (await q(sql)).rowCount, { commit: true });
      expect(affected, sql).toBe(0);
    }
    const { rows } = await db.admin.query("select count(*)::int n from public.tenant_members where is_approver");
    expect(rows[0].n).toBe(0);
  });

  it("a user with no tenant sees nothing", async () => {
    await db.asUser(f.dave, async (q) => {
      for (const t of ["tenants", "tenant_members", "audit_log"]) {
        expect((await q(`select * from public.${t}`)).rows).toHaveLength(0);
      }
    });
  });

  it("an admin can manage members of their own tenant", async () => {
    const affected = await db.asUser(
      f.alice,
      async (q) => (await q("update public.tenant_members set role = 'creator' where user_id = $1", [f.carol])).rowCount,
    );
    expect(affected).toBe(1);
  });

  it("tenants can only be created through create_tenant()", async () => {
    expect(
      await errorCode(db.asUser(f.dave, (q) => q("insert into public.tenants (name) values ('x')"))),
    ).toBe(DENIED);
    expect(await errorCode(db.asAnon((q) => q("select public.create_tenant('x')")))).toBe(DENIED);
  });
});
