# Scaling and dedicated databases

Written 2026-10-23 after Ashu asked how the platform behaves with 250 clients, each with about 500 initiatives a year, connected to Jira, syncing daily. **The numbers are estimates, not measurements.** Re-measure on real data before the pilot and again every quarter (see "Triggers").

## Size estimate (250 clients)
| Data | Assumption | Per year |
|---|---|---|
| Initiatives (`items`) | 125,000 rows, about 3 KB each | about 1 GB with indexes |
| Audit log | about 30 changed fields per initiative, one row each | about 4M rows, 1.5–2 GB |
| Light records of tracker issues (`tracker_issues`) | 10,000–50,000 issues per customer | 2.5M–12M rows, 2–8 GB |
| Epics and tasks (`item_issue_tree`) | tens per initiative | millions of small rows |
| Sync log (`sync_events`) | one row per delivery on a linked issue | grows without a limit until pruned |

Tens of GB and tens of millions of rows after a year or two is comfortable for one Postgres instance (Supabase Pro or Team at a mid compute size). The design already helps: every tenant table is indexed from `tenant_id`, and row-level security uses the fast `my_tenant_ids()` pattern (spike S7).

## What hurts first, and what we do
1. **Write amplification.** A sync that rewrites unchanged rows costs disk, log traffic and bloat for no information. Fixed in migration 0027: the light-record sync and the issue sync write only when a value differs. Rule for every future sync (Jira included): compare before writing; never write "last seen" timestamps per row.
2. **Audit log and sync log growth.** Plan: partition `audit_log` by month, keep it online for 24 months, archive older months to storage; prune `sync_events` to 90 days (go-live checklist).
3. **Noisy neighbours.** One customer's big Jira sync must not slow the others. Plan: sync jobs run from a queue, one job per customer at a time, a global concurrency limit, back-off on the tracker's rate limits. Today a check runs after the response in one function (fine for dozens of customers, not hundreds).
4. **Connections.** Serverless functions use the Supabase pooler in transaction mode before real traffic.
5. **The grid loads a whole project in the browser.** Fine for a few thousand initiatives per project; 500 a year is far below that. The Incoming list pages in 200 rows and loads at most a few thousand light records per connection; a customer with tens of thousands of Jira issues needs server-side paging there before Jira ships (Phase 3b).
6. **Reports and insights** read audit-derived durations (`item_stage_durations`): index by tenant and entity, and materialise per tenant if slow.

## Triggers to act (check quarterly)
- Database size above 50% of the plan, or any table above 50M rows: partition or archive.
- p95 of the grid load above 2 seconds for a 2,000-initiative project, or a sync check above 60 seconds for one customer: queue and split the job.
- Database CPU above 60% for an hour on a normal weekday: raise compute, then look at the top queries.
- A customer asks for its own data location or database: offer the dedicated tier below.

## Dedicated database for a large customer (an enterprise tier, not built)
It is a good fit for data residency, "our own database" demands or a customer big enough to deserve its own capacity. It is not needed for performance until the shared project is genuinely full, and it has real costs:
- Supabase Auth is per project, so a person who belongs to workspaces in different projects, and our platform staff (docs/15), need a control layer: a small global directory (identity, workspace to database mapping, staff) and per-customer data databases ("cells").
- Migrations must run on every database in order (the migration files are forward-only and applied by `DATABASE_URL`, so this is scripting, not redesign).
- Backups, monitoring, secrets and costs multiply per database.

**Keep the option open cheaply:** all browser and server data access takes the workspace and goes through one place (the data sources and `createAdminClient`), so that a lookup of "which database for this workspace" can be added later; no table joins across workspaces; no feature that needs two workspaces in one query; keep migrations runnable against any database with `pnpm db:migrate`.

## Decision
Start with one shared project. Fix write amplification now (0027). Do the audit-log partitioning, sync-log pruning and the sync queue before the pilot grows beyond a handful of customers. Design the directory and cell split only when the first customer needs it or a trigger above fires. See `docs/DECISIONS.md` (2026-10-23).
