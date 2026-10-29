---
bump: minor
---
**Choose who owns an item you pull in from GitHub (issue #256, part 1).** On the Incoming list, next to the project, you now choose **Read only** (the default: the initiative follows the issue, as before) or **Product Velocity owns it**. You can also change your mind later: the GitHub tab of the initiative panel says who owns it and has **Take ownership** / **Make read only**, with an Undo. Taking ownership writes nothing to GitHub; the next **Sync with GitHub** shows what would be sent and waits for your confirmation. Status and progress stay read-only either way. New migration `20261029115023_link_ownership.sql` (the change is audited).
