# Release fragments

**Do not bump `version` in `apps/web/package.json` and do not edit `docs/RELEASES.md` in a feature PR.** Two PRs doing that at the same time always collide on the number and on the top row. Add one fragment here instead; when the PR is merged into `main`, `tools/release/assemble.mjs` (run by `.github/workflows/release.yml`) gives it the next version, writes the row at the top of `docs/RELEASES.md`, bumps `package.json` and deletes the fragment.

File name: `YYYYMMDD-short-slug.md` (fragments become versions in file-name order). Content:

```
---
bump: minor
---
**Title in bold.** What changed, for the person who uses the product, in a few sentences. Mention a migration by name when there is one.
```

`bump: minor` for a feature, `bump: patch` for a fix. The text becomes the "Key updates" cell, so write it as one paragraph without a table. The PR description says "version assigned when merged" instead of a number.

To try it locally: `node tools/release/assemble.mjs --pr "#123"` (it edits `docs/RELEASES.md` and `apps/web/package.json` and removes the fragments; do not commit that in a feature PR).
