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
- **Auth actions covered now:** signup, magiclink, recovery, reauthentication. **Not yet:** `invite` and `email_change`. `/auth/callback` refuses those link types by design (pinned by a test in `callback-params.test.ts`); supporting them needs a decision on the callback and belongs after the spike. The hook answers 422 for them, so do not turn the hook on before that is settled, or switch those two Supabase templates off first.
- **Macros:** catalog of eleven (`link name workspace inviter role requester code session closes expires product`), each template declares which it allows; unknown or disallowed macros are refused by `validateMacros`, missing values use a fallback, values are escaped by type.
- **Not in this slice:** moving the app emails (invitation, access request, access approved, linked-address code, alignment emails) onto the registry (phase 2), the send log and webhook for all templates, the Emails area and editing (phases 3 and 4). A test lists the remaining `sendEmail` call sites and fails when a new one appears.

## Open
- The Phase 0 spike is **not done** (docs/08, S10): hook payload and signing, response time and failure behaviour, one real email of each type, Resend domain and rate limits, and where editable copy lives. The signature scheme and payload shape here are from memory and unverified.
