---
bump: patch
---
**Paused and revoked members keep their name on initiatives.** An initiative that named a member who was later paused or revoked used to show “unknown person” in the grid, reports and exports. It now shows their name, and filters and reports can still pick them (to see what a former product manager owned). They are no longer offered when you choose a person, in quick add, in a paste import or for Claude. Migration `20261126104438_people_directory_all_statuses`.
