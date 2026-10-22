// Spike S7: cost of tenant-membership RLS on a large table, and of audit triggers on bulk edits.
// Needs a throwaway Postgres superuser URL in TEST_DATABASE_URL (default: local). Run from the repo root:
//   node spikes/s7-rls-perf/run.mjs
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "../../packages/db/node_modules/pg/lib/index.js";
import { migrate } from "../../packages/db/src/migrate.mjs";

const ADMIN = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const TENANTS = Number(process.env.TENANTS ?? 500), ROWS = Number(process.env.ROWS ?? 2000);
const name = `s7_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const root = new pg.Client({ connectionString: ADMIN }); await root.connect();
await root.query(`create database ${name}`); await root.end();
const url = new URL(ADMIN); url.pathname = `/${name}`;
const db = new pg.Client({ connectionString: url.toString() }); await db.connect();
await db.query(readFileSync(new URL("../../packages/db/tests/supabase-shim.sql", import.meta.url), "utf8"));
await migrate(db, undefined);

const q = (s, p) => db.query(s, p);
console.log(`seeding ${TENANTS} tenants x ${ROWS} rows = ${TENANTS * ROWS} items ...`);
await q(`create table public.items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
  rank int not null, title text not null, moscow text, size text, owner text, value int, created_at timestamptz default now(), updated_at timestamptz default now())`);
await q(`create index items_tenant_idx on public.items (tenant_id, rank)`);
await q(`alter table public.items enable row level security`);
await q(`grant select, insert, update, delete on public.items to authenticated`);
await q(`insert into auth.users (id, email, email_confirmed_at) select gen_random_uuid(), 'u'||g||'@x.test', now() from generate_series(1, ${TENANTS}) g`);
await q(`insert into public.tenants (name) select 'T'||g from generate_series(1, ${TENANTS}) g`);
await q(`insert into public.tenant_members (tenant_id, user_id, role)
  select t.id, u.id, 'admin' from (select id, row_number() over () rn from public.tenants) t join (select id, row_number() over () rn from auth.users) u using (rn)`);
await q(`insert into public.items (tenant_id, rank, title, moscow, size, owner, value)
  select t.id, g, 'Initiative '||g, 'Should', 'M', 'Person '||(g%40), g%100 from public.tenants t, generate_series(1, ${ROWS}) g`);
await q(`analyze`);

// one user who belongs to 25 tenants (consultancy / leadership case)
const { rows: [multi] } = await q(`insert into auth.users (email, email_confirmed_at) values ('multi@x.test', now()) returning id`);
await q(`insert into public.tenant_members (tenant_id, user_id, role) select id, $1, 'viewer' from public.tenants order by name limit 25`, [multi.id]);
const { rows: [single] } = await q(`select m.user_id as id, m.tenant_id from public.tenant_members m where m.user_id <> $1 limit 1`, [multi.id]);
const { rows: [multiT] } = await q(`select tenant_id from public.tenant_members where user_id = $1 limit 1`, [multi.id]);

const policies = {
  "A  is_tenant_member(tenant_id)  [current pattern]": `public.is_tenant_member(tenant_id)`,
  "B  tenant_id in (select … from tenant_members where user_id = (select auth.uid()))": `tenant_id in (select m.tenant_id from public.tenant_members m where m.user_id = (select auth.uid()))`,
  "C  tenant_id = any(array(select my_tenant_ids()))  [definer, hoisted]": `tenant_id = any(array(select public.my_tenant_ids()))`,
};
await q(`create function public.my_tenant_ids() returns setof uuid language sql stable security definer set search_path = '' as $$ select tenant_id from public.tenant_members where user_id = auth.uid() $$`);
await q(`grant execute on function public.my_tenant_ids() to authenticated`);

async function timeAs(userId, sql, params = [], runs = 7) {
  const ms = [];
  for (let i = 0; i < runs; i++) {
    await q("begin"); await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    const t = performance.now(); const r = await q(sql, params); ms.push(performance.now() - t);
    await q("rollback");
    if (i === 0) var rowCount = r.rows[0]?.n ?? r.rowCount;
  }
  ms.sort((a, b) => a - b); return { p50: +ms[Math.floor(ms.length / 2)].toFixed(1), max: +ms.at(-1).toFixed(1), rows: rowCount };
}

const results = {};
for (const [label, expr] of Object.entries(policies)) {
  await q(`drop policy if exists items_select on public.items`);
  await q(`create policy items_select on public.items for select to authenticated using (${expr})`);
  results[label] = {
    "1 project (2,000 rows), filtered by tenant": await timeAs(single.id, `select count(*)::int n from public.items where tenant_id = '${single.tenant_id}'`),
    "same, user in 25 tenants": await timeAs(multi.id, `select count(*)::int n from public.items where tenant_id = '${multiT.tenant_id}'`),
    "UNFILTERED count, user in 1 tenant (1M rows table)": await timeAs(single.id, `select count(*)::int n from public.items`, [], 3),
    "UNFILTERED count, user in 25 tenants": await timeAs(multi.id, `select count(*)::int n from public.items`, [], 3),
  };
}
console.log(JSON.stringify(results, null, 1));

// Audit-trigger cost on a bulk edit (one changed field per row, like "set MoSCoW" on N rows)
await q(`drop policy if exists items_select on public.items`);
await q(`create policy items_select on public.items for select to authenticated using (tenant_id = any(array(select public.my_tenant_ids())))`);
await q(`create policy items_update on public.items for update to authenticated using (tenant_id = any(array(select public.my_tenant_ids()))) with check (tenant_id = any(array(select public.my_tenant_ids())))`);
const bulk = async (n, label) => {
  const out = {};
  for (const mode of ["no audit trigger", "with audit trigger (per-field rows)"]) {
    await q(`drop trigger if exists items_audit on public.items`);
    if (mode.startsWith("with")) await q(`create trigger items_audit after insert or update or delete on public.items for each row execute function public.audit_row()`);
    out[mode] = await timeAs(single.id, `with t as (select id from public.items where tenant_id = '${single.tenant_id}' order by rank limit ${n}) update public.items i set moscow = 'Must' from t where i.id = t.id`, [], 5);
  }
  return out;
};
const audit = { "bulk update 100 rows": await bulk(100), "bulk update 2,000 rows": await bulk(2000) };
console.log(JSON.stringify(audit, null, 1));
const { rows: [sz] } = await q(`select pg_size_pretty(pg_total_relation_size('public.items')) items_size, (select count(*) from public.audit_log) audit_rows`);
console.log("table size:", sz.items_size, "| audit rows now:", sz.audit_rows);
await db.end();
const r2 = new pg.Client({ connectionString: ADMIN }); await r2.connect(); await r2.query(`drop database ${name} with (force)`); await r2.end();
