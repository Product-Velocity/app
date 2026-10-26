# Architecture

## Overview
```
Browser (Next.js, AG Grid)  ──►  Next.js route handlers / server actions (Vercel)
                                    │            │             │
                                    ▼            ▼             ▼
                            Supabase Postgres  GitHub App    Job runner (Python)
                            (RLS, auth)        webhooks +    reports, AI tasks
                                               REST/GraphQL
Claude (remote MCP client) ──►  /mcp endpoint (acts as signed-in user)
```

## Decisions
| Area | Decision | Notes |
|---|---|---|
| Hosting | Vercel (Pro before the pilot) | No LibreOffice; PDF = HTML print view rendered with `puppeteer-core` + `@sparticuz/chromium-min`. Spike S6: functions run 300 s by default, 800 s max on Pro; cron on Hobby is once a day, per-minute on Pro. Python document libraries on Vercel not yet verified (S6b before Phase 6). |
| Auth | Supabase Auth: email, Google, GitHub; 2FA | SAML for projects needs the **Pro plan or above**, $0.015 per SSO monthly active user over quota; one identity provider per customer through the CLI; SSO accounts are never linked to a password or Google account with the same email (spike S7). |
| Tenancy | `tenant_id` on every row; RLS policies via `tenant_members` | Never trust client-sent tenant_id. **Policy pattern (spike S7):** `tenant_id = any(array(select public.my_tenant_ids()))` (a definer function evaluated once per query), an index starting with `tenant_id`, and a `tenant_id` filter in every query. The per-row helper `is_tenant_member(tenant_id)` took 10 to 14 s on an unfiltered 1M-row table; the hoisted pattern takes under 1 ms (6 ms for a user in 25 tenants). The helper stays only on small tables. |
| Roles | `tenant_members.role` + `is_approver` flag + project-level membership | Leadership viewer = portfolio read role. |
| Grid | AG Grid Community (MIT), client-side | Load whole project (target ≤2,000 rows). **Spike S1:** 2,000 rows ready in about 0.6 s, inline edits about 45 ms. Community lacks range selection, fill handle, clipboard, Excel export, rich select and **row grouping** (all Enterprise). We build our own: undo stack (from the change log; the built-in one does not track API bulk edits), paste-import, typed pickers (custom editors via `useGridCellEditor`) and, for saved views, simple grouping. |
| Realtime | Supabase Realtime on item rows for the open project | Conflict highlighting: last-write-wins per field with version column; show "changed by X". Limits are per project, shared by all tenants: 200 / 500 / 10,000 concurrent connections on Free / Pro / Team (spike S7). |
| Jobs | Queue table in Postgres, processed by Vercel Cron (every minute on Pro); webhook routes acknowledge fast and enqueue | Reports, webhook processing, AI tasks. Keep behind an interface; revisit if jobs exceed 800 s (spike S6). |
| AI | Anthropic API server-side for intake, drafts, insights; MCP server for external Claude | Per-tenant usage metering from day one (needed for token packs). |
| GitHub | GitHub App, installation per tenant/org; webhooks → queue → idempotent handlers | See `04`. |
| Files | Supabase Storage for MD docs, screenshots, report outputs | Signed URLs; tenant-prefixed paths; virus scan LATER. |
| Observability | Structured logs without PII/tokens; error tracking; audit table is product data, not logs | |

## Module layout (suggested)
```
apps/web            Next.js app (UI + API routes)
packages/db         migrations, RLS tests, generated types
packages/domain     pure business logic: rank, fit line, capacity math, normalisation, gate criteria
packages/github     GitHub App client, mapping, sync engine
packages/mcp        MCP server tools
packages/reports    templates, audience profiles, renderers
services/worker     Python jobs (pptx/docx/xlsx), optional
```
Keep `domain` free of I/O so the maths (coins normalisation, fit line, capacity) is unit-tested exhaustively.

## Key algorithms (specify in code + tests)
- **Capacity**: team new-work hours/week = Σ member hours × team time-split new-work share × focus factor (member split across teams [R2]). Person-weeks = hours / 40 unless team defines week length. Per-skill supply from members' skill split.
- **Fit line**: walk items in global rank; subtract each item's effort-by-skill from each needed team's remaining supply for the window; the first item that overdraws any required team is below the line for that team (store per-team fit state: fits / tight (<10% left) / over). Item is above the global line only if all needed teams fit.
- **100 coins**: per person ≤30 per item, total 100. Group score_i = mean coins on i across group voters; normalise so group's max = 100. Joint = weighted mean of group scores (equal by default, or headcount), rescaled so max = 100. Groups with <5 voters are hidden from participants and excluded from per-group display (still counted in joint unless admin excludes).
- **Worked example (100 coins, tested in `packages/domain/src/alignment-scoring.test.ts`)**: items X, Y, Z. Sales (5 voters) gives every voter 30/20/10, Engineering (5) 10/30/30, Support (4) 0/0/30. Group scores (top = 100): Sales 100/66.7/33.3, Engineering 33.3/100/100, Support 0/0/100. Equal weights: mean 44.4/55.6/77.8, scaled to 100: X 57.1, Y 71.4, Z 100. Headcount weights (5, 5, 4): X 62.5, Y 78.1, Z 100. Support has 4 voters, so no group is shown (only the joint result), though the joint still counts it. With 5 Support voters all three groups are shown. Top 5 with duels: place k of n picks is worth n-k+1 points, not picked 0. ICE: impact x confidence x ease. Equal scores share a place (1, 2, 2, 4) and are shown as tied. Contested: two shown groups whose scores for an item are 40 or more apart.
- **Delivery progress**: closed ÷ total sub-issues. Provisional until breakdown status = Complete; sub-issues added before Complete = planned scope, after = "Scope added".

## Security
RLS on all tables; service-role key only in server jobs, never in the browser; MCP and API enforce the same permission layer as the UI (shared policy functions); GitHub tokens (installation) stored encrypted; webhook signatures verified; rate limits on public/participant endpoints; magic links single-use, expiring; all participant data deletable.
