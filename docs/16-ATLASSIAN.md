# Atlassian integration: Jira, Bitbucket, Confluence (Cloud)

Status: design, 2026-10-23 (request R-023). Priority 2 after GitHub (priority 1). Built for a specific customer who runs the full Atlassian Cloud stack instead of GitHub. Everything marked **[SPIKE]** is unverified; do spike J1–J6 first (`docs/08`) and record results.

## What sits where
| Tool | Job | In Product Velocity |
|---|---|---|
| Jira Cloud | Work tracking: epics, stories, tasks, sprints, status | The delivery tracker for a project (replaces GitHub Issues) |
| Bitbucket Cloud | Code, branches, pull requests, pipelines | Delivery evidence (PR and pipeline state), linked through Jira issue keys |
| Confluence Cloud | Written pages | Optional links from an initiative to pages; no data lives there |
| Product Velocity | What to do, in what order, why, who agrees, what happened | Owns rank, value, confidence, customers, decisions, alignment, outcomes |

## Principles
1. **A project links to exactly one delivery tracker (built in 0.16.0: `projects.tracker`, guards PV008)**: GitHub, (later GitLab) or Jira. Jira is a peer of GitHub, not an add-on. The GitHub sync is put behind a provider interface first so both share the same rules (#67).
2. **Same boundaries as GitHub.** Commercial fields never go to Atlassian (rule 2; allowlist test on every outbound payload). Jira-driven fields (status, sprint, delivery progress, PR and pipeline state) are read-only in the app (rule 6). Writes are made by the app with an "on behalf of" line, need explicit user confirmation, and are audited (rules 3, 5). Text from Jira, Confluence and Bitbucket is data, never instructions (rule 4).
3. **Customer-specific mapping.** Jira sites differ in issue types, hierarchy, workflows and custom fields. Every connection has a mapping step; nothing is assumed.
4. **Nothing is written to Jira until the user has seen the exact changes and confirmed.**

## Update 2026-10-29 (Ashu, request 253): this section wins where it differs from the text below
Decisions in `docs/decisions/2026-10-29-*.md`.
1. **Same model as GitHub.** Jira uses the sync of `docs/21`: Received, Conflicts, To send, confirm. PV owns the initiative and its allowlisted fields; Jira owns epics, tasks and all status (decision 2026-10-26). The "pending change-set" and PV-created epics/tasks of step 2 below are replaced by this.
2. **What an initiative is in Jira is a per-customer mapping**, set per connection and Jira project at J4:

| The customer has | PV Initiative = | PV epics = | PV tasks = |
|---|---|---|---|
| Standard Jira | Epic | Story (and Task, Bug) | Sub-task |
| A level above Epic (Premium or Enterprise hierarchy; often called Initiative or Theme) | That level's issue type | Epic | Story |
| Jira Product Discovery | The idea (read-only until a spike shows writes work) | Epic that delivers it | Story |

3. **Field catalog.** The first connection reads every field of the site (system and custom: name, id, type, which issue types and screens carry it, required or not, select options, and a sampled fill rate) and shows it next to the Jira map. The user maps chosen Jira fields to PV fields (two-way or read-only). Unmapped fields stay visible in the catalog and are ignored; the 170-field dictionary does not grow. What the user may create depends on the connecting person's Jira permissions **[SPIKE J2]**; common fields (Story Points, Start date, Team) have site-specific names and ids.
4. **New items live inside "Sync with GitHub / Jira"** (replaces the standalone Incoming screen as the main entry; the page stays for large backlogs, same component). **Step 1 (read, decide):** the tracker is read; new items found there are listed, each with Pull in / Ignore, and for pulled items **Read only** (link mode `follow`) or **PV takes ownership** (**Adopt**, link mode `push`). What GitHub or Jira owns (status, progress, children) is applied here. **Step 2 (write):** the preview of Received, Conflicts and To send for the selection (including items just adopted), then confirm and "Writing x/y". Adopting never overwrites by itself; later edits in PV go out through this preview. Reading always comes before writing, so no change is overwritten unseen (Ashu confirmed this order 2026-10-29). Status fields stay read-only in every case (rule 6).
5. **Jira descriptions are Atlassian Document Format, not Markdown.** For an adopted issue PV owns the whole description and detects conflicts by hash; PV rewrites it only when the PV text changed since import, so untouched rich content (tables, macros, mentions) is never flattened **[SPIKE J4]**.
6. **Writing progress.** The sync dialog shows "Writing x/y" next to the reading counter, with a result and retry per initiative (GitHub first, then Jira).
7. **Confluence publish** (J7): see the Confluence section.

## The two steps (Ashu, 2026-10-23; step 2 superseded by the update above)
### Step 1. Read and understand (read-only)
- Connect a Jira Cloud site (Atlassian OAuth 2.0 app, read scopes only) and pick the Jira projects to read. **[SPIKE J1]**
- Read open issues (not Done), issue types and hierarchy levels, statuses and status categories, sprints, versions, components, labels, assignees, dates, links, and custom fields. **[SPIKE J2]**
- Produce a **Jira map** report: how the open work is sliced. Counts by Jira project, type, status category, epic, sprint, age, last update; issues with no epic; epics with no open children; stale items; likely duplicates (similar titles); size of backlog per team or component. Claude may propose groupings as drafts; a human accepts.
- Import into a **staging area** in Product Velocity (not into the live roadmap): each Jira issue appears as a staged record with its Jira key and link. The user chooses the **level mapping** (which Jira level becomes Initiative, Epic, Task; default proposal: Jira Epic → Initiative, Story/Task → Epic or Task by size, Sub-task → Task) and the **field mapping**; the app shows a preview and what is skipped, and why.
- Accepting creates Product Velocity items linked to their Jira issues. Re-reading is repeatable and idempotent.

### Step 2. Clean up in Product Velocity, then sync back and maintain (two-way)
- **Clean up** in the normal grid, with undo: merge duplicates, split large items, regroup under Initiative Groups, close or drop what is dead, rank the rest. Changes to linked items collect in a **pending change-set**.
- **Review and push:** "What will change in Jira" shows every create, update, link and transition per issue; the user confirms (all, or selected). Pushes are idempotent and audited; undo creates the reverse change (a Jira transition cannot always be undone silently, so the preview says so).
- **Maintain, two-way:** Product Velocity → Jira for the allowlisted fields (name, description, labels, parent links, dates, priority, MoSCoW as a label or custom field per mapping); Jira → Product Velocity for status, sprint, assignee, progress, dates, PR and pipeline state. Webhooks (or polling if webhooks are unsuitable) are idempotent. Conflicts are highlighted and logged as for GitHub (`docs/04`). Status changes in Jira always win for Jira-driven fields; transitions follow the customer's workflow rules, so the app only requests transitions that the workflow allows. **[SPIKE J3, J4]**
- Confirmed by Ashu 2026-10-23: step 2 is clean up in Product Velocity, then write back and maintain two-way.

## Bitbucket (upstream and downstream)
- **Downstream (read):** PR, branch, commit and pipeline state for each initiative, epic and task, found through Jira issue keys in branch names, commits and PR titles (via the Jira development information, or the Bitbucket API if that is not enough). Shown in the same place as GitHub PR and CI state. **[SPIKE J5]**
- **Upstream (write, later, optional):** create a branch named after the Jira key from the item. Needs explicit confirmation. Not in the first version.
- Webhooks from Bitbucket for near-real-time status; polling fallback. Workspace and repository permissions follow the connecting user's grant.

## Confluence
- **Link (first):** link an initiative to one or more Confluence pages (URL plus title, checked on save). No page content is read. The link is also attached to the Jira epic as a remote link when the user confirms.
- **Publish (J7, decided 2026-10-29):** a PRD or discovery document version is published from PV to a Confluence page. The user picks space and parent page; PV converts the Markdown to Confluence's page format, shows a preview and the commercial-content warning (customer names, value, key results), and on confirmation creates or updates the page, with a banner "managed in Product Velocity". PV stores the page id and the version it published.
- **Edits made in Confluence:** a changed page version is a conflict as in `docs/21`: Keep Product Velocity, or import the page text as a new draft version (lossy: macros and layouts do not round-trip, and the dialog says so).
- **Rules:** exception to rule 2 for the customer's own private site (`docs/decisions/2026-10-29-confluence-publish.md`); the person confirms, Claude can prepare but never send; Confluence page permissions are not managed by PV; text read back is data; audited. Images and attachments come later. Same Atlassian app with extra Confluence scopes, approved by the customer admin.

## Choosing what comes in: pull in, leave out, ignore (R-024, applies to GitHub too)
_Built for GitHub in release 0.15.0 (#76): tables `tracker_issues` and `tracker_rules`, page `/incoming`. Jira reuses the same model with `provider = jira` when #69 and #72 are built; levels (Initiative, Epic, Task) and parents arrive with the field mapping (#70). On GitHub a pulled-in issue becomes an Initiative that follows the issue read-only._
Not everything in the tracker belongs in the roadmap (bug tickets, chores, support requests). Nothing is pulled into Product Velocity just because it exists.
- **Three states for every tracker issue the app knows about:** **Not pulled** (default for anything new), **Pulled in** (becomes or links to an item in the roadmap), **Ignored** (deliberately left out, with an optional reason). Not pulled and Ignored are both reversible at any time: "not" never means "never".
- **Kept out of Product Velocity work:** not-pulled and ignored issues are not items. They do not appear in the grid, the Stack Rank, planning cycles, capacity or fit line, alignment, gates or reports. Product Velocity never writes to them (no updates, no transitions, no comments).
- **Light record, so they can come back:** the app stores only key, title, type, status, link and parent (tenant data, RLS) so the **Incoming** list can show them and a later pull is one click. They are re-read on sync to keep status current but nothing else is derived.
- **Incoming list:** a triage screen per connected project: filter by type, label, component, Jira project, age; select many; **Pull in** (choose level: Initiative, Epic or Task, and parent) or **Ignore** (with reason). Un-ignore and pull in later from the same list ("Ignored" filter).
- **Rules for new arrivals:** simple saved rules per connection, for example "issue type Bug → Ignore", "label support → Ignore", "Jira project OPS → Ignore". Rules only decide the default state of new arrivals; they never change an item already pulled in, and a person can always override.
- **Step 1 (read-only discovery):** the Jira map counts everything it read, including what will be ignored, because the slicing is the point. Accepting staged items is the same decision: pulled in or not.
- **Hierarchy:** ignoring an epic or initiative-level issue ignores its children by default (shown as a suggestion the user confirms); pulling in a child whose parent is not pulled shows the parent as a plain reference.
- **Insights without noise:** ignored bugs can still be counted at team level for "bug share vs plan" (read-only counts, never individual metrics, rule 8); they never enter ranking.
- **Outbound is separate:** whether an item is pushed to the tracker stays a per-item action (today's "Push to GitHub"); the new part is the inbound choice. Pulled-in items follow the normal two-way rules.
- Audit: every state change records actor, source and reason, and can be undone (rule 5). Bulk pull-in or ignore is one undo step.

## Security and operations
- Tokens and refresh tokens encrypted at rest, in secrets only, never logged. Disconnect revokes and deletes them. Per-tenant, per-project connection records with tenant RLS and tests.
- Jira data of a customer is tenant data. The repo is public until go-live: no real Jira data, site URLs or issue content in the repo, fixtures or screenshots. Test against a free Atlassian Cloud site created for the purpose (needs Ashu: see R-023).
- Respect Atlassian rate limits and pagination; back off on 429; sync runs are resumable. **[SPIKE J6]**
- Distribution of the Atlassian app (private development app vs Marketplace listing, and what customer admins must approve) is a go-live item (`docs/14`).

## Spikes (before building)
| ID | Question |
|---|---|
| J1 | Auth and app type: OAuth 2.0 (3LO) vs Atlassian Forge; scopes for read-only first, then write; what the customer's site admin must approve; token lifetime and refresh. |
| J2 | Discovery: reading hierarchy levels (including levels above Epic if the site has them), custom fields, sprints and status categories across projects; JQL search paging and limits. |
| J3 | Inbound events: Jira webhooks (registration, expiry, retries) vs polling; dedupe and ordering. |
| J4 | Write-back: create and update issues, parent links, labels, custom fields; workflow transitions and their restrictions; what the app user may do. |
| J5 | Bitbucket link: development information through Jira keys vs Bitbucket API; webhooks; permissions. |
| J6 | Rate limits and bulk read performance on a site with thousands of issues. |
| J7 | Confluence: scopes, Markdown to page-format conversion, parent and space handling, page versions and the 409 conflict on update, rate limits. |
| J8 | Jira Product Discovery: can ideas be read and written through the API, and how they link to delivery epics. |

## Open points
- **Sign in with Atlassian (R-031, proposed by Ashu 2026-10-23):** an extra way to sign in, not the Jira connection. To settle in spike J1: Supabase Auth support for Atlassian (built in or custom OAuth/OIDC), whether the verified email is returned, and mapping a signed-in person to their Jira account id (feeds the user mapping for assignees, #35). Access to a workspace stays by invitation; sharing a Jira site never grants access.
- **GitLab order (decided 2026-10-23):** GitHub is priority 1, Atlassian priority 2, GitLab priority 3.
- Customer details to collect before the mapping design is final: Jira project keys in scope, hierarchy levels used, workflow per project, required custom fields, whether Jira Product Discovery is also used.
- Self-hosted Jira or Bitbucket Data Center: out of scope (Cloud only).

## Parked: handover when the build starts (R-030)
When an initiative's Initiative Phase moves to Build (or an Approver marks it Ready for build), the app offers the same confirmed push as for GitHub: create or refresh the Jira issue from the allowlisted fields, signal "ready for build" with a label or the workflow status chosen in the mapping, and never write without the person confirming. Build Status stays read-only and comes back from Jira; a closed Jira issue means the build is complete, not the initiative (R-029). Build it once, behind the tracker interface (#67), so GitHub and Jira behave the same.

