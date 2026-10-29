---
bump: patch
---
**Accessibility and keyboard fixes found by the browser tests (issue #270).** The two text-size buttons (A− and A+) now start their accessible name with the text you see, as WCAG asks. In the Columns panel, moving a column up or down no longer closes the panel, and the focus stays on that column's arrow so you can press it again. J and K in the side panel keep up when pressed quickly (and the first J right after opening is no longer lost). The delete confirmation takes the keyboard focus before it is shown, so Escape pressed at once closes it. Tests that still described removed or renamed screens (Delivery view columns, Leadership value header, Reports tab, logo) were brought in line, and the browser suite now passes. No migration.
