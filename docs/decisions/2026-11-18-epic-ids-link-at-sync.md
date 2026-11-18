---
date: 2026-11-18
by: Ashu (2026-11-18, chat, issue 528), built by Claude
request: 528
status: built, to confirm
---
**Listing a Jira epic ID on an initiative is the approval: at Sync with Jira the epics that have no parent are linked at once; a move from another parent still asks.**

- **Why.** The flow was: a person lists epic keys, Sync previews them, a person confirms the send. When a person or Claude has just typed the keys, the confirmation adds a click and no safety, as long as nothing of anybody else's is changed. Setting the parent of an epic that has none changes nothing that was arranged.
- **What links at once** (Sync with Jira, for an initiative that already has its Jira issue and is owned by Product Velocity): requested epics with no parent, and epics already under the initiative (only recorded). The card says what was linked; the result is recorded per epic and audited as the person (`jira_record_epic_link`). An epic Jira refuses stays listed with Jira's reason and is tried again at the next Sync.
- **What still asks:** an epic that is under another parent (it moves; the old parent is kept as before), and an initiative whose Jira issue does not exist yet (the confirmed send creates it first). Epics that do not exist, are not at Epic level or are in a project whose initiative type is not above Epic are shown with the reason and not written, as before.
- **What did not change.** Only the epic's parent is written. Nothing happens until Sync with Jira runs (a button a person presses; the daily check only reads). Initiatives that follow their Jira issue read-only never get epics listed.
- **Claude** gets `request_jira_epics`: it records the keys (the same database function as the Jira tab, so the same role, ownership and audit checks), never writes to Jira itself, and tells the person the next Sync links them. This relaxes rule 3's "sending needs explicit confirmation" for this one case; CLAUDE.md says so.
- **Parity.** GitHub's twin (adding sub-issues under the parent issue) is issue #458 and is not built, so the relaxation and the tool are Jira-only for now.
