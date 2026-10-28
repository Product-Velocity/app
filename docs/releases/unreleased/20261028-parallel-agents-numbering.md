---
bump: minor
---
**Several agents can now work on Product Velocity at the same time without colliding on numbers (issue #238).** Migrations are named by timestamp (`pnpm db:new <name>` creates one; the old 0001 to 0058 set is frozen). A feature no longer bumps the version or edits the release log: it adds a small fragment, and the version is assigned when it is merged. New requests and decisions are one file each, named by the GitHub issue number. No change to the app itself.
