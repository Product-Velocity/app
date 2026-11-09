---
bump: minor
---
**Branded email registry and Send Email hook, switched off (issue #370, first slice).** Auth emails (confirm sign-up, sign-in link, reset password, confirmation code) can now be rendered by the app from one template registry in the branded layout and sent through Resend. The route `/api/auth/send-email` does nothing until `SEND_EMAIL_HOOK_SECRET` is set, so nothing changes for people today. App emails, the platform Emails area and editing follow in later slices.
