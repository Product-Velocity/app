---
bump: patch
---
**Sync no longer asks the same conflict again and again for a newly pulled-in issue.** An issue that Product Velocity owns but has never written to has no Product Velocity block yet, and Sync reported that as a conflict on every run; choosing Keep GitHub recorded nothing, so it returned each time. It is now an ordinary "To send": the first send adds the block and keeps the text already in the issue. A block that was edited in GitHub, or one that vanished after a send, is still a conflict.
