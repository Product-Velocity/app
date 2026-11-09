# Spikes and open questions

## Spikes (Phase 0): results
Evidence levels: **Tested** = measured or called for real here, with a reproducible file in `spikes/` or a recorded API call. **Documented** = taken from official vendor documentation or changelogs (found through web or docs search because most vendor docs sites are not reachable from the build environment), not tested. **Needs Ashu** = cannot be checked without access only Ashu has. Run 2026-10-22, GitHub plan: **Free**, Vercel plan: not confirmed (assumed Hobby).

| ID | Question | Result | Go / no-go | Evidence |
|---|---|---|---|---|
| S1 | AG Grid Community: gaps, editors, locked cells, 2,000 rows | Community covers editing, custom pickers, locked cells, selection, CSV export and is fast; range selection, fill handle, cell copy/paste, Excel export, rich select, **row grouping** and context menu are Enterprise-only | **GO** with Community; own undo stack, own paste-import, **own grouping (raise with Ashu)** | Tested (`spikes/s1-ag-grid`) |
| S2 | GitHub Projects v2 via the App; project webhooks | GitHub Apps reach **organisation-owned** projects only (Organization "Projects" permission); user-owned projects need a user token | **Reinstated 2026-10-22 (R-010)**: optional org-owned Projects v2 link in R1, confirmed hands-on in S2b; issue fields (S3) stay the fallback for dates | Documented (secondhand), Needs Ashu to confirm with a real App |
| S3 | Issue fields availability and API | **Available on GitHub Free organisations** (generally available since 2026-07-02). Your org already has Priority, Start date, Target date, Effort | **GO**: map start/end to the Start date / Target date issue fields | Tested (API call) + Documented |
| S4 | Sub-issue limits and best API | 100 sub-issues per parent, 8 levels of nesting; REST endpoints exist | **GO**: our 3 levels fit easily; use REST for writes, GraphQL for batched reads | Documented; limits not tested (no sandbox repo) |
| S5 | Minimum App permissions; install approval for non-owners | Members can request an install, owners are emailed and may change the repositories; the App is "connected" only when the installation event arrives | **GO (conditional)**: permission set below is a proposal | Documented; Needs Ashu (create an App, second account) |
| S6 | Vercel: long jobs, cron, PDF, Python, queue | Fluid compute: 300 s default, 800 s max on Pro (300 s max on Hobby); cron on Hobby is once a day, 40 jobs per project and per-minute on Pro; PDF from an HTML print view with `puppeteer-core` + `@sparticuz/chromium-min` is Vercel's documented route; Python document libraries on Vercel **not verified** | **GO with conditions**: Pro plan before the pilot; hands-on check S6b before building reports | Documented; Needs Ashu |
| S7 | Supabase: SAML plan, Realtime limits, RLS performance | Policy pattern matters hugely (see below); SAML for projects needs Pro or above; Realtime limits are per project, not per tenant | **GO with change**: all new policies use the hoisted pattern | Tested (`spikes/s7-rls-perf`) + Documented (Supabase docs) |
| S8 | MCP remote server auth with Claude; tool limits | Supabase Auth has an OAuth 2.1 server (beta) with PKCE, optional dynamic client registration and a consent screen we build; Claude custom connectors support OAuth with dynamic client registration; tool schema limits not found | **GO (conditional)**: depends on a beta feature; real connection test S8b at the start of Phase 4 | Documented; Needs Ashu |

