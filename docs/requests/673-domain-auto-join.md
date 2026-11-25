---
issue: 673
status: done
logged: 2026-11-25
done: 2026-11-25
link: PR (version assigned when merged)
title: Auto-join as Viewer for confirmed emails at authorized domains, and tell the admins
---
Ashu (2026-11-25): "If a new user registers with an email address from a set workspace domain, then we should allow the user to see and login to that domain, after we verified the email address is correct and accessible by that user. Also, we need to send an email to the workspace owner/admin that a new user from their organisation signed up and successfully accessed the workspace as a viewer and that they need to set other rights manually." Chosen: per-workspace setting, default on. Decision: `docs/decisions/2026-11-25-domain-auto-join.md`.
