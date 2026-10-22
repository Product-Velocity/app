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
  return { alice, bob, carol, dave, tenantA, tenantB };
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
