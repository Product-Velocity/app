---
bump: patch
type: fixed
---
**Fix: the bell showed "Could not read changes (canceling statement due to statement timeout)".** The change counter behind the bell took several seconds to count recent changes and was cancelled by the database. It now reads only the few change records it needs and answers in milliseconds. Migration `fix_change_counts_timeout` (already applied to production).
