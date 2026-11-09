---
bump: patch
---
**Fix: Cards view filter name type check and `/api/version` static bundle trace.** Fixed the `base.name` TypeScript check on the Cards screen when the "All" view is active, and removed runtime filesystem tracing from `/api/version` so Vercel builds cleanly using the build-time release metadata.
