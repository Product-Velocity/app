---
date: 2026-11-13
by: Ashu (chose option B, "Rank", from four proposals), written by Claude
request: 434
---
**Loading and sync use one indicator: the Rank pill loader, the logo's fifteen pills lit one by one in reading order (issue #434).** Brand guide section "Loading and sync" (design-system artifact, 2026-11-13). It is the only looping animation in the product, so the brand guide's "motion under 150 ms, none on load" rule has this one stated exception.

- **Animation.** Only opacity changes, 22% to 100% and back, pills 90 ms apart, one loop about 1.5 s. Pills only, in `logo-blue` (white on a `brand` button), no tile, never a second colour or a different pill count, never rotated. Never more than three changes a second.
- **A word is always shown** next to it ("Loading the roadmap…", "Saving…", "Checking GitHub…"), announced as a status. The glyph is decorative.
- **Timing.** A loading line shows after 300 ms (CSS), so quick loads do not flash. The brand guide also asks for a 400 ms minimum on screen; that is not built (a line that unmounts cannot be held back in CSS) and is a follow-up if flicker shows up in practice.
- **Reduced motion** shows the pills still at 100%, with the word.
- **Where.** `Loading` replaces the plain "Loading…" lines (roadmap pages, panels, tabs, dialogs); `PillLoader` sits in the "Saving…" indicators, the pending state of buttons (white on primary, confirm and danger buttons, blue on others), the refresh button while it reads the roadmap, and the sync dialog while it checks or writes. The browser tab title starts with "Syncing…" during a sync; the favicon stays still. GitHub and Jira share the sync dialog, so both have it (tracker parity).
- **Not chosen**: Sweep, Breathe and Capsule bars. Not built from the "other places" list: empty states, import progress capsules, the gate-decided capsule.
