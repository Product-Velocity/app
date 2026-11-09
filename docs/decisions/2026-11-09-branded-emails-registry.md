---
date: 2026-11-09
by: Claude, to confirm with Ashu
request: 370
status: proposed
---
**Branded emails from one place (issue #370): first slice.**

## Decided (first slice, Phase 1 without the spike)
- **Template registry in code** (`apps/web/src/lib/email/registry/`): key, trigger, recipient, code path, allowed macros, default wording. One layout in git (`layout.ts`), one macro engine (`macros.ts`). Editable copy (phase 4) will override the six text fields only and fall back to these defaults.
- **Send Email hook route** `/api/auth/send-email`, **off until `SEND_EMAIL_HOOK_SECRET` and `SITE_URL` are set** (answers 503), so production keeps using the route A templates pasted into Supabase until Ashu switches the hook on. Signature check (Standard Webhooks scheme) before the body is read; links built by us to `/auth/callback?token_hash=...&type=...`; an off-site `redirect_to` is ignored.
- **Auth actions covered:** signup, magiclink, recovery, reauthentication, invite, email_change. Ashu asked (2026-11-09) that `/auth/callback` accept `invite` and `email_change` link types; it now does (`callback-params.ts`, test updated). On an email change the hook sends to the new address, and also to the current address when Supabase sends a second token hash. Which hash goes to which address is from memory and unverified (spike S10). An unknown action type gets 422.
- **Macros:** catalog of eleven (`link name workspace inviter role requester code session closes expires product`), each template declares which it allows; unknown or disallowed macros are refused by `validateMacros`, missing values use a fallback, values are escaped by type.
- **Not in this slice:** moving the app emails (invitation, access request, access approved, linked-address code, alignment emails) onto the registry (phase 2), the send log and webhook for all templates, the Emails area and editing (phases 3 and 4). A test lists the remaining `sendEmail` call sites and fails when a new one appears.

## Open
- The Phase 0 spike is **not done** (docs/08, S10): hook payload and signing, response time and failure behaviour, one real email of each type, Resend domain and rate limits, and where editable copy lives. The signature scheme and payload shape here are from memory and unverified.

## Phase 2 (same issue, second PR)
- **All app emails render from the registry:** workspace invitation (`app.invitation`), access request to admins (`app.access-request`), access approved (`app.access-approved`), linked-address code (`app.link-code`), alignment invitation, reminder and new link (`alignment.*`). Wording is the current wording; the **look** changes: every email now sits in the branded frame (logo, one button, footer). Where the old text carried the link inline ("Open this link: ..."), the link is now the button, with the full link printed under it.
- **Alignment emails have two layers:** the platform frame (registry) around the workspace admin's own subject and text. The admin's text still uses `{{name}}`, `{{session}}`, `{{closes}}`; an unknown `{{macro}}` is now dropped instead of being sent raw. Refusing unknown macros when the admin saves the text is **not** done yet (phase 4).
- **One way to send:** `sendLogged(key, ...)` (`lib/email/send.ts`). The key must be a registry key (type error otherwise); a test scans every call and fails when a send site has no registry entry or a registry entry has no sender. Only `send.ts` calls the email service.
- **Send log** (`email_send_log`, migration `..._email_send_log.sql`): template key, outcome, Resend message id, workspace when there is one. No address, name, token, link or body. Not readable or writable through the API (service role only); the platform Emails area (phase 3) will read it through a platform-staff function. The Resend webhook now updates its delivery state for every template (the invitation and alignment-participant rows keep their own state as before).
- **Rate limit finding (spike S10):** Supabase's own project-wide hourly cap on auth emails ("email rate limit exceeded", HTTP 429) still applies when the hook is used and blocked a Forgot password request after two sign-in links. Raise it under Authentication > Rate Limits before real customers (go-live checklist).

## Phase 3 (same issue, third PR): read-only platform Emails area
- **Where:** `/platform/emails` (a new "Emails" tab beside All accounts, Audit log and Access settings), platform admins only (`requirePlatformAdmin`; everybody else gets "not found"). Workspace admins, members and Claude cannot reach it.
- **Triggers overview:** event, template, recipient, sending path, confirm-first, limits, and the sends and failures of the last 30 days, from `platform_email_stats()` (migration `..._platform_email_stats.sql`, platform admins only; the send log table itself stays closed to the API). Gate notifications are shown as in-app only, with no template.
- **Preview:** `/platform/emails/<key>` shows the template with sample data at desktop and phone width, as HTML (sandboxed frame, no scripts) and as plain text, and never sends. Width and view come from the address, so the page needs no client code. Some templates carry their own sample (an invitation link works 7 days, a code 15 minutes) so a preview does not mislead.
- **Not in this PR:** editing, versions, publish and restore, test send (phase 4). Nothing on these pages can write.
