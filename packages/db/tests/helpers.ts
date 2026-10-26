import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
// @ts-expect-error plain ESM module without types
import { migrate } from "../src/migrate.mjs";

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

const shim = readFileSync(
  fileURLToPath(new URL("./supabase-shim.sql", import.meta.url)),
  "utf8",
);

export type TestDb = {
  /** Superuser connection (bypasses RLS). For fixtures and assertions. */
  admin: pg.Client;
  /** Run `fn` as a signed-in user (role `authenticated`), in a transaction. */
  asUser: <T>(
    userId: string,
    fn: (q: Query) => Promise<T>,
    opts?: { via?: string; commit?: boolean; headers?: Record<string, string> },
  ) => Promise<T>;
  /** Run `fn` as the anonymous role. */
  asAnon: <T>(fn: (q: Query) => Promise<T>) => Promise<T>;
  /** Run `fn` as the service role (bypasses RLS). */
  asService: <T>(fn: (q: Query) => Promise<T>, opts?: { via?: string; commit?: boolean }) => Promise<T>;
  close: () => Promise<void>;
};

export type Query = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** Creates a throwaway database with the Supabase shim and (optionally) all migrations. */
export async function createTestDb(opts: { migrations?: boolean } = {}): Promise<TestDb> {
  const name = `pv_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const root = new pg.Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(shim);
  if (opts.migrations !== false) await migrate(admin);

  async function inRole<T>(
    role: string,
    claims: Record<string, unknown> | null,
    fn: (q: Query) => Promise<T>,
    o: { via?: string; commit?: boolean; headers?: Record<string, string> } = {},
  ): Promise<T> {
    await admin.query("begin");
    try {
      await admin.query(`set local role ${role}`);
      if (claims) {
        await admin.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
      }
      if (o.via) await admin.query("select set_config('app.via', $1, true)", [o.via]);
      if (o.headers) {
        await admin.query("select set_config('request.headers', $1, true)", [JSON.stringify(o.headers)]);
      }
      const out = await fn((sql, params) => admin.query(sql, params));
      await admin.query(o.commit ? "commit" : "rollback");
      return out;
    } catch (e) {
      await admin.query("rollback");
      throw e;
    }
  }

  return {
    admin,
    asUser: (userId, fn, o) => inRole("authenticated", { sub: userId, role: "authenticated" }, fn, o),
    asAnon: (fn) => inRole("anon", null, fn),
    asService: (fn, o) => inRole("service_role", { role: "service_role" }, fn, o),
    close: async () => {
      await admin.end();
      const r = new pg.Client({ connectionString: ADMIN_URL });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
}

export async function createUser(
  db: TestDb,
  email: string,
  opts: { confirmed?: boolean } = {},
): Promise<string> {
  const { rows } = await db.admin.query(
    "insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id",
    [email, opts.confirmed === false ? null : new Date()],
  );
  return rows[0].id as string;
}

/** Fixture: tenant A (alice admin, carol viewer) and tenant B (bob admin); dave has no tenant. */
export async function twoTenantFixture(db: TestDb) {
  const alice = await createUser(db, "alice@example.test");
  const bob = await createUser(db, "bob@example.test");
  const carol = await createUser(db, "carol@example.test");
  const dave = await createUser(db, "dave@example.test");

  const tenantA = await db.asUser(
    alice,
    async (q) => (await q("select public.create_tenant('Tenant A') as id")).rows[0].id as string,
    { commit: true },
  );
  const tenantB = await db.asUser(
    bob,
    async (q) => (await q("select public.create_tenant('Tenant B') as id")).rows[0].id as string,
    { commit: true },
  );
  await db.asUser(
    alice,
    (q) =>
      q("insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'viewer')", [
        tenantA,
        carol,
      ]),
    { commit: true },
  );
  // sample workspace data per tenant (positive controls for the Phase 1 tables)
  const seedA = await seedWorkspace(db, tenantA);
  const seedB = await seedWorkspace(db, tenantB);

  // one pending invitation per tenant (positive controls for the invitations table)
  for (const [admin, tenant, email] of [
    [alice, tenantA, "pending-a@example.test"],
    [bob, tenantB, "pending-b@example.test"],
  ] as const) {
    await db.asUser(
      admin,
      (q) => inviteRow(q, tenant, email, "creator", `fixture-${email}`),
      { commit: true },
    );
  }
  return { alice, bob, carol, dave, tenantA, tenantB, seedA, seedB };
}

/** Postgres error code of a rejected promise, or null if it resolved. */
export async function errorCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
}

import { createHash } from "node:crypto";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Insert an invitation as the current user; `token` is hashed like the app does. */
export function inviteRow(
  q: Query,
  tenantId: string,
  email: string,
  role: string,
  token: string,
  isApprover = false,
) {
  return q(
    "insert into public.invitations (tenant_id, email, role, is_approver, token_hash) values ($1, $2, $3, $4, $5)",
    [tenantId, email, role, isApprover, hashToken(token)],
  );
}

/** Project, team, 3 items (ranks 1..3), one saved scope with its links, for one tenant. Written as the superuser. */
export async function seedWorkspace(db: TestDb, tenantId: string) {
  const one = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0].id as string;
  const project = await one("insert into public.projects (tenant_id, name) values ($1, 'Platform') returning id", [tenantId]);
  const team = await one("insert into public.teams (tenant_id, name) values ($1, 'Core') returning id", [tenantId]);
  const items: string[] = [];
  for (const title of ["First", "Second", "Third"]) {
    items.push(
      await one("insert into public.items (tenant_id, initiative_name, home_project_id) values ($1, $2, $3) returning id", [tenantId, title, project]),
    );
  }
  const scope = await one("insert into public.saved_scopes (tenant_id, name) values ($1, 'Everything') returning id", [tenantId]);
  await db.admin.query("insert into public.saved_scope_projects (tenant_id, scope_id, project_id) values ($1, $2, $3)", [tenantId, scope, project]);
  await db.admin.query("insert into public.item_teams (tenant_id, item_id, team_id) values ($1, $2, $3)", [tenantId, items[0], team]);
  // multi-value fields (positive controls for the related tables of migration 0009)
  await db.admin.query("insert into public.item_tags (tenant_id, item_id, kind, value) values ($1, $2, 'tag', 'priority')", [tenantId, items[0]]);
  await db.admin.query("insert into public.item_links (tenant_id, item_id, label, url) values ($1, $2, 'PRD', 'https://example.test/prd')", [tenantId, items[0]]);
  await db.admin.query("insert into public.item_files (tenant_id, item_id, name, storage_path) values ($1, $2, 'shot.png', $3)", [tenantId, items[0], `${tenantId}/shot.png`]);
  await db.admin.query("insert into public.item_relations (tenant_id, item_id, related_item_id, kind) values ($1, $2, $3, 'depends_on')", [tenantId, items[1], items[0]]);
  const view = await one("insert into public.saved_views (tenant_id, name, columns) values ($1, 'Seed view', array['stack_rank', 'item_code', 'initiative_name']) returning id", [tenantId]);
  await db.admin.query("insert into public.item_groups (tenant_id, name) values ($1, 'Seed group') on conflict do nothing", [tenantId]);
  await db.admin.query("insert into public.weekly_updates (tenant_id, week_start, scope_key, body) values ($1, '2026-10-12', 'all', 'Seed update') on conflict do nothing", [tenantId]);
  // a connected GitHub connection with one repository (positive controls for migration 0018)
  const conn = await one("insert into public.github_connections (tenant_id, expected_account, installation_id, account_login, account_type, repository_selection, state) values ($1, 'seed-org', $2, 'seed-org', 'Organization', 'selected', 'connected') returning id", [tenantId, Math.floor(Math.random() * 1e9) + 1]);
  await db.admin.query("insert into public.github_repositories (tenant_id, connection_id, github_repo_id, full_name) values ($1, $2, 1, 'seed-org/roadmap')", [tenantId, conn]);
  await db.admin.query("insert into public.item_github_links (tenant_id, item_id, connection_id, repo_full_name, issue_number, issue_id, html_url, sync_state) values ($1, $2, $3, 'seed-org/roadmap', 1, 1001, 'https://github.com/seed-org/roadmap/issues/1', 'synced')", [tenantId, items[0], conn]);
  await db.admin.query("insert into public.sync_events (tenant_id, connection_id, delivery_id, event, action, repo_full_name, issue_number, state) values ($1, $2, $3, 'issues', 'closed', 'seed-org/roadmap', 1, 'processed')", [tenantId, conn, `seed-${tenantId}`]);
  await db.admin.query("insert into public.item_issue_tree (tenant_id, item_id, repo_full_name, issue_number, issue_id, level, title, state) values ($1, $2, 'seed-org/roadmap', 2, 1002, 1, 'Seed epic', 'open')", [tenantId, items[0]]);
  await db.admin.query("insert into public.tracker_issues (tenant_id, connection_id, repo_full_name, issue_number, title) values ($1, $2, 'seed-org/roadmap', 77, 'Seed incoming issue')", [tenantId, conn]);
  await db.admin.query("insert into public.tracker_rules (tenant_id, connection_id, kind, value) values ($1, $2, 'type', 'Bug')", [tenantId, conn]);
  const sess = await one("insert into public.alignment_sessions (tenant_id, name, method) values ($1, 'Seed session', 'coins') returning id", [tenantId]);
  await db.admin.query("insert into public.alignment_items (tenant_id, session_id, item_id, position) values ($1, $2, $3, 1)", [tenantId, sess, items[0]]);
  await db.admin.query("update public.alignment_sessions set groups = '[{\"id\":\"everyone\",\"name\":\"Everyone\"}]' where id = $1", [sess]);
  const part = await one("insert into public.alignment_participants (tenant_id, session_id, email, email_hash, group_id) values ($1, $2, $3, encode(sha256(convert_to($3, 'UTF8')), 'hex'), 'everyone') returning id", [tenantId, sess, `seed-${tenantId}@example.test`]);
  await db.admin.query("insert into public.alignment_ballots (tenant_id, session_id, participant_id, group_id) values ($1, $2, $3, 'everyone')", [tenantId, sess, part]);
  await db.admin.query("insert into public.alignment_mailings (tenant_id, session_id, kind, subject, body, recipient_ids) values ($1, $2, 'invitation', 'Seed', 'Seed body', array[$3::uuid])", [tenantId, sess, part]);
  return { project, team, items, scope, view, connection: conn };
}

/** Add a member to a tenant as its admin. */
export async function addMember(db: TestDb, admin: string, tenantId: string, userId: string, role: string, extra: { serviceAccount?: boolean } = {}) {
  await db.asUser(
    admin,
    (q) =>
      q(
        "insert into public.tenant_members (tenant_id, user_id, role, is_service_account) values ($1, $2, $3, $4)",
        [tenantId, userId, role, extra.serviceAccount ?? false],
      ),
    { commit: true },
  );
}
