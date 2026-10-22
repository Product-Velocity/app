---
name: Work item
about: A unit of work Claude Code (or a person) can pick up with /work-issue
title: "[Phase N] "
labels: ["work-item"]
---

## Outcome
<!-- One or two sentences: what can a user do when this is done? -->

## Context
- Phase: <!-- docs/06-BUILD-PLAN.md -->
- PRD section: <!-- docs/01-PRD.md §x -->
- Prototype board(s): <!-- docs/07-PROTOTYPE-MAP.md -->
- Related docs: <!-- 03 data model / 04 sync / 05 AI -->
- Depends on: <!-- #issue -->

## Acceptance criteria
- [ ] <!-- observable, testable -->
- [ ] RLS tests for every new/changed table
- [ ] Writes appear in the audit log with correct actor and source
- [ ] Unit tests for domain logic; e2e test for the main path
- [ ] Keyboard path works; text labels not colour-only; AA contrast
- [ ] Docs updated if behaviour changed

## Out of scope
<!-- Explicit non-goals -->

## Risks / spikes
<!-- Unverified assumptions; link to docs/08 spike IDs -->

## Security and privacy check
- [ ] Tenant-scoped queries
- [ ] No commercial field leaves the app (GitHub, customer-safe reports)
- [ ] Claude/service identities cannot perform approval-class actions
- [ ] No PII/tokens in logs
