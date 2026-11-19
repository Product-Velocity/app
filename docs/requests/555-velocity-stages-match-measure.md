---
issue: 555
status: done
logged: 2026-11-19
done: 2026-11-19
link: PR for issue 555 (the release version is assigned when merged)
title: Velocity report: the stages must add up to the measure
---
Ashu, 2026-11-19, with two screenshots (Build, by Team): the top chart says 120 d on average, "Where the time goes" right below says Build 0 d for the same team. Cause: the later phase dates of the initiatives are the same day as Start Building (or before the build time ends), so every stage spans zero days. Fixed: time inside the window that no stage covers is counted in the work stage the window starts in, so the stages always add up to the measure. See issue 555.
