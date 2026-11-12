---
bump: patch
---
**Fewer wasted builds.** Changes that only touch docs, prototype boards, skills, spikes or GitHub workflow files no longer trigger a Vercel deployment, which keeps the free Function Storage allowance from filling up. Any change to the app, the database, dependencies or `docs/RELEASES.md` still builds.
