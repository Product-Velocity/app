---
bump: patch
---
**Initiative Status has Completed again.** The values are now Active, On hold, Completed and Cancelled, so a finished initiative no longer shows a blank status. Initiatives whose phase is already Completed or Sunset and had no status are set to Completed by the migration `20261029094141_initiative_status_completed.sql` (audited). Apply the migration before using the new value.
