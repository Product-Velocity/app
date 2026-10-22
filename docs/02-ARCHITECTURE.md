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
| Hosting | Vercel | No LibreOffice; PDF = HTML print view rendered by headless Chromium job or browser print. Verify (spike S6). |
| Auth | Supabase Auth: email, Google, GitHub; 2FA | SAML later via Supabase SSO (Pro/Enterprise) — verify plan. |
| Tenancy | `tenant_id` on every row; RLS policies via `tenant_members` | Use `auth.jwt()` claims or a membership lookup function; never trust client-sent tenant_id. |
| Roles | `tenant_members.role` + `is_approver` flag + project-level membership | Leadership viewer = portfolio read role. |
| Grid | AG Grid Community, client-side | Load whole project (target ≤2,000 rows). Custom cell editors. |
| Realtime | Supabase Realtime on item rows for the open project | Conflict highlighting: last-write-wins per field with version column; show "changed by X". |
| Jobs | Queue table + worker (Vercel Cron / Supabase Edge Function / external Python worker) | Reports, webhooks processing, AI tasks. Pick in spike S6; keep behind an interface. |
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
- **Delivery progress**: closed ÷ total sub-issues. Provisional until breakdown status = Complete; sub-issues added before Complete = planned scope, after = "Scope added".

## Security
RLS on all tables; service-role key only in server jobs, never in the browser; MCP and API enforce the same permission layer as the UI (shared policy functions); GitHub tokens (installation) stored encrypted; webhook signatures verified; rate limits on public/participant endpoints; magic links single-use, expiring; all participant data deletable.
