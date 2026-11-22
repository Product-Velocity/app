---
issue: 609
status: done
logged: 2026-11-22
done: 2026-11-22
title: Fix the older failing Cards browser tests
---
Ashu (2026-11-22): fix the older failing cards e2e tests. All 29 tests of `apps/web/e2e/cards.spec.ts` pass. The cards test page now has the signed-in user and an in-memory store owner, and status pills on cards name their field for screen readers.
