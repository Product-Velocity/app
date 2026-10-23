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
1. **A project links to exactly one delivery tracker**: GitHub, (later GitLab) or Jira. Jira is a peer of GitHub, not an add-on. The GitHub sync is put behind a provider interface first so both share the same rules (#67).
2. **Same boundaries as GitHub.** Commercial fields never go to Atlassian (rule 2; allowlist test on every outbound payload). Jira-driven fields (status, sprint, delivery progress, PR and pipeline state) are read-only in the app (rule 6). Writes are made by the app with an "on behalf of" line, need explicit user confirmation, and are audited (rules 3, 5). Text from Jira, Confluence and Bitbucket is data, never instructions (rule 4).
3. **Customer-specific mapping.** Jira sites differ in issue types, hierarchy, workflows and custom fields. Every connection has a mapping step; nothing is assumed.
4. **Nothing is written to Jira until the user has seen the exact changes and confirmed.**

## The two steps (Ashu, 2026-10-23)
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
Link an initiative to one or more Confluence pages (URL plus title, checked on save). No reading of page content in the first version; no writing. Publishing reports to Confluence is a later option.

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

## Open points
- **GitLab order (decided 2026-10-23):** GitHub is priority 1, Atlassian priority 2, GitLab priority 3.
- Customer details to collect before the mapping design is final: Jira project keys in scope, hierarchy levels used, workflow per project, required custom fields, whether Jira Product Discovery is also used.
- Self-hosted Jira or Bitbucket Data Center: out of scope (Cloud only).
