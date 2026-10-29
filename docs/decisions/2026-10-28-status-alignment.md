---
date: 2026-10-28
by: Ashu
request: 247
---
**One lifecycle, and everything else is either a tracker signal or a person's judgment.** Initiative Phase is the lifecycle and only gates move it; tracker fields only report; people fields only say what a tracker cannot know.

1. **Planning Status leads, Initiative Status follows.** Backlog and Not Started leave Initiative Status and become Planning Status values (Planning Status gains Backlog and Not started before Candidate). In the default views the two swap places: Delivery and History show Planning Status where they showed Initiative Status, Planning and Cycle review show Initiative Status where they showed Planning Status (release of slice 1; the exact value lists arrive in slice 2).
2. **Build Status is a tracker signal with a fixed vocabulary:** Not started, In progress, Done, Cancelled. GitHub (issue state, first child in progress, closed as not planned) and Jira (status categories To Do, In Progress, Done) both map into it; the tracker's own word is not shown for now. It counts from Gate B onward. It stays read-only and is never bulk-editable (rule 6). A closed ticket still means the build is done, not the initiative.
3. **Delivery Status is disabled for now:** removed from the default Delivery view and from the item panel header. The field stays in the dictionary (the 169 fields are unchanged) and the board read keeps working, so it can be turned back on.
4. **Initiative Status shrinks to what only a person knows:** Active, On hold, Cancelled. Completed comes from Initiative Phase (Completed or Sunset). No tracker sets it.
5. **Gates sit between phases (replaces G1 to G4):** Gate A Discover to Define (discovery document approved); Gate B Define to Build (PRD approved by an Approver, sets Ready for build); Gate C Beta-test to Roll-out (ready to launch). The outcome review at +30, +60 and +90 days is not a phase gate. Claude can prepare a gate pack; only an Approver decides.
6. **Mismatches become suggestions, never automatic changes** (Needs attention): Build Status Done while the phase is still Build; tracker work started before Gate B; Initiative Status Cancelled while the build is In progress.

Reading of "switch position" (change it if you meant something else): no default view contained both fields, so each view that showed one now shows the other in the same slot.

Built in step 2 (migration `20261028225223_status_alignment_values.sql`): Planning Status ships as an items column now (it was phase 5) with Backlog and Not started first; Build Status is fenced by a check to Not started, In progress, Done, Cancelled; Initiative Status by a check to Active, On hold, Cancelled. Conversion of existing rows: Backlog and Not Started in Initiative Status become Planning Status (when that is empty), In Progress becomes Active, Paused becomes On hold, Cancelled stays; Completed becomes Initiative Phase Completed when no phase was set and is otherwise dropped (the phase carries it). Build Status: Backlog and Not Started become Not started, In Progress and Paused become In progress, Completed becomes Done. The cards board keeps Initiative Phase as its default column (it was planned to switch to Planning Status once that shipped; not done silently).
