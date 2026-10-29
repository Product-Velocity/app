# Phased build plan

Rules: one phase at a time, **except that Phase 4 may run in parallel with Phase 3b and 3c (Ashu, 2026-10-24)**; each phase ends in a demo Ashu can click; all phases include tests, RLS tests, audit logging and accessibility checks. "Done" = every acceptance criterion passes.

## Phase 0 — Spikes and foundations (1–2 weeks)
Run spikes S1–S6 (`08`). Repo, CI, Supabase project, Vercel, environments, lint/typecheck/test, migration tooling, design tokens, auth (email/Google/GitHub, 2FA), tenant + membership + RLS harness with a two-tenant test fixture.
**Accept:** sign up, create tenant, invite member; RLS test suite proves a user in tenant A cannot read/write any tenant B row on every table; spike results written to `docs/08` with go/no-go; CI green.

## Phase 1 — Roadmap core (grid first)
Projects, items, teams (basic), portfolio scope, global stack rank (RLS pattern C from spike S7), grid with quick-add, inline edit, autosave + undo, keyboard nav, bulk bar (multi-select edit), paste-import from Excel with column mapping, saved views, audit log, ⌘K palette (basic).
Own undo stack from the change log, simple own row grouping for saved views (AG Grid Community has no row grouping; Ashu decides licence vs own, see `08` S1).
**Accept:** add an item in <10 s from keyboard only (name + Enter); `#project @person M should` tokens parse; edit any editable cell inline; ⌘Z undoes last 20 changes incl. bulk; select 3 rows → set MoSCoW in one action; paste 50 rows from Excel with mapping preview; locked (GitHub-driven) cells reject edits and bulk edits; 2,000-item project loads and edits feel instant (<200 ms optimistic); all writes audited.

## Phase 2 — Views and detail
Item peek panel + detail (J/K), Gantt (two-level grouping, drag to move, clamped bars), card view with swimlanes, leadership view (read-only), weekly update draft stub.
**Accept:** drag a Gantt bar updates dates with undo; swimlane regrouping works; leadership role cannot edit; views respect scopes.

## Phase 3 — GitHub sync (enterprise)
Spikes S3b/S4b/S5b first (issue-field writes, sub-issue limits, non-owner install; needs a sandbox repo and a second account). Optional organisation-owned Projects v2 link in R1 (reinstated, R-010; confirm in spike S2b first). GitHub App install with approval-pending state, tracking issues, sub-issues (epics/tasks), webhook ingestion (idempotent), status/assignee/progress inbound, outbound field allowlist test, conflict surfacing, breakdown routes (Traditional first; In between and Full Claude behind flags in Phase 5).
**Accept:** create item → "Push to GitHub" creates one tracking issue; closing sub-issues updates progress; non-allowlisted field never appears in payloads (automated test); replaying a webhook changes nothing; install by non-owner shows waiting state and completes on approval; a conflict shows highlight and log entry.

