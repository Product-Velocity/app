---
date: 2026-11-19
by: Ashu (2026-11-19, chat: "yes to both questions"), built by Claude
status: built, to confirm
---
Ashu answered yes to the two questions left open in `2026-11-19-outcome-reviews-claude-and-columns.md` and `2026-11-19-outcome-columns.md`.

## 1. Claude may draft the request for metrics (text only)
- New read tool **`draft_outcome_request`**: a draft subject and message asking for the 30, 60 or 90 day metrics (which review, when it is due, the key result and its unit, what to include: the realised value, the adoption %, a short note). Built only from the initiative's own data. Without `at_days` it drafts the earliest checkpoint nobody has recorded; for one already requested it says it is a reminder.
- **It sends nothing, notifies nobody, records nothing.** Asking for metrics still sends a notification, so a person does it: **Request metrics** in the app (the Product Manager, or the person who created the initiative, is notified). It refuses a recorded checkpoint, an unknown initiative and an initiative with no Start Roll-Out. Rule 3 is untouched: Claude does not send.
- Help pages (AI co-workers, AI use-cases and documents, the shared use-case table), `docs/20-CLAUDE-MCP.md` and the generated `connectors/gemini/GEMINI.md` list it.

## 2. Three of the dictionary's own phase-7 outcome fields are now computed from the reviews
The duplicates this change retires, and what stays:

| Dictionary field | Before | Now |
|---|---|---|
| **Outcome Review Date** (`outcome_review_date`, V34) | Editable, "arrives in phase 7" | **Read-only, live**: the due date of the next review nobody recorded. Replaces my "Next Outcome Review" column (retired) |
| **Realized KR Value** (`realized_kr_value`, 67) | Input, "arrives in phase 7" | **Read-only, live**: the value of the latest recorded review that has one. Replaces my "Latest Realised KR Value" column (retired) |
| **% Realized KR Value** (`kr_realized_pct`, 68) | Computed, "arrives in phase 7" | **Live**: the realised value as a share of the KR target, in percent, the dictionary's own definition (empty with no target or a target of 0) |
| Outcome Reviews Recorded, Latest Adoption %, KR Progress (latest review) | new in the Outcome reviews group | unchanged. **KR Progress stays** because it measures start to target, which is not the dictionary's "% Realized" (value over target) |

- The three are no longer editable (Input became Computed); they were never filled by anyone, because phase 7 had not shipped. Their stored columns on `items` stay in the database, unused.
- **Dictionary:** 177 fields (179 minus the two retired). Outcome Reviews Recorded is now ID N54: my first version used N52 and N53, which Objective and Business Line already held (the IDs are labels only, nothing reads them; they are unique now). The Outcomes view now reads: phase, Outcome Review Date, Outcome Reviews Recorded, Realized KR Value, % Realized KR Value, Latest Adoption %, KR Progress, Outcome Status, then the key result and the rest.
- **Still later (phase 7), not changed:** Realized EUR per year, Measured Period, Outcome Verdict, Learning, Value vs Prediction (%), Time to First Use, Retention (%).
- **Outcome Status** was built afterwards, with a default rule to confirm: `2026-11-19-outcome-status.md`.
