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
Built in #31 (`/settings/integrations/github`, code in `packages/github` and `apps/web/src/lib/github`).
1. An admin (a person, never a service account or Claude) types the GitHub organisation name. The app stores a `github_connections` row in state **requested** and sends the admin to `https://github.com/apps/<slug>/installations/new` with a signed, one-hour `state` (workspace, admin, connection).
2. GitHub returns the browser to the App's **Setup URL**, `/api/github/setup`. The route checks the state, that the signed-in user is that admin, and (for an install) asks GitHub that the installation exists and belongs to the organisation that was entered. It records the installation id and sets **installing**. A non-owner gets `setup_action=request` with no installation id: state **waiting approval**.
3. Only GitHub's `installation` webhook (`created`, or `unsuspend` / `new_permissions_accepted`) at `/api/github/webhook` sets **connected**, then the repositories are read and Epic availability recorded. The app never claims to be connected before that. `installation deleted` disconnects; `suspend` suspends; `installation_repositories` re-reads the repositories (GitHub is the source of truth, a delivery is never trusted for the list).
4. The webhook finds its connection by installation id, or, if the install-return step never happened, by the one open connection waiting for that organisation. Two workspaces waiting for the same organisation are not guessed: the install-return step binds those. One installation belongs to one workspace (unique index).
5. **Disconnect** (`github_disconnect`) ends or cancels the connection, marks repositories removed and clears project default repositories. It does not uninstall the App on GitHub: that is the organisation owner's choice. Starting again creates a new connection.
Repositories that leave the installation are marked removed and clear any project default that pointed at them (linked items are flagged once items sync, #33 onwards). A project's default repository can only be set to an active repository of the workspace's connection (database trigger).
Tokens: installation tokens are created per installation, kept in server memory until a minute before they expire, never logged and never sent to a browser. The App private key and webhook secret are environment variables only; the webhook secret also signs the install state.
Not built in #31: user mapping (app users to GitHub logins, with #35 assignees), linking a Projects v2 board (#42), delivery storage with idempotency keys (#32; handlers are idempotent upserts until then).

### Setting up the GitHub App (one-time, by the App owner on GitHub)
- Webhook: Active, URL `https://<app domain>/api/github/webhook`, secret equal to `GITHUB_APP_WEBHOOK_SECRET`.
- **Setup URL**: `https://<app domain>/api/github/setup`, and tick "Redirect on update".
- Permissions and events: see the spike results below (Issues read/write, Metadata read; later slices add Pull requests, Checks, Issue types, organisation Projects). An organisation owner must accept every permission change on the installation page.
- The sandbox App used for the spikes is `product-velocity-sandbox` on `Product-Velocity` (Free plan). Create a separate App for real customers (docs/14).

## Pushing an initiative (built in #33, release 0.10.0)
- **Where:** "Update GitHub…" in the bulk bar (up to 25 selected items) and in the item panel. It is enabled for creators and admins when the workspace is connected. Nothing is written before the person has seen the preview and pressed "Send".
- **What is written:** one tracking issue per initiative in the project's default repository (a linked item keeps its original repository). Title `R-12: Name`. The body is one **managed block** between `<!-- pv:begin item=<id> -->` and `<!-- pv:end -->`: Summary, Hypothesis, Artifacts (links) and a link back. Labels `product-velocity` and `pv:project/<project>` are created when missing and only ever **added** (a push never removes labels people added). Text outside the block is never touched; edits inside it are overwritten on the next push that changes something.
- **The allowlist:** the only item fields read for a GitHub payload are `item_code`, `initiative_name`, `summary`, `hypothesis` (plus the item's artifact links). Value, confidence, customers, decisions, rationale, key results, outcomes and markets are never read. `apps/web/src/lib/github/outbound-allowlist.test.ts` fills all 165 dictionary fields with sentinels, pushes through a fake GitHub, and fails if any non-allowlisted sentinel appears or any non-allowlisted field is read. User text is sanitised (our markers and @mentions are neutralised, links must be plain https).
- **Idempotent:** the link row (`item_github_links`, one per item) stores the issue and a hash of what was last sent: an unchanged item sends nothing. A create whose answer was lost is found again by the marker in the body instead of being created twice. If the linked issue was deleted or moved, nothing is recreated: the item shows an error and a person decides.
- **On behalf of:** the person who confirmed is recorded as the actor in the audit log (source UI) through `github_record_push()`, which only the server can call. The GitHub issue itself says it is managed by Product Velocity and does not name the person (the repository may be public and users have no GitHub login mapping until #35).
- **Failures:** a GitHub error shows a short message (never the response body or a token), is stored on the link and leaves the item unchanged; one item failing does not stop the others.
- **Not yet:** dates (issue fields need a permission the sandbox App lacks, and Projects v2 is #42), assignees (#35), optional pushes (#41), epics and tasks (#34), and detecting that someone edited inside the block (comes with inbound sync, #32).

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
