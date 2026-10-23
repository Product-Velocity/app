# Prototype map

Published (view-only reference): https://claude.ai/artifact/WVtip16iTPYZdru67tsgUn — also copied into `prototype/project/` as `.dc.html` files (Claude Design format: `<x-dc>` markup, `canvas.json` board index). Open the published canvas to click through; boards are interactive where marked. Data is fictional (Meridian Media).

| # | File | What it shows | Phase | Known gaps |
|---|---|---|---|---|
| 1 | Main | Roadmap grid with selection and bulk bar | 1 | Superseded in layout by 20 for portfolio |
| 2 | Item-detail | Item + GitHub tab | 2–3 | Rebuilt 2026-10-22: breakdown strip, epics with nested tasks, "created by" and "Scope added" tags. Example data. Built in #26 as the item panel and page with tabs Overview, Spec, GitHub, Alignment, Activity (the board's "Fields" and "History"); the GitHub tab lists the epics with their tasks (state, assignee logins, created by) from release 0.13.0 (#34); it says so when no issue is linked; the PR column waits for #35 |
| 3 | Gantt | Two-level grouped Gantt | 2 | Built in #27 (`docs/16-GANTT.md`): Baseline, Dependencies and Export from the board are not built; dragging saves at once with undo instead of asking for a confirmation |
| 4 | Cards | Card view with swimlanes | 2 | Built in #28 (`docs/17-CARDS.md`): default is Initiative Phase by Initiative Group (Planning Status arrives in phase 5); the board's value sums and confirmation on a Status drag are not built, a drag across the GitHub-driven Status is refused instead |
| 5 | AI-intake | AI intake with duplicate check | 4 | |
| 6 | GitHub-setup | Connection, waiting for approval | 3 | Built in #31 as Settings > GitHub (`/settings/integrations/github`: status, connect, waiting for approval, repositories, per-project default repository and "who breaks down the work") and Settings > GitHub > Test connection (R-025). The bulk bar's **Update GitHub…** and the item panel's **Update GitHub…** open a confirmation that lists what will be created or updated and the exact text of the managed block (#33). No board for the test page: it is a plain checklist with pass / fail / info and a copyable report. |
| 7 | Leadership | Leadership view + weekly update | 2/4 | Built in #29 (`docs/18-LEADERSHIP.md`): health by project, needs attention, top items, what moved, mix, weekly update. Not built: present full screen, share read-only link, Now/Next/Later, alignment tile, sending (the issue says nothing is sent automatically) |
| 8 | Results-admin | Alignment results (admin) | 5 | R2 dimensions not shown. Privacy model: `docs/19-ALIGNMENT-PRIVACY.md` |
| 9–12 | Join, Rank-top5, Rank-duel, Results-participant | Participant mobile flow | 5 | |
| 19 | Rank-coins | Participant 100 coins (mobile) | 5 | |
| 13 | Item-spec | Documents, readiness, epics, breakdown route | 4 | |
| 14 | Connect-Claude | MCP settings, permissions, roles | 4 | |
| 15 | Team-capacity | Teams, skills, time split, unassigned | 5 | Cross-team split not shown |
| 16 | Capacity-planner | Supply vs demand, fit line, plan vs actual | 5 | No AI-agent capacity |
| 17 | Alignment-setup | Session setup, 100 coins, invitations | 5 | |
| 18 | Planning-cycles | Phases, candidate pool, "so far" | 5 | |
| 20 | Portfolio | All-projects grid, quick-add, inline edit, scope switcher | 1 | Canonical grid reference; autosave status strip with Undo (staged Save bar removed) |
| 21 | Reports | Template gallery, schedule, history, generate | 6 | |
| 22 | Gate-review | Gate 2 review | 7 | New |
| 23 | Insights | Velocity + opportunities | 7 | Example data |
| 24 | Outcomes | Item outcomes & adoption | 7 | Example data |
| 25 | Item-alignment | Why/What/How/When per item, stakeholder sign-offs, customer concept review summary, decision log | 8 | New; example data |
| 26 | Concept-review | Customer concept review (mobile, customer-safe) | 8 | New |
| 27 | Billing | Plan, billable members, AI allowance and token packs, invoices | 9 | New; coding agents marked "Coming later" |
| 28 | Account | Profile, sign-in methods, 2FA, sessions, my workspaces, export and delete | 1 | New 2026-10-23; spec `docs/15` §3 |
| 29 | Workspace-settings | General, security, data, plan, staff access log | 2 | New; spec `docs/15` §4 |
| 30 | Admin-console | Staff console (workspaces, staff levels and capabilities, platform settings) and the "viewing as a member" banner | 2 | New; spec `docs/15` §5; internal, not for customers |
| – | Pitch-1…8, Deep-1…7, Pricing | Sales pitch, deeper dive, draft pricing (1280×720 slides) | n/a | Marketing only; not product UI |

## Where the app deliberately differs from boards 20 and 1 (decided with Ashu)
- Quick-add is a separate "Add an initiative" form above the grid, not the first table row.
- No band of column-group headers (What / Why / When ...): it does not survive moving columns or custom views. The group is shown in the Columns picker and the header tooltip.
- The grouped rows in the board are an example; the default grid is ungrouped. Grouping arrives with saved views (#9).
- The view chips are the ten default views of `docs/reference/default-views.csv` (Prioritisation, Planning, Delivery, Go-to-market, Outcomes, Leadership, Discovery, Timeline, History, Cycle review) plus "All columns", not the boards' Default view / Leadership / My items (those saved views come with #9).
- Members and Security are in the account menu (avatar), not in the tab bar.
- Everything else follows the boards: header with logo, workspace and scope chip, tabs; page head with title, view chips and tools (Import, Columns, Export); checkbox column first, then the three pinned columns (global rank, ID, initiative); lock icon on GitHub fields; project pills; the bulk bar with one "Set X ▾" menu per field, "Select all N" and "Esc clears". Not built yet and therefore shown muted or left out: Gantt, Cards, Planning, Capacity, Alignment and Reports tabs (muted, "arrives in phase N"), cycle chip, per-team fit band, ⌘K, AI draft chips.

Not yet designed: onboarding / first run (board 28–30 cover account, settings and staff); GitLab setup; notifications; mobile views of the grid.
Design tokens: white background; greys `#E6E9EF #EDEFF3 #F3F4F7 #EEF0F3`, header `#F8F9FC`; blue `#3347D9` (text `#2433A8`, tints `#E8EBFD #F4F7FE`); health green `#17653F/#E3F4EA`, amber `#7A4A00/#FDF0D5`, red `#8A1F1F/#FBE4E4`; 13px; 30–36px rows; IBM Plex Sans/Mono.
