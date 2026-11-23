---
date: 2026-11-23
by: Ashu ("Remove that block on track. We need to track usage and email open."), recorded by Claude
request: 634
status: partly built, to confirm
---
**Email open and product usage tracking are allowed.**

- Ashu: "We need to track usage and email open." The test that failed any product email containing the words "pixel" or "track" is removed; the frame still carries one hosted logo and no image of our own besides it.
- Open tracking, when switched on, is added by the sender (Resend domain setting) at send time, not by our templates. Turning it on, receiving open events and showing them is a separate slice, not done here.
- **Still in force, until Ashu says otherwise:** `docs/19-ALIGNMENT-PRIVACY.md` rule 6 (no tracking pixels in alignment emails to voters) and rule 7 of CLAUDE.md (participant privacy); no individual performance metrics (rule 8); no personal data in logs.
- **Needs a decision before it goes live:** the privacy policy (`/privacy`) says "we do not use advertising or analytics cookies"; it must be updated to say what is measured (email opens, product usage), why, and how to opt out, in the same PR that turns tracking on.
- **Parity.** Not tracker related.
