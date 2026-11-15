---
bump: minor
---
**Jira connection checks you can read in the app.** Settings, Integrations, Jira, Test connection now runs the Initiative-level checks on your saved Jira sign-in: is there a level above Epic, does an Initiative's child query return its epics (and from how many projects), do two issue types share a name at different levels, and are some epics in projects without live updates. Each check shows pass, warn or fail with a reason and what to do, and the last run is saved so you do not have to copy results anywhere. A separate write test (admins only, after a confirmation) creates and deletes two test issues to prove an epic of another project can take an Initiative as its parent. Adds the table `jira_check_runs` (migration `jira_check_runs`).
