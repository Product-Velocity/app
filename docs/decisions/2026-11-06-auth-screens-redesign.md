---
date: 2026-11-06
by: Ashu, proposed by Claude
request: 357
status: built, to confirm
---
**Auth screens: brand layout, emailed sign-in link, forgot password, branded emails (issue #357).** Decided after a clickable mockup: https://claude.ai/artifact/V4szHzTMAFACjiUpXAF1US

## Decided
- **Layout.** Split screen on sign-in, create account, accept invitation, forgot and reset password: brand side (logo, tagline "One roadmap for humans and AI.", what, why, the four pillars) and form side. Stacks on a phone (logo and tagline only). No product screenshot or example card in the panel. The line "Claude drafts. You approve." is **not** used.
- **Google and GitHub first**, above the email fields, so people default to them.
- **Fields.** Labels above, 44px, visible focus, show/hide password, input borders at 3:1 (`#8a919e`; the guide's `border-strong` `#d1d5db` is only about 1.5:1 on white, which fails WCAG 1.4.11). Fields scoped to the auth screens; the app's compact style is unchanged.
- **Passwords.** One new-password field, no "repeat" field (the Show button replaces it; managers fill one field reliably). Minimum 12 characters (was 10). Strength thresholds raised (Good 70 bits, Strong 90) so valid passwords read Good or Strong and the meter nudges toward Strong. `autocomplete=new-password` plus a `passwordrules` hint, email field always present as the username, separate page loads for sign in and create account.
- **Emailed sign-in link** for existing accounts only (`shouldCreateUser: false`). The reply is identical for unknown addresses, send errors and rate limits. A verified linked address resolves to the person. Two-factor still applies afterwards. Also on the invitation screen (sent to the invited address). Mail scanners may use up a link: accepted (Ashu).
- **Forgot password** now: `/forgot-password`, `/reset-password`, link type `recovery` through `/auth/callback`. Same reply whatever the address. Setting a password signs out every other device.
- **Emails: route A now, route B later** (Ashu). Branded HTML for Confirm signup, Magic link, Reset password lives in `apps/web/email-templates/` (generated, tested), pasted into Supabase with a custom SMTP sender. Route B: a Supabase Send Email hook rendering the same templates in the app and sending through Resend.

## Consequences
- One Supabase setting (Email OTP expiration) covers all email links, so every link says 60 minutes.
- Existing passwords of 10 or 11 characters keep working; the new minimum applies when a password is created or changed.
- The emails carry one hosted logo image with alt text; invitation emails (`lib/email/invitation.ts`) stay plain until route B.
- Go-live items added to `docs/14-GO-LIVE-CHECKLIST.md`.
