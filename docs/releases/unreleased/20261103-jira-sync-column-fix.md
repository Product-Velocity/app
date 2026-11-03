---
bump: patch
---
**Fix: Sync with Jira could not read any initiative.** The Jira sync asked the database for a column that does not exist (G2M Date (est) is stored in `end_date`), so every initiative showed as not found. It now reads the real columns from the field registry, as the GitHub sync does, and a test pins the list against the real table.
