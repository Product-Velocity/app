---
bump: minor
---
**Changes report, and more flags in Needs attention.** Reports has a new Changes report: which initiatives changed today, this week or this month, grouped by initiative, filtered by change type (Phase, Status, Health, Build status, linked GitHub or Jira issue), with the exact time each change was registered, where it came from and who made it, and whether the initiative itself moved or only its linked issues. Needs attention now also flags an initiative still in Build when every linked issue is closed, a Completed initiative with open work, a phase ahead of the build, stale issues and a missing Health. New database function `change_feed` (migration 20261117105842_change_feed.sql).
