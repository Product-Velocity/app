---
date: 2026-11-03
by: Ashu (task of 2026-11-03: split the pages, read the tracker fields, show the default mapping, let a person change and save it), written by Claude
request: 67
status: in progress (slice 1 of 4 built)
---
**GitHub and Jira settings are split into two sections, then get a field configuration (same flow on both, `2026-11-03-tracker-parity.md`).**

## 1. The split (built)
- **Two routes, one tab bar.** `/settings/integrations/<tracker>` is **Connect and configure**; `/settings/integrations/<tracker>/logs` is **Sync logs**. The bar is one component (`components/tracker-tabs.tsx`) with the same two labels on GitHub and Jira, `aria-current="page"` on the open one. Routes (not client tabs) so each section has its own address, can be linked from a notice, and the logs page loads nothing heavy (no Jira calls).
- **Connect and configure** holds Status (connect, test connection, sign in again, disconnect), Projects, GitHub repositories and boards, the Jira issues waiting for a decision, and (slices 2 to 4) the field configuration. **Sync logs** holds the "what happens by itself" text, Live updates, Check now, Last check, the recent events with Run again, and a link to the latest connection test.
- "Check now" and "Run again" return to **Sync logs** with their result notice. The Jira dev harness (`/dev/jira`, `/dev/jira/logs`) has both sections for Playwright and axe.
