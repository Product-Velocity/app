---
date: 2026-11-19
by: Ashu (2026-11-19, chat), built by Claude
status: built, to confirm
---
**Five more flags, each with a next step, in the Flags and Actions columns of the Roadmap and the Changes report.** Clicking a flag does what its button does (decision of the same day).

| Flag | Shows when | Action |
|---|---|---|
| Ready for Gate C | Phase Experiment for 14 days or more, no gate request open or Held | Request gate C (opens the request dialog; the approver decides) |
| Gate checklist incomplete | Gate Status is In review (requested, checklist not complete) | Open Decisions |
| Hold review soon | Gate Status Held and Next Gate Due within 7 days (on the day, Needs attention's "Hold due" takes over) | Open Decisions |
| No Business Owner | Past Define and no Business Owner | Assign owner (opens the initiative) |
| No key result | Phase Define and no Primary KR | Add key result (opens the initiative) |

- **Report flags, like No phase set.** They show in the Changes report and the Flags column. **The Needs attention page is unchanged.**
- **Two numbers are defaults, not facts:** 14 days in Experiment (`EXPERIMENT_REVIEW_DAYS`) and 7 days for a Hold (`HOLD_SOON_DAYS`). The length of an experiment is not on the item (there is no experiment end date). Say if they should change; they sit in `packages/domain/src/change-report.ts`.
- **New kinds of action.** Besides a move: request a gate, go to Decisions (a link), open the initiative. A requested gate turns "Request gate C" into "Gate C requested", a link to Decisions.
- Nothing here sets Stack Rank, Decision or Value, and nothing decides a gate (rule 3). Flags describe an initiative, never a person (rule 8).
- **Owner is already Business Owner** in the grid, the Columns picker and the filter (decision 2026-11-18). The one place that still said "Owner" (the Goal fields Help page) now says Business Owner.
- Still to come, from the same chat: the 30, 60 and 90 day outcome review flag and its "Request metrics" action, which needs the outcome fields (phase 7). Its own decision file.
