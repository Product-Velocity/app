---
date: 2026-11-14
by: Ashu, written by Claude
request: 434
---
**The Rank pill loader (PR #435, release 1.143.0) is rolled back; Ashu did not like how it turned out.** The merge commit is reverted, so the plain "Loading…" lines, "Saving…" labels and the original refresh spinner are back, and `docs/decisions/2026-11-13-pill-loader.md` and `docs/requests/434-pill-loader.md` are removed with it (they stay in the git history). No migration was involved. The brand guide's "Loading and sync" section still describes the Rank loader until Ashu decides what replaces it; the app does not follow it for now.
