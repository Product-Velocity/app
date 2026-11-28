---
date: 2026-11-28
by: Ashu (the request); the design is Claude's, for Ashu to review
request: 749
---
**The voting screens have their own on-brand look, built for a phone first and widened for a desktop.** Issue #749. Ashu (2026-11-28): bring the voting screens and flows in line with the mobile site, "not just mobile".

1. **One frame for every voting screen** (`apps/web/src/app/a/[token]/voter-shell.tsx`, `voter.css`): the personal-link page (join, ballot, thank-you, closed, expired, replaced, other browser, results after the close), the stop-reminders page and the browser test page all use it. A header with the brand, one centred column up to 720px, a 16px reading size (the website scale; a voter is not a daily user), the brand guide tokens only, hairline borders, shadow only on the floating submit bar.
2. **Selection never relies on colour alone.** A selected card gets the capsule (the brand's pill motif: 4 by 16px, on the left edge) on a `brand-tint` card, and the chosen button is filled and keeps its words. The one decision button, "Submit my vote", is the brand blue, not green (green is only for actions that send or decide for others, brand guide).
3. **Phone and desktop.** On a phone the progress strip and the submit bar are full-width and sticky, the four MoSCoW choices are a 2 by 2 grid; from 720px the strips become rounded panels and the choices sit in one row. Every button and number field is at least 44px high.
4. **Everything is scoped to `.voter`**, so nothing leaks into the 13px app. The colours are read from `--brand`, `--brand-strong`, `--brand-tint`, `--on-brand` and `--brand-ring`; a workspace brand (issue #750) replaces those on the `.voter` element and nothing else changes.
5. **Voter emails are unchanged here.** They already use the branded frame (tile mark with the name as live text, the brand blue button, 16px body, `apps/web/src/lib/email/registry/layout.ts`); the company brand goes into that same layout in #750.
6. **Presentation only.** What is stored, who sees what, the wording of the consent step and every label the browser tests rely on are unchanged.
7. **Tests.** The browser spec `e2e/ballot.spec.ts` now also covers MoSCoW and the "More" card, and checks every method at 360, 390, 768 and 1280px for no sideways scrolling, no WCAG A or AA violations (axe), 44px tap targets and the 16px reading size. The pure colour rules for #750 (`packages/domain/src/brand-colors.ts`, AA guaranteed for any colour a company gives) come with this change and are unit tested.
