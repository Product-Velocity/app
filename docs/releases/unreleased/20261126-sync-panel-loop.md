---
bump: patch
type: fixed
---
**Sync from the ticket details window no longer loops.** Starting Sync from inside an initiative's side panel could leave the window on “Checked 0 of 1…” for ever, because the check started over each time the panel drew itself again. The check now runs once for the initiative, however often the panel redraws.
