---
date: 2026-11-24
by: Ashu (2026-11-24, chat), built by Claude
request: 665
---
**Tracker-driven columns name the tracker the data really comes from, the lock sits once in the column header, and the Delivery Progress bars line up.**

- **Header words.** "from Jira", "from GitHub" or "from GitHub or Jira", following the trackers the workspace's projects use (`trackerWords`); with no project linked yet it follows what is connected.
- **Cell words.** An empty tracker value says it in the words of the initiative's own tracker (its own link first, then its project's): Build Status "Not in Jira" / "Not on GitHub" / "Not linked"; Delivery Status "GitHub only" on a Jira initiative (it is a GitHub board field; amended 2026-11-24, Ashu), "Not on a board" otherwise. The item panel uses the same words.
- **Lock.** A small lock sits in the header of every read-only tracker column, next to the "from ..." words (tooltip "Read only: from Jira"); the rows no longer repeat it. The cell tooltip still gives the reason. The footer line says "A lock in a column header means the values come from Jira".
- **Delivery Progress.** The percent has a fixed width, so 0% and 100% do not move the bar, and the lock that took the room ("100%...") is gone.
- **Delivery Status is GitHub only** (Ashu, 2026-11-24): its header always says "GitHub only", never "from Jira", because the field dictionary sources it from the GitHub Projects board Status (`gh_project_status`). Parity exception: Jira has no board-status equivalent we sync.
