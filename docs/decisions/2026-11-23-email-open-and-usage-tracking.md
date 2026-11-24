---
date: 2026-11-23
by: Ashu ("Remove that block on track. We need to track usage and email open."), recorded by Claude
request: 634
status: built, privacy text to confirm
---
**Email open and product usage tracking are allowed.**

- Ashu: "We need to track usage and email open." The test that failed any product email containing the words "pixel" or "track" is removed; the frame still carries one hosted logo and no image of our own besides it.
- Open tracking, when switched on, is added by the sender (Resend domain setting) at send time, not by our templates. Turning it on, receiving open events and showing them is a separate slice, not done here.
- **Still in force, until Ashu says otherwise:** `docs/19-ALIGNMENT-PRIVACY.md` rule 6 (no tracking pixels in alignment emails to voters) and rule 7 of CLAUDE.md (participant privacy); no individual performance metrics (rule 8); no personal data in logs.
- **Needs a decision before it goes live:** the privacy policy (`/privacy`) says "we do not use advertising or analytics cookies"; it must be updated to say what is measured (email opens, product usage), why, and how to opt out, in the same PR that turns tracking on.
- **Parity.** Not tracker related.

## Built (2026-11-24, issue #634)
- **Email opens, our own image, not Resend's switch.** Resend's open tracking is a setting for the whole sending domain, so it would also put an image in the alignment emails to voters (`docs/19-ALIGNMENT-PRIVACY.md` rule 6) and in sign-in and reset emails. Instead a template that sets `trackOpens` carries one 1x1 image whose address holds only the send-log row id (a random UUID). Only three templates do: the workspace invitation and the two personal notes from Ashu. A test pins that no alignment or auth email, and not the link-code email, ever does. Test sends never carry it.
- **What is stored:** `email_send_log.open_tracked`, `first_opened_at`, `open_count` (migration `20261124163730_email_open_tracking.sql`). No address, name, IP, browser or place; the log never held an address, so an open cannot be tied to a person. Opens in the first 30 seconds are ignored (mail servers and scanners load images at once). The numbers are a floor: some programs block images; some preload them.
- **Seen where:** platform Emails, a column "Opened, 30 days" (opened of tracked sends, per template). Counts only.
- **Usage:** platform Usage page, per workspace for 30 days: distinct people who made a change, number of changes, last change (from the audit log, platform admins only). No names and no ranking of people (rule 8). Reading, sign-ins and AI reads are not counted; All accounts still shows the last sign-in.
- **Switch:** `EMAIL_OPEN_TRACKING=off` stops the image at once; unset means on. The privacy page now says what is counted (`/privacy`, updated 24 November 2026): **Ashu to confirm the wording before this goes live.**
- **Not built:** per-page product analytics, click tracking, anything per person.
