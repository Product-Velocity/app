# Branded auth emails (issue #357, route A)

The HTML files here are **generated** from `apps/web/src/lib/email/auth-templates.ts` (`pnpm email:templates`); do not edit them by hand. A test fails if they drift.

Paste each into Supabase: **Authentication > Emails > Templates**, with the subject below.

| Supabase template | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirm your email for Product Velocity |
| Magic link | `magic-link.html` | Your Product Velocity sign-in link |
| Reset password | `reset-password.html` | Reset your Product Velocity password |

Also set, once: **Authentication > Emails > Email OTP expiration = 3600** (one setting for all three; the emails and the screens say 60 minutes), **Site URL** = the production address (the logo is loaded from `{{ .SiteURL }}/email/logo.png`), and a custom SMTP sender (see `docs/11-ENVIRONMENTS.md`).

Links use `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=...`, which `/auth/callback` accepts and which works in any browser or mail app.

Route B (later): a Supabase "Send Email" hook that renders these templates in the app and sends them through Resend, so nothing lives in the dashboard.
