# Decision log

Append new decisions at the bottom: date, decision, reason, who decided.

- 2026-10-21 · Portfolio is a scope, not a container; one global stack rank per cycle · Ashu
- 2026-10-21 · Alignment methods R1: top-5 + duels, 100 coins (normalised per group), ICE · Ashu
- 2026-10-21 · Lenses / agreement rings rejected · Ashu
- 2026-10-21 · Claude drafts invitations; user confirms every send · Ashu
- 2026-10-21 · Three breakdown routes: Traditional, In between, Full Claude · Ashu
- 2026-10-21 · Separate Approver permission; Claude can never hold it · Ashu
- 2026-10-21 · Autosave with undo is the default editing mode · Ashu/Claude
- 2026-10-21 · GitHub App, enterprise first; GitLab next · Ashu
- 2026-10-21 · Stack: Next.js/TS on Vercel, Python for jobs, Supabase Auth + Postgres with RLS · Ashu
- 2026-10-21 · Pricing recorded in `09` as working plan
- 2026-10-21 · First pitch audience: enterprise buyers · Ashu
- 2026-10-21 · Seats: only Creator/Admin/Approver billable; draft prices Team €18 / Business €36 / Enterprise custom confirmed as working plan · Ashu
- 2026-10-21 · No legal review needed for now; prototype sharing by link accepted (fictional data) · Ashu
- 2026-10-21 · Autosave with undo is the only editing mode; no staged Save bar · Ashu
- 2026-10-22 · Repo is a pnpm workspace with `apps/web` only for now; `packages/*` (db, domain, …) are added by the issues that need them · Claude (issue #1)
- 2026-10-22 · Fonts self-hosted via `@fontsource` (IBM Plex Sans/Mono, OFL licence, no cost) rather than Google Fonts at runtime · Claude (issue #1)
- 2026-10-22 · Pinned TypeScript 5.x and ESLint 9.x (Next's lint config targets them); Vitest for tests · Claude (issue #1)
- 2026-10-22 · RLS tests run on plain Postgres 16 with a small Supabase shim (CI service container) instead of the Supabase CLI/Docker; policies are also applied to a real Supabase project before merge to Production · Claude (issue #2)
- 2026-10-22 · Plain SQL migrations with our own tiny forward-only runner (checksum guard) rather than a migration framework; compatible with applying through Supabase · Claude (issue #2)
- 2026-10-22 · Dependencies added: `pg` (tests/migrations), `@supabase/supabase-js`, `server-only` (all MIT, free) · Claude (issue #2)
- 2026-10-22 · Tenants are created only via `create_tenant()`; `audit_log` is append-only for everyone including the service role; Claude-sourced writes cannot grant Approver · Claude (issue #2)
