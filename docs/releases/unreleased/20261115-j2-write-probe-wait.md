---
bump: patch
---
**Spike page: the Initiative write test waits for Jira's search.** The write test on the Atlassian spike page now asks the children query again every 2 seconds for up to 10 seconds and reports how long Jira's search took to show the new child. The page also drops the RR-only test, which cannot run because RR has no Epic type. Admin spike page only; nothing changes for other people.
