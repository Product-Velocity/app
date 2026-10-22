# GitHub sync specification

## Principles
GitHub App ("Product Velocity" bot); all writes are made by the app with an "on behalf of <user>" line in the body; Claude never writes to GitHub directly. Enterprise GitHub (Cloud) first; GitLab later behind the same interface (`packages/github` exposes a `SourceControl` interface).
Idempotent, retry-safe, webhook-driven with periodic reconciliation. Commercial fields **never** leave the app.

## Hierarchy mapping
Initiative → **tracking issue** in the project's default repo. Epics and tasks → **sub-issues** (epic issue with task sub-issues). Optional org-owned **Projects v2** mirror for dates/fields/board views. Issue fields and dependencies: later (spike S3).

## Field mapping
| App | GitHub | Direction |
|---|---|---|
| title, summary (technical part), acceptance criteria | issue title/body (templated block between markers) | app → GH; edits in the marker block are overwritten, outside are preserved |
| status | issue state / project status | GH → app (read-only in app) |
| assignees | assignees | both |
| delivery progress | closed ÷ total sub-issues | GH → app |
| PRs, CI, releases | linked PRs, checks, release tags | GH → app |
| start/end dates | Projects v2 date fields (org projects only) | both, optional |
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
Handle: `issues` (opened/edited/closed/reopened/assigned/labeled/transferred/deleted), `sub_issues`, `pull_request`, `check_suite/check_run`, `release`, `installation`, `installation_repositories`, `projects_v2_item` (spike S2). Store each delivery in `sync_events` with `X-GitHub-Delivery` as the idempotency key; process via queue; verify signature; ack fast.

## Conflict handling
Last-writer-wins per field except marker-block content (app wins). If both sides changed the same synced field since `last_synced_at`, write a `sync_conflicts` row and highlight it in the grid; never silently drop. Deleted/transferred issues unlink and flag the item. Rate limits: honour `Retry-After`, use conditional requests (ETag), batch with GraphQL where useful.

## Spikes before building (see `08`)
S2 user-owned Projects v2 access and project webhooks; S3 issue-field availability on Enterprise Cloud; S4 sub-issue API limits (depth, count) and GraphQL vs REST; S5 App permissions minimum set.
