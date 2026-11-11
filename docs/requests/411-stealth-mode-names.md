---
issue: 411
status: done
done: 2026-11-11
link: version assigned when merged
logged: 2026-11-11
title: Stealth mode: editable label names, no Product Velocity branding in GitHub and Jira
---
Ashu: in some cases PV must connect to delivery platforms in "stealth" mode: not everything written there has the "PV" or "Product Velocity" mention. The field configuration screen is the place: edit `Label pv:moscow/<value>` to `Label moscow/<value>`.

Decided with Ashu: full stealth (labels, base label, markers, removed and define labels, GitHub footer and link), edited per row plus one prefix box. See `docs/decisions/2026-11-11-stealth-names.md`.
