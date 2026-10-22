# Spikes and open questions

## Spikes (do in Phase 0; record result + decision here)
| ID | Question | Why it matters | Result |
|---|---|---|---|
| S1 | AG Grid Community: what is missing (range selection, fill handle, clipboard)? Custom editors for pickers, locked cells, 2,000 rows performance | Efficiency UX depends on it; Enterprise licence cost if needed | _todo_ |
| S2 | GitHub: can the app read/write user-owned Projects v2? Are project webhooks available (`projects_v2_item`)? | Dates and board mirror design | _todo_ |
| S3 | GitHub Enterprise Cloud: issue fields availability and API | Field mapping beyond labels | _todo_ |
| S4 | Sub-issues API limits (depth, count per parent) and best API (REST vs GraphQL) | Epic → task hierarchy | _todo_ |
| S5 | Minimum GitHub App permission set and install-approval events for non-owners | Enterprise security review | _todo_ |
| S6 | Vercel: long jobs, cron, PDF rendering (HTML print view, headless Chromium), Python functions for pptx/docx/xlsx; queue choice | Reports and sync architecture | _todo_ |
| S7 | Supabase: SAML SSO plan requirements, Realtime limits per tenant, RLS performance with membership joins | Enterprise and scale | _todo_ |
| S8 | MCP: remote server auth with Claude clients (OAuth), tool schema size limits | Phase 4 | _todo_ |

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
