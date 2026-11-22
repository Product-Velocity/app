---
date: 2026-11-22
by: Ashu
request: 565
---
**The connector offers the animated Rank loader as its icon, as an experiment.** Ashu asked whether the PV icon Claude shows while a Product Velocity action runs could be the animation instead of the static square. The MCP server's `serverInfo.icons` is a list of static image addresses; the assistant chooses which one it shows and whether it moves, and the server cannot tell it to animate only while an action runs. So the animated SVG `public/brand/pv-rank-loader.svg` (the logo's fifteen pills, no tile, logo blue, about 1.5 s, 90 ms apart in reading order, still under reduced motion, no script; brand guide "Loading and sync") is now the **first** icon in the list, with the three static icons after it as fallbacks.

- **What to look for after reconnecting:** which icon Claude shows in the connector list and next to a running tool, whether it moves, and whether it moves all the time (likely, since the image loops by itself) or only while working. If it is distracting, or Claude shows it badly, **delete the first entry** in `serverInfo()` (`apps/web/src/lib/mcp/rpc.ts`); nothing else depends on it.
- **The Claude directory listing** keeps its own icon, uploaded in the portal (`docs/30-DIRECTORY-SUBMISSION.md`); this change does not touch it.
- **The loader itself stays in the brand guide** (Ashu, 2026-11-22: he does not reject the animation; he was not happy with how it was applied in the app, which is why PR #435 was rolled back on 2026-11-14, `2026-11-14-pill-loader-rollback.md`, and a better use for it will be found). The guide now lists the connector icon as a trial use and keeps the SVG as an asset.
