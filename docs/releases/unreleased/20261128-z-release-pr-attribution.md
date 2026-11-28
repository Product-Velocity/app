---
bump: patch
type: fixed
---
**Fix: queued release notes keep each pull request's own number.** When the release workflow catches up on fragments from more than one merged pull request at once, each row in the release log now records the pull request that introduced that fragment instead of stamping the latest pull request onto all of them. Developer tooling only; nothing changes in the app.
