## Summary
<!-- What changed and why. -->

## Checks
- [ ] Tests added or updated
- [ ] RLS tests for any new table
- [ ] Release fragment added in `docs/releases/unreleased/` (version assigned when merged)
- [ ] Parity line: built for both GitHub and Jira, or the exception, its reason and a linked issue

## Database
Tick exactly one. A PR with a new file in `packages/db/migrations/` cannot merge until the first is ticked (the "Migration gate" check), because an unapplied migration makes every production deploy fail.
- [ ] Migration applied to production
- [ ] No migration in this PR
