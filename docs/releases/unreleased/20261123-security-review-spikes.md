---
bump: patch
type: security
---
**Security hardening.** Removed the old developer test pages for GitHub and Jira (they could be opened by any workspace admin and are no longer needed), made the daily-job secret check constant-time, and added stricter browser security headers (HSTS, no framing, permissions policy).
