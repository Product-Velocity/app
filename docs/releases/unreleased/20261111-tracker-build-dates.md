---
bump: minor
---
**Start Building and Build Completed now come from Jira.** For an initiative linked to a Jira issue, Start Building is the day the issue or one of its children first moved into In Progress (or Done) in Jira, and Build Completed is the issue's resolution date, so build days now work for Jira like they do for GitHub. Initiatives already in progress fill in the next time Jira is read (Sync with Jira or the daily check). Jira's own Start date fields are not used. Start Building is now also a column of the default Delivery view. The Jira tab shows the dates; if they cannot be read, the Sync card says why. GitHub's start date follows in issue 422. Migration `jira_build_dates`.
