# Release log

The version is shown at the bottom of the account menu ("app v0.10.1 · build abc1234"). **A release is a pull request merged into `main`.** Every PR that changes what the app does bumps `version` in `apps/web/package.json` and adds a row at the top of this table (a test fails if the two disagree). Numbering while the product is pre-launch: `0.MINOR.PATCH`; a new feature or screen bumps MINOR, a fix or a docs-only change bumps PATCH. The build id is the first seven characters of the Git commit Vercel deployed.

| Version | Date | Key updates | PRs |
|---|---|---|---|
| 0.10.1 | 2026-10-23 | **Fix:** the "Open in Product Velocity" link in a GitHub tracking issue opened "no initiative found" because it used the internal id instead of the item code (R-12). Send the item again to correct the link in issues already created. | #PR |
| 0.10.0 | 2026-10-23 | **Push to GitHub (#33):** "Update GitHub…" in the bulk bar and the item panel shows exactly what will be written (title, labels, the marked block) and sends it only after you confirm. One tracking issue per initiative in the project's default repository; sending again updates it, never duplicates it, and keeps text outside the marked block and labels people added. Only the name, summary, hypothesis, artifact links and a link back leave the app (a test fills all 165 fields and fails if any other appears). The item panel shows the linked issue. New migration 0019. | #83 |
| 0.9.1 | 2026-10-23 | **Fix:** the GitHub settings page now refreshes itself every few seconds while it waits for GitHub's confirmation, so "Connected" appears without reloading. | #82 |
| 0.9.0 | 2026-10-23 | **Version in the menu and a release log:** the account menu ends with "app v0.9.0 · build <commit>"; this log; a test keeps the log and the version in step. | #81 |
| 0.8.0 | 2026-10-23 | **GitHub connection (#31):** Settings > GitHub to connect an organisation, "waiting for approval" for non-owners, repository list, default repository and "who breaks down the work" per project, disconnect; read-only **Test connection** page with a copyable report. New migration 0018. | #80 |
| 0.7.0 | 2026-10-23 | **GitHub sandbox spikes (#30), admin-only:** one-click suite at `/spikes/github` (credentials, issue types, sub-issue depth, organisation Project read and write, issue-field discovery, webhooks). Results: Projects link and sub-issues are go; Epic is not available on a Free organisation. Throwaway code, removed before go-live. | #65, #75, #77, #78, #79 |
| 0.6.0 | 2026-10-23 | Leadership view (read-only) with a weekly update draft (#29); delete initiatives with Trash and restore (#52); ordered default views, ten of them (#54); search box at the top of every long drop-down (R-018); fixes for menus in Safari and a dropped trash export. | #59, #60, #61, #62, #63, #64 |
| 0.5.0 | 2026-10-23 | Gantt view with two-level grouping and drag to move (#27); Card view with swimlanes (#28). | #57, #58 |
| 0.4.0 | 2026-10-23 | Item peek panel and detail page (#26); default views from the workbook, customisable, customer-safe views (#39); Initiative Group is an open list per workspace (#38). | #43, #51, #56 |
| 0.3.0 | 2026-10-22 | Saved views, scope switcher and command palette (#9). | #37 |
| 0.2.0 | 2026-10-22 | Roadmap grid: projects, items with the 165-field dictionary and one global stack rank, quick-add row, bulk bar and export, paste-import from Excel, design pass to the prototype boards. | #18, #20, #21, #22, #23, #24 |
| 0.1.0 | 2026-10-22 | Foundations: repo, CI, Supabase tenancy and audit with two-tenant isolation tests, sign-in with Google and email, tenants, invitations, members, 2FA, spikes S1 to S8. | #10, #11, #12, #14, #15, #16, #17 |

Versions 0.1.0 to 0.7.0 were written afterwards by grouping the merged pull requests; from 0.9.0 every merged PR adds its own row.
