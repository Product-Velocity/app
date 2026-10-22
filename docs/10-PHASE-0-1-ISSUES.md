# Phase 0 and 1 issues (drafts)

GitHub issue creation was not permitted when these were drafted. Create one GitHub issue per item below using `.github/ISSUE_TEMPLATE/work-item.md`, labels `work-item` and `phase-0` or `phase-1`, then use `/work-issue <number>`. Acceptance criteria come from `docs/06-BUILD-PLAN.md`.

## Phase 0
1. **Repo skeleton, CI and tooling** — Next.js + TypeScript on Vercel; `pnpm dev/test/lint/typecheck` work and are written into CLAUDE.md; GitHub Actions on every PR; Vercel previews; env vars documented, no secrets committed; design tokens from `docs/07` (IBM Plex, blue #3347D9, 13px base).
2. **Supabase setup, migrations and two-tenant RLS harness** — forward-only migrations; `pnpm db:migrate` and `pnpm db:test`; tables tenants, tenant_members (roles + is_approver), audit_log with RLS; a user in tenant A cannot read or write any tenant B row, tested for every table; service-role key only server-side.
3. **Auth** — email, Google, GitHub sign-in; optional 2FA; create tenant; invite member with role; Approver is a separate flag; RLS tests and audit for new tables. SAML is Phase 9.
4. **Run spikes S1–S8** — record result, evidence and go/no-go in `docs/08`; update affected docs and `docs/DECISIONS.md`; raise anything that changes scope. Needs a GitHub test organisation, Vercel and Supabase access.

## Phase 1
5. **Projects, items, global stack rank and audit log** — tables with RLS and two-tenant tests; stack_rank unique per cycle and scope, re-rank in one transaction with audit rows; GitHub-driven fields exist but are not user-writable; every write audited with actor and source.
6. **Portfolio grid with inline edit, autosave and undo** (depends on S1) — 2,000 items load, edits <200 ms optimistic; typed pickers, plain-language dates; locked cells reject edits; "All changes saved" status, ⌘Z undoes last 20 changes, no staged Save bar; keyboard navigation; text labels, not colour alone. Reference: prototype board 20.
7. **Quick-add row** — name only required, Enter creates; tokens `#project @person M should`; context inherited from view; paste a list adds many; similar-item hint; audited.
8. **Multi-select bulk bar and paste-import from Excel** — select 3 rows and set a field in one undoable action; GitHub-driven fields rejected with a clear message; paste 50 rows with column-mapping preview; buttons "Update GitHub" (Phase 3) and "Export selection to file". Reference: prototype board 1.
9. **Saved views, scope switcher and basic ⌘K palette** — "All projects" plus saved named scopes; views store filters, grouping, columns; ⌘K lists core actions; RLS tests for new tables.

## Phase 2 and 3 issues (created 2026-10-22)
Phase 2: #26 item peek panel and detail page, #27 Gantt, #28 card view, #29 leadership view and weekly update stub. Phase 3: #30 sandbox spikes S3b/S4b/S5b, #31 App install and connection settings, #32 webhook ingestion, #33 push to GitHub with the outbound allowlist test, #34 epics and tasks with the Traditional breakdown route, #35 inbound sync, #36 conflicts and sync log.

Audit 2026-10-22: #26–#36 amended against the field dictionary and the workbook sheets. Added: #38 Initiative Group open list, #39 default views and Columns picker, #40 suggestions engine, #41 optional outbound mappings.

Accounts and staff (2026-10-23): #44 account page, #45 invitation emails, #46 platform staff foundation, #47 workspace settings, #48 admin console, #49 impersonation, #50 access grants. Spec: `docs/15`.
