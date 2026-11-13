---
date: 2026-11-12
by: Ashu ("go ahead with the cleanup and the ignored build step"), written by Claude
status: built
---
**Vercel skips builds for commits that cannot change the app.** The free team hit 75% of the 10 GB Function Storage limit (Vercel email, 2026-11-11) with about 100 deployments in two days; over the limit Vercel deletes older deployments.

- **How.** `ignoreCommand` in `apps/web/vercel.json` runs `tools/vercel/ignore-build.sh`. It skips only when every changed file is under `docs/`, `prototype/`, `spikes/`, `skills/`, `.github/` or is a root-level `.md`. Anything else, `docs/RELEASES.md` (read by `next.config.mjs`), an unknown base commit or a git error builds.
- **Limit.** On a preview, a push of several commits is compared from the previous deployed commit when Vercel provides it, otherwise only the last commit.
- **Still to do by hand (Vercel dashboard, Project `app`, Settings, Build and Deployment, Deployment Retention):** Errored and Canceled 1 week, Preview 1 month, Production 3 months. Existing deployments are not removed by this PR.
