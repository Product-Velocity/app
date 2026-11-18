---
date: 2026-11-18
by: Ashu (2026-11-18, "yes, go ahead with all three changes"), built by Claude
request: 508
status: built, to confirm
supersedes: the "Health and status" pill rules of the brand guide for Active, On hold and Initiative Phase
---
**One colour scheme for the five status fields, so colour means the same thing everywhere.** Green is fine or finished, blue is in motion, amber needs a look, red is a problem, grey is not active. The word is always shown (colour is never alone).

| Colour | Values |
|---|---|
| Green | On Track · Completed · Done · Go · Passed · Aligned |
| Blue | **Active** · In progress · Included · Committed |
| Amber | At Risk · **On hold** · **Deferred** · Hold · In review |
| Red | Delayed · Stop · Failing · Overdue |
| Dark red (new tone `severe`) | **Blocked** |
| Grey | Backlog · Not started · Candidate · Dropped · Cancelled |
| Outlined, no fill | **Initiative Phase**, all values; Completed and Sunset muted |

- **Why the three changes.** Active green looked like On Track although Active only says someone is working on it; Backlog, On hold and Cancelled were all grey so a stalled item hid; Delayed and Blocked looked the same. A phase says where an initiative is, so it is outlined and never reads as good or bad.
- **Built in** `status-tone.ts` (`statusTone`, `phaseTone`, `toneFor`), the grid (`columns.tsx`: Initiative Phase is a pill field, read only, drawn by `ReadOnlyCell`) and a **pill strip in the details panel header** (Phase, Status, Health, Planning, Build; only the ones that are set). Tokens `--health-severe-bg/fg` (white on `#8a1c1c`, 9:1). Cards, Gantt and reports keep using the same function for health.
- **The brand guide artifact is not edited by Claude.** Ashu updates its "Health and status" table: Active blue, On hold amber, Deferred amber, Blocked dark red, Initiative Phase an outlined pill.
