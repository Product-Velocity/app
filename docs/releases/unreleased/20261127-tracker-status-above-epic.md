---
bump: patch
type: fixed
---
**Fix: Tracker Status of an initiative synced to a Jira Initiative.** It said "Not linked" once the initiative had its own Jira issue. It now says what its epics add up to ("6 of 7 epics done"), the same as an initiative that only lists epics; the Initiative's own Jira status is still never used for the build.
