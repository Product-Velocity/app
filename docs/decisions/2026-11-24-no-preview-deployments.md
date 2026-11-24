---
date: 2026-11-24
by: Ashu
---
**No preview deployments: only `main` deploys to Vercel.** Every PR created a preview (and the merge queue another), then two production deployments (the merge commit and the release commit), which hit the Hobby plan's daily deployment limit and left production on v1.225.0 while `main` was at v1.227.0. `git.deploymentEnabled` in `apps/web/vercel.json` is `{"**": false, "main": true}` (a branch that matches any `true` rule still deploys; `**` is needed because branch names contain slashes). Lost: the PR preview URL and the Vercel bot comment. Not changed: the release commit still deploys (it carries the version number); skipping the merge-commit build was offered and not chosen. Pro (go-live item 7c) removes the limit.
