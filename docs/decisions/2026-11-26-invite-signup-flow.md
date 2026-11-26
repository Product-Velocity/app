---
date: 2026-11-26
by: Ashu (2026-11-26, chat: after Create account on an invitation the page stays put and the emailed link ends on sign-in; make it smoother without lowering security), built by Claude
request: 689
status: built, to confirm
---
**Invitation sign-up flow (issue #689).** After Create account on an invitation the page only showed a green box; after the emailed link there was a long wait and the sign-in page again.

Decided (security unchanged: single-use token, 60-minute expiry, invited address only, 2FA first, `accept_invitation` still checks the address):

1. After Create account the page becomes a "Check your email" screen (resend after 60 s). It polls with the shared session cookie and moves on by itself when the link is confirmed in another tab of the same browser.
2. `GET /auth/callback` with a `token_hash` no longer verifies anything. It redirects to `/auth/confirm`, which shows a Continue button; the button POSTs to `/auth/callback`, which verifies the token. Mail scanners that open links never press it, so they cannot use the token up. OAuth codes are unchanged. Applies to every emailed link (sign-in link, confirm, reset). Links already sent keep working.
3. A used-up or expired invitation link lands on `/invite/<token>?link=used` with a note and the sign-in form (the invitation is still valid), not on the bare sign-in page.
4. The Continue POST accepts the invitation in the same step (server side, only from that POST, after 2FA). No "Accept and join" click after confirming the email. Signed-in people still press Accept.
5. "Signing you in…" on the Continue button and a loading state for the invitation page.

6. **A pending invitation wins over domain auto-join (found in production).** A person invited as Admin and Approver confirmed their email; auto-join (#673) made them an active Viewer first; `accept_invitation` then refused ("already a member", deliberately: an existing member cannot change role through an invitation), so they stayed a Viewer and the admins were emailed "joined as a Viewer". While a valid invitation for one of the person's verified addresses is pending for a workspace, `request_access_by_domain()` and `link_email_verify()` skip that workspace (migration `20261126093034_invited_people_are_not_auto_joined.sql`). `accept_invitation` is unchanged.