## Phase 3b — Atlassian (Jira, Bitbucket, Confluence), priority 2 after GitHub
Spec: `docs/16-ATLASSIAN.md` (update of 2026-10-29 wins; request 253). Order: **J0** spikes J1–J8; **J1** provider interface (#67); **J2** read-only connection and Test connection (#68); **J3** Jira map, field catalog, Incoming with ignore rules (#69, #76); **J4** level and field mapping per customer, pull in as Read only or PV takes ownership (#70); **J5** inbound sync (#72, read half); **J6** Sync with Jira, new items inside the sync dialog, Adopt, Writing x/y counter (#71, #72 write half; the counter and new-items-in-sync are built for GitHub first); **J7** Confluence publish (#74); **J8** scale (queue, paging); then Bitbucket (#73). Milestone 1 is J0 to J4 (read-only). Original list: Spikes J1–J6 first. Provider interface so a project links to GitHub or Jira (#67), Atlassian connection (#68), step 1: read-only Jira discovery, Jira map report and staging (#69), mapping and accept (#70), step 2: clean-up change-set, review and push (#71), two-way sync with outbound allowlist test (#72), Bitbucket status via Jira keys (#73), Confluence links (#74), choose what comes in: Incoming list, pull in / ignore (#76).
**Accept:** read-only connection writes nothing to Jira (tested); the Jira map shows counts by type, status category, epic and sprint; accepting staged items is repeatable and idempotent; nothing is pushed without a preview and confirmation; non-allowlisted field never appears in a Jira or Bitbucket payload (automated test); replaying a webhook changes nothing; a conflict shows highlight and log entry.


## Phase 3c — Flow, comments, notifications and onboarding (R1, added R-032)
How initiatives are pushed forward and how people are told. Move to next phase with required fields per stage (#101), time in phase and stalled detection from the audit log (#102), comments and @mentions (#103), notifications with a design note first (#104), My work and Needs attention (#105), onboarding and sample workspace (#106).
**Accept:** an initiative can be advanced with a list of what is missing; days in phase and Stalled show in words; a mention reaches the person; a new user reaches a first roadmap in under 15 minutes.

## Phase 4 — Specs, readiness and Claude connection
Spike S8b first: a minimal `/mcp` with one read-only tool connected from Claude. Item documents (link/MD, versions, statuses), Definition of Ready, Approver role and "Ready for build", epic/task proposal editor, MCP server (read/search, create drafts, documents, propose breakdown), AI intake with duplicate check, "via Claude" audit, Connect-Claude settings page.
**Accept:** only an Approver can mark Ready for build; Claude identity cannot (test); intake of a pasted email yields draft items flagged "AI draft" with duplicate hints; prompt-injection fixtures are ignored; MCP calls obey the caller's role; revoking a connection works.
Issues: S8b spike (#107), documents (#108), Definition of Ready and Approver (#109), proposal editor (#110), AI foundation (#111), MCP read (#112), MCP write (#113), AI intake (#114), ghost suggestions (#115), weekly update (#116).

## Phase 5 — Planning cycles, capacity and alignment (R1 core)
Teams/capacity setup, fit line and capacity planner, planning cycles with candidate pool and triage, alignment sessions (top-5/duels, 100 coins, ICE), segments and groups, magic-link participant flow (mobile), anonymous results, admin results, invitation drafting + confirmed send, breakdown routes 2 and 3.
**Accept:** capacity numbers match the worked example (Marketplace: 336 h × 0.8 × 0.5 = 134.4 h/week new work; Jan–Mar fit cumulative 50.5 of 69.4 pw); fit line is per team; coins normalisation unit tests match `02` incl. group <5 hidden; participant can't see names; a voter can't vote twice; invitations never send without confirmation; deleting a participant removes personal data but keeps aggregates.
Issues: teams (#117), effort (#118), fit line (#119), planner (#120), cycles (#121), cycle stats (#122), alignment setup (#123), invitations (#124), participant flow (#125), scoring and results (#126), results back into initiatives and rank (#127), participant privacy (#128).

## Phase 6 — Reports
Spike S6b first (PDF and Python document functions on a Vercel preview). Engine, audience profiles with server-side field filtering, snapshots, templates: Roadmap for sales, Pre-vote briefing, Monthly business review (PPTX/DOCX/XLSX/PDF), Claude narrative drafts, pre-flight checks.
**Accept:** customer-safe report contains none of the withheld fields (test across all fields); quarter-level dates for customer-safe; PDF from print view; generated files open in PowerPoint/Word/Excel; snapshot history retained.
Issues: engine and S6b (#129), templates (#130), narrative (#131), gallery and sending (#132), MVP hardening (#133).

**— Release 1 (MVP) ends with Phase 6 (#133). Pilot: one team, one quarter —**

## Phase 7 [R2] — Gates, velocity, outcomes
Decision gates (criteria engine, decisions, conditions, auto-pass, fast lane, gate pack), velocity insights and opportunities, outcomes/adoption tab with metric ingestion (manual/CSV/API/webhook), outcome reviews, learning loop into candidate pool. Remaining reports. Scheduled reports.
Issues: gates (#134, #135, #136), velocity insights (#137), opportunities (#138), outcome metrics (#139), outcomes tab and reviews (#140), learning loop (#141).

## Phase 8 [R2] — Alignment dimensions and customers
Why/What/How/When with states, sign-offs, stakeholder lists, decision log, customer concept review (mobile), customers as a segment.
Issues: Why/What/How/When (#142), sign-offs and decision log (#143), customer concept review (#144), customers as a segment (#145).

## Phase 9 [R2] — Enterprise and agents
SAML SSO, audit export, GitLab, engineers split across teams, **AI agents as capacity**, coding-agent hand-off, token packs and billing (Stripe), usage metering UI.
Issues: SSO and audit export (#146), GitLab spikes (#147) and provider (#148), engineers across teams (#149), agent capacity (#150), coding-agent hand-off (#151), billing (#152), usage UI (#153), Slack (#154), scheduled reports (#155), more voting methods (#156).

## Always
Billing (Stripe) can be stubbed until Phase 6 pilot ends; pricing in `09` is a draft.
