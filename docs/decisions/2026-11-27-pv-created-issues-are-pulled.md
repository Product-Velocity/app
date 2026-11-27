---
date: 2026-11-27
by: Ashu (chat, 2026-11-27), written by Claude
request: 740
status: built, to confirm
---
**An issue that Product Velocity created in Jira, or any issue already linked to a live initiative, is never offered as new in the Jira inbox.**

- **What happened.** After the first Sync of R-102 to the new issue RR-7, "New issues in Jira" (tab Not pulled) offered RR-7 for pull-in. The link existed; the light record the project read keeps (`jira_issues`) was created by the next read as Not pulled, and neither the read nor the create-link knew about the other.
- **What Pull in would have done (answer to Ashu).** Nothing harmful: `jira_pull_in` already answers "Already linked to R-102", repairs the record and creates no second initiative. The offer was the bug, not the action.
- **Now.** `jira_create_link` marks an existing record Pulled with the initiative; every read marks the Not pulled records of the project that have a link to a live initiative as Pulled (so a record the read creates is covered too). Ignored records and links of removed initiatives are left alone. One-off repair of the records in this state (RR-7 on R89: 1 row). Every change is audited (source system or UI).
- **Knowing where it came from.** The link is the memory: the initiative owns the issue (mode push) and it keeps syncing; the Jira label `pm:item/R-102` says the same inside Jira.
- **Not covered.** The GitHub inbox may have the same case for an issue Product Velocity created; to check and log separately.
