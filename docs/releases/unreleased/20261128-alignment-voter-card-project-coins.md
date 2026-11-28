---
bump: minor
type: new
---
**Voters can open a card with more about each initiative, and a project can set the coins its votes start with.** Under each initiative a closed "More about this initiative" control opens its Business Line, Business Value and Effort; before a session opens, an admin chooses which of the three voters can open (Business Value is a commercial number, so it can be left out), and what voters saw is fixed when the session opens. Settings, Workspace, Projects now has coins per voter and the most on one initiative for each project; a new 100-coins vote starts with them when all its initiatives belong to one project, and can still be changed on the draft. A voter who sees the results after the close now also sees their own MoSCoW choice. Migration `20261128123206_alignment_voter_card_project_coins`.