### S1 AG Grid Community: details
Setup: AG Grid 36.2.0, React, production build, 14 columns, headless Chromium in the build sandbox (software rendering, so frame times are pessimistic). Reproduce: `spikes/s1-ag-grid/README.md`.
- **Licence:** `ag-grid-community` is MIT, `ag-grid-enterprise` is "Commercial" (package.json). Enterprise price not checked.
- **Load:** 2,000 rows ready in 0.55 to 0.70 s including the page load; 10,000 rows 0.56 to 0.74 s (rows are virtualised).
- **Inline edit latency** (Enter pressed until the new value is committed and painted), 30 edits across text, number and a custom picker editor: median 42 ms, 95th percentile 47 to 69 ms. Target was under 200 ms.
- **Locked cells:** `editable: false` (or a function) on the GitHub-driven columns: the editor never opens and the value is unchanged.
- **Bulk edit:** setting a field on 3 selected rows through the API took 18 ms.
- **Undo:** the built-in undo/redo (Community) only tracks edits made through cell editors, with a configurable limit (we set 20). A bulk edit made through the API was **not** undone by it. So undo must be our own stack built from the change log (also what rule 5 says); the built-in one is not used.
- **Scrolling:** at 120 px per frame the median frame was 33 ms (the headless browser caps near 30 fps) with 1 to 6 of 120 frames over 50 ms; extreme 600 px jumps dropped many frames in this software-rendered browser. Not measured on real hardware with a GPU.
- **Enterprise-only (checked in the two packages' module lists, and in the browser):** cell/range selection and the fill handle (0 selected cells after a drag, 0 fill handles), clipboard (Ctrl+C copied nothing), Excel export, rich select editor, row grouping, tree data, pivot, master/detail, context menu, side bar, status bar, set filter, multi filter, advanced filter and the batch-edit API (error #200). **Community has:** CSV export, undo/redo for editor edits, custom editors, select/number/text/date editors, row selection, pinned rows, row drag, keyboard navigation, text/number/date filters, quick filter.
- **Implementation notes:** custom React editors must use `useGridCellEditor` with `value` / `onValueChange` (the older ref and `getValue` style did not commit edits); date columns need the date editor module registered.
- **What this means:** (1) multi-row bulk edit and our own paste-import replace fill handle and clipboard, as already planned; (2) typed pickers are our own components; (3) **saved views with grouping need row grouping, which is Enterprise-only**. Options: build simple grouping ourselves (group header rows, our own collapse state; recommended for Phase 1), or buy Enterprise licences. Raised with Ashu.

### S2, S3, S4, S5 GitHub
- **S2 (documented, secondhand; GitHub's own docs were not reachable):** an installation token can use organisation-owned Projects v2 with the Organization "Projects" permission; user-owned projects need a classic token with the `project` scope, which the App model does not use; there are reports that Apps cannot read items in private projects. The `projects_v2_item` webhook is described as organisation-level. **Decision (changed 2026-10-22, Ashu, R-010):** Projects v2 is back in R1 as an optional link to one organisation-owned Project per connection. Spike S2b (sandbox org, second account) must confirm: item read/write with the Organization Projects permission, private-project access, and `projects_v2_item` webhook coverage. If S2b fails, the link is hidden and `gh_project_status` / `gh_iteration` show "arrives later".
- **S3 (tested):** `list_issue_fields` on the Product-Velocity organisation (GitHub Free) returned four organisation fields, all `ORG_ONLY`: Priority (single select: Urgent, High, Medium, Low), Start date (date), Target date (date), Effort (single select: High, Medium, Low). GitHub's changelog of 2026-07-02 says issue fields are generally available on Free, Team, Enterprise and Enterprise Cloud with data residency; the REST endpoint is `GET /orgs/{org}/issue-fields` and setting values needs "Issues" write on a fine-grained token. **Decision:** start and end dates map to the Start date and Target date issue fields. Commercial fields still never sync, and only allowlisted field names may be written. Not verified: writing field values as a GitHub App; `list_issue_types` returned 403 for the test integration, so issue types were not checked.
- **S4 (documented, from GitHub's docs via search):** up to 100 sub-issues per parent and 8 levels of nesting (raised from 50 in December 2024). REST endpoints: list `GET /repos/{owner}/{repo}/issues/{n}/sub_issues`, parent lookup `GET …/parent`, add `POST …/sub_issues` with the numeric issue **id** (not the issue number), `replace_parent: true` to move. Our hierarchy (tracking issue, epics, tasks) is 3 levels; epics per initiative and tasks per epic stay far under 100. **Decision:** REST for writes, GraphQL for batched reads. Not tested; to be checked in a sandbox repository at the start of Phase 3 (Ashu may create it).
- **S5 (documented):** organisation members can request a GitHub App install, the owner is emailed and can change the selected repositories; requesting is not possible from the Marketplace. We show "waiting for approval" until the `installation` event arrives. **Proposed minimum permissions:** repository Issues (read/write), Pull requests (read), Checks (read), Metadata (read, mandatory); organisation Issue fields (read/write, for dates); no Contents, no Projects, no Members. **Proposed events:** `issues`, `sub_issues`, `pull_request`, `check_run`, `check_suite`, `release`, `installation`, `installation_repositories`. To confirm by creating the App and installing it from a non-owner account (Needs Ashu, Phase 3).

### Hands-on results in the sandbox (2026-10-23; org `Product-Velocity` on the **Free** plan; App `product-velocity-sandbox`; repo `Test-Repo-01`; Ashu ran the harness at `/spikes/github`)
- **S2b (tested, GO):** the installation token reads a **private** organisation Project (project "Spike Project" found, `public: false`) with the Organization "Projects" permission; adds issues as items; creates DATE fields ("Start date", "Target date" do not exist by default, the App creates them); writes values; reads them back (first read after the write sometimes returns no items, a retry a moment later works, so the sync must tolerate that). Webhooks: `projects_v2_item` `created` and `edited` arrive at the App's webhook URL (App level, for an organisation project); the `projects_v2` and `projects_v2_status_update` events are subscribed but not yet seen. A new item (#3) appeared in the project without the App adding it; either a manual add or the project's built-in auto-add workflow (unconfirmed). Open: private-project item read is fine for items the App can see; not yet tested with items from repos the App is not installed on.
- **S3b (tested partly, open):** `GET /orgs/{org}/issue-fields` and the GraphQL `organization.issueFields` return 403 "Resource not accessible by integration": the App lacks a permission for org issue fields (not yet identified; the next run records the permission GitHub names). `GET .../issues/{n}/issue-field-values` returns 200 with an empty list and issues carry `issue_field_values`, so the feature exists. Writing values is not yet attempted. Projects v2 date fields (S2b) already cover Start and Target date, so issue fields remain a fallback.
- **S4b (tested, GO):** `POST /repos/{o}/{r}/issues/{number}/sub_issues` with `{"sub_issue_id": <numeric id>}` works as the App. Nesting: **8 levels linked (a top-level parent plus 7 layers of sub-issues)**; GitHub refused the next one with 422 "You can't add more than 7 layers of sub-issues". `sub_issues_summary` counts direct children only. The 100-per-parent limit is not tested (documented only).
- **Issue types (tested):** the org has Task, Bug and Feature; **no Epic** on this Free org (needs the "Issue types" read permission). Epic therefore uses a label unless an admin creates the type.
- **S3b follow-up:** GitHub names the missing permission as `issue_fields=read` (organisation permission "Issue fields"); add it to the App, accept it on the installation, re-run `/spikes/github`.
- **S5b (paused, documented but untested here):** adding permissions to an installed App needs an owner to accept them on the installation page; the acceptance sends `installation` / `new_permissions_accepted`. The non-owner install request (as `dev-nbm`) is still to do.
- **App permissions seen:** the sandbox App has more than needed (`actions`, `artifact_metadata`, `deployments`, `statuses`, `pull_requests`); the real App should use least privilege (see `docs/04`).

### Atlassian J1 and J2 (issues #257, #69): results of 2026-11-02
Run by Ashu on a free Jira Cloud site (two team-managed projects: one software, one Jira Product Discovery) through `/spikes/atlassian`. No site URL, account id or email is recorded here (public repo).

**J1, auth: works.**
- OAuth 2.0 (3LO) with `read:jira-work`, `read:jira-user`, `write:jira-work` and `offline_access`: consent granted, code exchange works, exactly those scopes granted, a **refresh token is returned**, the access token lives **3600 s**. No `manage:*` scope is needed to read.
- Asking for the Confluence scopes in the same consent was granted too, but the site list still shows only Jira scopes and one site: this site has no Confluence product. **J7 needs Confluence added to the site** before it can be tried.
- Not yet tried: the refresh exchange itself (and whether refresh tokens rotate), webhook scopes (`manage:jira-webhook`), and any write. Sign in with Atlassian (R-031) is not covered.

**J2, discovery: works, with findings.**
- Hierarchy: Epic is level 1; Feature, Idea, Story and Task are level 0; Subtask is -1. **No level above Epic on this free site**, so that case (Premium or Enterprise) is still unverified. Team-managed projects each have their **own "Epic" issue type** (same name, different id): the initiative mapping must therefore be chosen **per Jira project**, as the docs already say, and the catalog lists a type name once.
- Jira Product Discovery: ideas are ordinary issues of type **Idea** (level 0) in a `product_discovery` project and come back through the same search, with their fields (Impact, Effort, Insights, Score, Roadmap, State, Theme, Idea short description) filled. **Reading ideas works (J8 read half);** writing them is still untried.
- Fields: 81 (37 custom). Role hints found Sprint, Start date, Story point estimate, Team, Assignee, Due date, Labels, Priority and Parent. There is **no "Epic Link"** (parent is used instead). Names are **not unique** (two fields named "Vulnerability", two "Atlassian project"): always use the id. Team, Parent and several others come back with kind "other" (object values): the mapping UI needs a per-field "how to read and write this" rule.
- Fill rate: Jira returns containers (comment, worklog, votes, watches, progress, time tracking, work ratio) even when unused, which made them look 10/10 filled. Fixed in `fieldHasValue`, tested.
- Search: the JQL `created >= -3650d order by created DESC` is accepted by `/search/jql`. The sample (10 issues) fits one page (`isLast` true), so **paging with `nextPageToken` and the page size are still unverified**: needs more than 100 issues (J6).
- Statuses: 11 on the site (7 In Progress, 2 To Do, 2 Done category), so a custom workflow with several statuses per category: map by **status category**, not by name.
- Projects: the project search reports `total`/`isLast`; the project type (`software`, `product_discovery`) and style (team-managed `next-gen`) are available to decide the mapping defaults.

**Next:** J4 (write: create an epic, set parent, labels, custom field, transition; ADF description), J3 (webhooks) and the refresh exchange. Writing to the sandbox Jira needs Ashu's go-ahead per run.

### Atlassian J4 (issue #257): write test, results of 2026-11-02
Run by Ashu on the same free Jira Cloud site through `/spikes/atlassian` ("Run the write test"). Everything worked and both test issues were deleted again.

**Writing works with `write:jira-work`:**
- Create an Epic with an ADF description (bold line, bullet list) and a label: 201.
- Create a child under the Epic with the `parent` field (no "Epic Link" needed): 201. Read back, the child's parent is the Epic.
- Update labels and description: 204. **The ADF structure came back identical** (paragraph, bold text, bullet list). Richer content (tables, macros, mentions) was not tried, so the "PV rewrites the description only when the PV text changed" rule in `docs/16` stays.
- Set Story points through the custom field id found in the field list: 204.
- Workflow: the transitions list works and a transition is accepted (204). Delete of both issues: 204, child first.

**What it means for the build**
- **Issue types differ per project.** This project has Epic, Feature, Task and Subtask, **no "Story"**. The test fell back to the first level-0 type (Feature). The Jira project mapping must list the types of that project and let the user choose, as `docs/16` already says; never assume a name.
- **Status names mean nothing; categories do.** The workflow offers transitions Idea (category "new"), To Do, In Progress and Testing (all category "indeterminate", so a status called "To Do" sits in the In Progress category) and Done. Combined with J2 (11 statuses in 3 categories): map and report **by status category**, and never by name.
- **Transitions are global here** (every status is reachable from every status). Other workflows restrict this: Jira refuses with an error, which the sync must show per issue, not retry.
- **The refresh token rotates.** Each refresh returned a new refresh token. The real connection must store the new one in the same step as it uses the new access token, serialise refreshes per connection (two parallel refreshes with the same token would lose the connection), and treat a refused refresh as "reconnect needed". Lifetime and inactivity expiry of refresh tokens: confirm in Atlassian's documentation.
- **Admin-only guard works** for an admin; the non-admin refusal was not clicked through.

### Atlassian J3, J5, J6, J7, J8, levels above Epic, Sign in with Atlassian (2026-11-03, no Jira site reachable from the cloud session)
Atlassian's developer documentation could not be fetched (host not allowed in the cloud session), so everything below marked "documented" is from memory and **unverified**. Each open item has a probe on `/spikes/atlassian` ("More probes") that prints counts, status codes and structure only (no issue text, site address, account id or email). Write probes create at most one object and remove it again; each needs Ashu's click.

| ID | Result | Verified? | What decides it |
|---|---|---|---|
| **J3 webhooks** | **Decided and built, switched off** (`docs/decisions/2026-11-03-jira-webhooks.md`): webhook per linked project, registered and extended by the daily check, delivery is only a hint, the issue is re-read and applied through the existing path; the daily check stays as backstop. Registration shape, 30-day expiry, refresh, retry count, unsigned deliveries are documented only. | Code tested with a fake Jira. **Not against a real site.** | Ashu runs "J3" (needs the scope `manage:jira-webhook`, so sign in once more), changes an issue in Jira, and looks for the line `jiraWebhookSpike` in the Vercel logs; then sets `JIRA_WEBHOOKS=1`, `JIRA_WEBHOOK_ORIGIN`. |
| **J6 paging and rate limits** | Reading pages with `nextPageToken` (100 per page, at most 10 pages = 1,000 open issues per project and read, then `truncated`), de-duplicates, and now **retries 429 and 503 with the site's Retry-After** (it used to fail the whole read). Tested with a fake Jira of 230, 950 and 2,500 issues, pages smaller than asked, a 429 mid-way, repeated 429s. | Logic yes. **Real page size and real 429 behaviour: no** (the sandbox has 10 issues). | Ashu creates 250+ issues (Jira CSV import) and runs "J6": it prints pages, sizes returned, seconds, 429 count and rate-limit header names. |
| **J5 Bitbucket link** | **Recommendation, unverified:** read PR and pipeline state from the Bitbucket Cloud API with its own OAuth consumer (Bitbucket does not use the Jira 3LO token), finding PRs by the Jira key in branch name or title. Jira's own "Development" field is the cheap first source if it is readable through the public API. | Probe only ("J5": reports the shape of the Development field of one issue). | Needs a Bitbucket workspace connected to the Jira site (Ashu), and decides between Jira development info and the Bitbucket API. |
| **J7 Confluence** | Not tried: this site has no Confluence (J1). Scopes already requested in the spike (`write:confluence-content`, `read:confluence-space.summary`, `read:confluence-content.summary`) were granted. | No. | **Ashu adds the Confluence product to the sandbox site** (free plan is enough), then "Connect Jira and Confluence" on the spike page; the Confluence page conversion probe is written after that. |
| **J8 ideas, write half** | Not tried. | Probe "J8" creates one idea (summary, label), edits its summary, lists transitions and deletes it. | Ashu's go-ahead for one run on the discovery project. Until then Product Discovery ideas stay read-only (docs/16 table). |
| **Levels above Epic** | Not testable on a free site. The catalog already proposes the lowest level >= 2 when present (tested). | Logic yes, real site no. | A Premium or Enterprise trial, or a customer site (Ashu). |
| **Sign in with Atlassian (R-031)** | Supabase Auth now supports **custom OAuth2/OIDC providers** (GA, identifier `custom:<name>`, manual endpoints possible; about 3 per project; source: Supabase docs and launch post, April 2026). Atlassian is not a built-in provider. Open: whether Atlassian's profile endpoint returns a verified email, and the mapping of the signed-in person to the Jira account id. | Documented only. | A small spike once Ashu decides to offer it: configure the custom provider and sign in once; map by the `account_id` of `https://api.atlassian.com/me`. Access to a workspace stays by invitation. |

**Still open, needs Ashu:** run J3, J6 (250+ issues), J8 (go-ahead), J5 (Bitbucket on the site), add Confluence for J7, a Premium trial for the levels; decide on Sign in with Atlassian.

### S6 Vercel (documented)
- Function duration with Fluid compute: Hobby 300 s default and maximum; Pro and Enterprise 300 s default, 800 s maximum (one page mentions an extended 1,800 s). Memory 2 GB Hobby, 4 GB Pro.
- Cron: Hobby 2 jobs per project, once a day; Pro 40 jobs, per-minute; Enterprise 100 (limits table, one footnote not visible).
- Bundle size: 250 MB uncompressed (a community report hits a 50 MB compressed limit when bundling full Chromium). Vercel's own guide for PDFs: `puppeteer-core` with `@sparticuz/chromium-min`, which downloads Chromium at runtime.
- **Not verified:** whether python-pptx, python-docx and openpyxl run within Vercel's Python runtime limits (nothing found). **S6b** (hands-on, before Phase 6): deploy one test route that makes a PDF from an HTML print view and one Python function that writes a .pptx, on a preview deployment.
- **Queue choice:** a queue table in Postgres processed by Vercel Cron (every minute on Pro) plus the webhook route acknowledging fast. Revisit if jobs exceed 800 s.
- **Conditions:** Pro before the pilot (cron frequency, longer jobs). Vercel's Hobby plan is meant for non-commercial use; check the current terms before any customer data is on it.

### S7 Supabase (tested and documented)
- **RLS performance (tested, Postgres 16 locally, 1,000,000-row `items` table, 500 tenants x 2,000 rows, index on `(tenant_id, rank)`; median of 7 runs):**

| Policy pattern | One project (2,000 rows, filtered) | Same, user in 25 tenants | Unfiltered, 1 tenant | Unfiltered, 25 tenants |
|---|---|---|---|---|
| A `is_tenant_member(tenant_id)` (current helper) | 23 ms | 37 ms | **9,869 ms** | **13,929 ms** |
| B `tenant_id in (select tenant_id from tenant_members where user_id = (select auth.uid()))` | 0.9 ms | 1.2 ms | 135 ms | 153 ms |
| C `tenant_id = any(array(select my_tenant_ids()))` (definer function, evaluated once) | 0.8 ms | 0.7 ms | 0.7 ms | 6 ms |

  Supabase's own docs warn about exactly this (a function that takes a row column cannot be cached). **Decision:** every new tenant table uses pattern C and every query filters by `tenant_id`; the existing helper pattern stays for the small tables (`tenants`, `tenant_members`, `invitations`) and `audit_log` moves to a hoisted admin pattern when the audit log is built out in Phase 1.
- **Audit trigger cost (tested):** a bulk update of 100 rows takes 6.9 ms without and 14.8 ms with the per-field audit trigger; 2,000 rows take 38 ms without and 286 ms with (about 0.14 ms per row). Fine as a background write behind an optimistic UI; revisit (statement-level triggers) above about 5,000 rows per action.
- **Realtime limits (documented, per project, shared by all tenants):** concurrent connections Free 200, Pro 500, Pro without spend cap and Team 10,000; messages per second 100 / 500 / 2,500; channel joins per second 100 / 500 / 2,500; channels per connection 100 on every plan; presence keys per object 10. A one-team pilot fits easily. Not tested: Realtime with RLS under load.
- **SAML SSO (documented):** SAML for projects (our customers' users) is offered on **Pro and above**, billed $0.015 per SSO monthly active user over the plan quota; several identity providers (one per customer) are supported through the CLI (`supabase sso add`), and the provider id is in the JWT, so RLS can use it. SSO accounts are never linked to an existing password or Google account with the same email (two separate accounts); single logout is not supported; IdP-initiated login does not work with PKCE (use a bookmark link that starts the login from our app). Supabase's SSO for its own dashboard is a separate Team/Enterprise feature and does not matter for us. Consequence for Phase 9: invitations and the "accept with the same confirmed email" rule need a variant for SSO users.

### S8 MCP authentication (documented)
- **Supabase side:** Supabase Auth includes an OAuth 2.1 server (currently beta, free during the beta on all plans): PKCE, optional dynamic client registration, a consent page that we build at a configured path (`/oauth/consent`) using `getAuthorizationDetails` and approve/deny calls, exact-match redirect URIs, normal Supabase tokens, so RLS applies as the signed-in user. Supabase has an MCP authentication guide for this.
- **Claude side:** Claude custom connectors support OAuth with dynamic client registration (RFC 7591) and client ID metadata documents; a custom client ID and secret can be entered for servers without dynamic registration; the callback is `https://claude.ai/api/mcp/auth_callback` (may move to `claude.com`); servers should support token refresh; community reports suggest a 401 should carry a `WWW-Authenticate` header.
- **Not found:** limits on tool schema size or tool count.
- **Decision:** build `/mcp` on Supabase's OAuth server. Risks: beta status; our `/mcp` must also publish protected-resource metadata. **S8b** at the start of Phase 4: deploy a minimal `/mcp` with one read-only tool and have Ashu add it as a custom connector in Claude. When Claude calls through our server it must set the write source `Claude MCP` itself, in a way a user cannot forge (today the `x-pv-via` header is advisory).

### S8b result (built 2026-10-27, issue #178)
**Built and tested here:** `/mcp` (POST, JSON-RPC over Streamable HTTP, stateless; `initialize`, `ping`, `tools/list`, `tools/call`), `/.well-known/oauth-protected-resource` and `.../mcp` (RFC 9728, pointing at `<supabase>/auth/v1`), a 401 with `WWW-Authenticate: Bearer resource_metadata=...`, `/oauth/consent` (approve/deny through `supabase.auth.oauth`), and one tool `get_workspace_context`. Tokens are checked with Supabase Auth on every call (`getUser`) and must carry a `client_id` claim, so a browser session token is refused and a revoked or expired token gives 401. The tool uses the caller's own token with the public anon key; the service role is not used on this path. Unit tests for the protocol and discovery; DB tests prove the forgery fix.
**Write source, decided (renamed `MCP` on 2026-11-02, issue #289):** migration 0040 makes `write_source()` return `Claude MCP` for any token with a `client_id` claim (signed by Supabase, so users cannot add or drop it), and records a plain `x-pv-via: Claude MCP` header as `API`. Assumption to confirm in the live test: Supabase puts `client_id` in OAuth-issued access tokens. If it does not, the fallback is the MCP server setting `app.via` through a database function that checks the token.
**NOT verified (needs the real Supabase OAuth server and Claude):** dynamic client registration, redirect URI (`claude.ai` vs `claude.com`), token refresh, that `client_id` is in the token, claude.ai and Claude Code connecting, the two-tenant check through a real OAuth token (RLS itself is covered by the existing two-tenant DB tests), and the questions in scope item 6 (tool schema size limits, image/base64 limits per client, Claude Code connecting). These stay open until the live test.
**Known gaps for slice 2 (closed in 0.36.0, issue #180):** the consent screen cannot pass a chosen workspace to the token (Supabase OAuth has no such field), so the binding lives in our own table `mcp_connections`; revocation, the workspace switch, rate limits and `ai_usage` are built (`docs/05`). Still NOT verified live: that Supabase puts `client_id` in the token, that `revokeGrant` ends the client's sessions, and everything in the S8b list above.

### S8c ChatGPT and Gemini connections (built 2026-10-30, request #230; **closed 2026-11-02: Ashu confirms Claude, ChatGPT and Gemini connect and work; the single checks were not written down**)
Server side built and tested with stand-ins: client detection, per-client tool lists, ChatGPT `search`/`fetch`, Gemini schema simplification, `get_playbook`, `connectors/`. Still to test with real clients and the Supabase OAuth server: ChatGPT Developer mode connect and OAuth, Gemini CLI `/mcp auth` (loopback redirect, changing port), Gemini Enterprise pre-registered client, the client names, per-client upload limits, that assistants really send their model name. List in `docs/27` section 8.

### Hands-on checks still needed (not blocking Phase 1)
| Check | When | Needs |
|---|---|---|
| S3b write issue-field values with a GitHub App; S4b sub-issue limits; S5b install by a non-owner | Start of Phase 3 | Ashu: a sandbox repository and a second GitHub account (S2b, S4b done 2026-10-23; S3b and S5b still open) (given 2026-10-23: `Product-Velocity/Test-Repo-01`, second account `dev-nbm`, org on the Free plan, project "Spike Project" exists) |
| S6b PDF and Python document functions on a Vercel preview | Before Phase 6 | Ashu: Vercel access (Pro plan assumed) |
| S8b real Claude connection to a minimal `/mcp` | Start of Phase 4 | **Built 0.34.0, live test open.** Server side done and tested (see "S8b result"); Ashu: switch on Supabase's OAuth server, set `MCP_ENABLED=true`, add the connector in claude.ai and Claude Code |

## Resolved 2026-10-21 (Ashu)
- First pitch audience: enterprise buyers.
- Seat definition (only Creator/Admin/Approver billable) and draft prices (Team €18, Business €36, Enterprise custom): confirmed as the working plan; still validate with buyers.
- No legal review required at this stage (customer consent/retention/"no delivery promises" wording stays as designed; revisit before real customers are invited).
- Prototype sharing "anyone with the link" is fine; data is fictional.
- Editing: autosave with undo only. No staged Save bar (removed from the Portfolio board).

## Open product questions
3. **AI agents as capacity**: model (hours? throughput?) and how they appear in the planner. Needed before marketing "AI and human teams" capacity.
4. **Engineers split across two teams** in the planner.
5. **Competitor claims** (Productboard, Jira Product Discovery, Aha): none verified; do not use in copy.
8. Data residency (EU) and hosting region.
10. Notification system (email, in-app, Slack?) — not designed.

## Known inconsistencies in the prototype
Board 2 shows flat child issues (should be epics + tasks); capacity planner ignores cross-team engineers and agents; Main (board 1) and Portfolio (20) overlap — treat 20 as canonical.


## S10: Supabase Send Email hook and branded emails (issue #370)
**Status (2026-11-09): partly run, first real send works.** Hook enabled on the production project (Provelo) by Ashu after PR #380 was deployed; Resend account for Product Velocity, both domains verified (`productvelocity.app`, `product-velocity.com`), sender `Product Velocity <noreply@productvelocity.app>`, open and click tracking off. No addresses or tokens are recorded here (public repo).

| Question | Result | Evidence |
|---|---|---|
| Hook available on our plan | Yes: Authentication > Auth Hooks > Send Email (shown as Beta), type HTTPS endpoint, secret `v1,whsec_...` | Tested (dashboard) |
| Signing scheme and payload | Standard Webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`); payload `user.email`, `email_data.{token, token_hash, redirect_to, site_url, email_action_type}`; success is `{}` with 200, errors `{error:{http_code,message}}` | Documented (Supabase docs example for the hook with Resend) and **tested** for the sign-in link: the signature verified and the email was sent |
| Unsigned request | 401 | Tested against production |
| Sign-in link (magiclink) | Email arrived in the inbox, branded layout, link signed the person in. Token hash had the `pkce_` prefix and worked through `/auth/callback` (`type=email`) | Tested, same browser |
| Resend sending, SPF/DKIM | Test message delivered to a Gmail inbox from `productvelocity.app` | Tested |
| Response time, behaviour on failure, rate limits | Not measured | Open |
| Link opened in **another browser** | Not tested yet | Open |
| Confirm sign-up, reset password, confirmation code, invite, email change | Unit-tested only, not sent for real. Which token hash goes to which address on an email change is from memory of GoTrue | Open |
| Where editable copy lives | Not decided (phase 4) | Open |

Switch-off: disable the hook in Authentication > Auth Hooks; Supabase then uses the templates pasted from `apps/web/email-templates/` (route A).
