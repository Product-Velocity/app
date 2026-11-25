---
date: 2026-11-25
by: Ashu (2026-11-25, chat: a new user whose email is at a workspace domain should get in as a Viewer after the email is verified, and the owner/admin is emailed to set other rights), built by Claude
request: 673
status: built, to confirm
---
**Someone who signs up with a confirmed email at a workspace's authorized domain now joins as an active Viewer, and the workspace admins are emailed.** This replaces "Requested Access, an admin approves" as the default (`docs/15` section 3.3).

- **A per-workspace switch, default on** (Ashu chose this over default off and over removing approval): "People at authorized domains join automatically as Viewer" in Workspace settings, `tenants.auto_join_authorized_domains`, admins only, audited. Off keeps the earlier Requested Access flow. Existing workspaces get the default on.
- **Only confirmed or verified addresses** count (the sign-in address after email confirmation, or a linked address after its 6-digit code). Role is Viewer, never approver; audited with source system.
- **Only people with no row yet are touched.** Paused, revoked and already-requested people are not changed by signing up again; requests made before this change stay waiting for an admin.
- **Admin email `app.domain-join`** (registry, editable in the platform Emails console): says who joined as a Viewer and that other rights are not set automatically; sent to at most 10 active admins; skipped when email is not configured; a failed email never undoes the join.
- **Risk, raised for go-live** (`docs/14`): authorized domains are typed, not DNS-verified. With auto-join, an unowned domain listed by someone also puts that company's staff into the lister's workspace as Viewers. Before real customers: DNS verification, or switch the default to off.
- Migration `20261125104319_domain_auto_join.sql` (applied to production before merge). Tests: `packages/db/tests/domain-auto-join.test.ts`; `members-status` and `linked-emails` pin the switch off for the approval flow.
- Not built: DNS verification; emailing the person; a different default role.
