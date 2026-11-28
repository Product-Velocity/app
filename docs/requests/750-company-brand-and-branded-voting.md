---
issue: 750
status: open
logged: 2026-11-28
title: Company brand in the company profile, and workspace-branded voting screens
---
Ashu, 2026-11-28: add the company logo and brand colours (detected from the website or a shared presentation) to the company profile, and let the admin switch the voting screens to the company's logo and main and accent colours, removing the Product Velocity branding and colours, on every screen and not only on mobile.

Design, the three open questions (plan gating, privacy line, workspace or project level) and the dependency on request 749 are in issue #750. Not started.

Answers from Ashu, 2026-11-28 (full text in issue #750): branding is for paid plans in the future (build behind one entitlement check, open to all until plans exist, and add to the go-live checklist); one brand per workspace, also usable for the whole Product Velocity interface; the Brand section also takes the company's PowerPoint and Word themes, used when an AI co-worker outputs a document; no Product Velocity privacy line on voting screens, and "remove the accept" of it. **Still open:** whether that means keeping a consent box with the company's own wording (recommended) or removing the consent step entirely, which the names path and rule 7 depend on. Nothing on the consent step changes until Ashu answers.

Update 2026-11-28: Ashu chose (b): remove the voter consent step. Recorded with its consequences in `docs/decisions/2026-11-28-voter-consent-optional.md` (names path moves to an admin acknowledgement at setup; built as a per-session setting, default on, off for Ashu's company; rule 7 and `docs/19` amended when built). Part of slice 2 of #750.

Follow-up 2026-11-28: Ashu: the consent setting is **off by default**, and admins can turn it on. The setup acknowledgement is an optional tick that only unlocks the Creators' names path.
