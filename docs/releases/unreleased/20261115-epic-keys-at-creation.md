---
bump: minor
---
**Epic keys at creation.** On the Jira tab of an initiative you can now list the Jira epics that belong under it (type or paste keys or links, from any Jira project). Nothing is written to Jira when you add them. Sync with Jira then shows each epic in the initiative's card, with what would happen to it (gets the Initiative as its parent, moves from another parent, already there, or why it cannot, for example it is not an epic or not visible). After you confirm, Product Velocity creates the Jira Initiative if it does not exist yet and sets each epic's parent to it, and nothing else on the epic. An epic Jira refuses is shown with Jira's reason and offered again next time. Adds the table `item_jira_epic_requests` and three functions (migration `jira_epic_requests`).
