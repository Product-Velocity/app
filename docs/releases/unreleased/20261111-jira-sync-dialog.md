---
bump: patch
---
**Sync dialog says Jira for Jira projects and no longer waits for ever.** The Sync window showed "Sync with GitHub", "Incoming from GitHub" and "Checking GitHub…" even when the project is linked to Jira; it now names the project's tracker from the first moment. A Jira site that does not answer is given up on after 20 seconds, so the window shows "Could not check" with a Try again button instead of staying on "Checking…".
