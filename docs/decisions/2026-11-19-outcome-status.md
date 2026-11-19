---
date: 2026-11-19
by: Ashu (2026-11-19, chat: "do outcome status"), built by Claude
status: built, to confirm (the cut-offs are defaults)
---
**Outcome Status (`outcome_status`, V33) is now a live, read-only value worked out from the outcome reviews**, like Outcome Review Date, Realized KR Value and % Realized KR Value (`2026-11-19-outcome-fields-and-draft.md`). It was an Input field "arriving in phase 7"; nobody could have filled it.

**The rule is mine, not written down anywhere, so the numbers are defaults to confirm** (like STALL_DAYS and the 14 days for Gate C). Outcome Status is the result of the latest outcome review. It looks at how far the latest realised value has come **from the KR start to its target** (the same figure as KR Progress):

| Result | When |
|---|---|
| **Not yet due** | In Roll-out or Completed, nothing recorded, and the first (30 day) review is still ahead |
| **Exceeded** | More than 100% of the way |
| **On target** | 80% or more (`OUTCOME_ON_TARGET_PCT`) |
| **Behind** | Less than 80%; also under 50% until the 90 day review is recorded |
| **Missed** | Under 50% (`OUTCOME_BEHIND_PCT`) once the **90 day** review is recorded |
| *(empty)* | The first review is due and nothing is recorded; or there is no KR start, target or value; or the initiative is not in Roll-out or Completed, has no Start Roll-Out, or is Cancelled |

- A metric that should go down works, because the sign cancels (start 100, target 0, value 10 is 90% of the way). It uses the latest recorded review that has a value.
- **Why "Missed" waits for 90 days:** a result below 50% at 30 or 60 days is still "Behind" (it can recover); "Missed" is a final word.
- Pill colours already existed for these words (On target and Exceeded green, Behind amber, Missed red, Not yet due grey; `status-tone.ts`). It is in the Outcomes view right after Initiative Phase and in the History view.
- **Not changed:** Outcome Verdict (Hit, Partial, Miss, Too early) stays a person's judgement, still arriving in phase 7.
- **To confirm:** the 80% and 50% cut-offs, and whether "Missed" should wait for the 90 day review.
