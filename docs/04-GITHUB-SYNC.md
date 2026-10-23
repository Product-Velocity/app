# GitHub sync specification

## Principles
GitHub App ("Product Velocity" bot); all writes are made by the app with an "on behalf of <user>" line in the body; Claude never writes to GitHub directly. Enterprise GitHub (Cloud) first; GitLab later behind the same interface (`packages/github` exposes a `SourceControl` interface).
Idempotent, retry-safe, webhook-driven with periodic reconciliation. Commercial fields **never** leave the app.

## Hierarchy mapping
Initiative → **tracking issue** in the project's default repo. Epics and tasks → **sub-issues** (epic issue with task sub-issues). Dates and simple metadata go through **issue fields** (Start date, Target date), which are available on Free, Team and Enterprise organisations (spike S3). **A Projects v2 link is part of R1 (reinstated 2026-10-22, R-010), as an optional per-connection setting:** one organisation-owned Project per connection; tracking issues and their sub-issues are added as items; the project date fields "Start date" / "Target date" are written from Planned Start / G2M Date (est) so the product roadmap shows in GitHub's Roadmap layout; Project Status, Iteration and Target date are read back (read-only). GitHub Apps can only reach **organisation-owned** projects (spike S2): user-owned projects are not supported and the setting says so. Everything works without a project; issue fields remain the fallback for dates. S2b confirmed hands-on 2026-10-23 (`docs/08`): the App reads private organisation projects, adds items, creates the two DATE fields itself and writes and reads back values; reads right after a write can lag. Hierarchy limits (spike S4b): 8 levels (parent plus 7 layers), tested; 100 sub-issues per parent documented; we use 3. Epic is not an issue type on Free organisations: use a label unless an admin creates the type.

## Field mapping
| App | GitHub | Direction |
|---|---|---|
| title, summary (technical part), acceptance criteria | issue title/body (templated block between markers) | app → GH; edits in the marker block are overwritten, outside are preserved |
| status | issue state / project status | GH → app (read-only in app) |
| assignees | assignees | both |
| delivery progress | closed ÷ total sub-issues | GH → app |
| PRs, CI, releases | linked PRs, checks, release tags | GH → app |
| start/end dates | issue fields "Start date" and "Target date" (organisation fields) | both, optional; only these allowlisted fields are ever written |
| value, confidence, customers, decisions, rationale, outcomes, key results | — | **never synced** |

Add an automated test that serialises every outbound payload and fails if a non-allowlisted field name or value appears.

## Install and approval flow
Non-owner installers trigger GitHub's request-approval flow; the app shows "waiting for approval" (board 6) and polls installation events. Do not claim the app is connected until the installation webhook arrives.

## Breakdown routes
Field `breakdown_route` + `breakdown_status`.
1. **Traditional**: product pushes the initiative (tracking issue). Status "Awaiting engineering". Engineers create epics/tasks in GitHub. When engineering marks the breakdown Complete (label or app button), status = Complete. Sub-issues added before Complete count as planned scope; after Complete they are "Scope added". Delivery progress is provisional until Complete. Engineers' estimates and skills roll up into effort by skill.
2. **In between**: Claude drafts epics/tasks; engineering edits and accepts in the app; on accept the app creates the issues.
3. **Full Claude**: Claude proposes, an Approver signs off, the app creates the issues on confirmation.
Project setting "Who breaks down the work": Product team in app / Engineering in GitHub / Either (per item).
Each work item records `created_by` (app / claude / engineer).

## Events
Handle: `issues` (opened/edited/closed/reopened/assigned/labeled/transferred/deleted), `sub_issues`, `pull_request`, `check_suite/check_run`, `release`, `installation`, `installation_repositories`. (`projects_v2_item` is handled when a project is linked; confirm coverage in spike S2b.) Store each delivery in `sync_events` with `X-GitHub-Delivery` as the idempotency key; process via queue; verify signature; ack fast.

## Conflict handling
Last-writer-wins per field except marker-block content (app wins). If both sides changed the same synced field since `last_synced_at`, write a `sync_conflicts` row and highlight it in the grid; never silently drop. Deleted/transferred issues unlink and flag the item. Rate limits: honour `Retry-After`, use conditional requests (ETag), batch with GraphQL where useful.

## Spike results (see `08`)
- **S2** Projects v2 dropped from R1 (Apps reach organisation-owned projects only). **S3** issue fields work on Free organisations; dates map to them. **S4** 100 sub-issues per parent, 8 levels, REST endpoints exist; use REST for writes (`POST .../sub_issues` takes the numeric issue **id**), GraphQL for batched reads. **S5** proposed minimum App permissions: repository Issues (read/write), Pull requests (read), Checks (read), Metadata (read); organisation Issue fields (read/write); no Contents, Projects or Members. Events: `issues`, `sub_issues`, `pull_request`, `check_run`, `check_suite`, `release`, `installation`, `installation_repositories`.
- Still to confirm hands-on: writing issue-field values as an App (the issue-field permission is not yet identified) and the non-owner install request. **Least privilege for the real App:** the sandbox App also holds `actions`, `artifact_metadata`, `deployments`, `statuses` and `pull_requests`; the real one takes only what this document lists plus organisation Projects (read/write) and Issue types (read), and an owner must accept every later permission change.
