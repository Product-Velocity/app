---
bump: patch
---
**Jira write test succeeded; results recorded (spike J4, issue #257).** Creating an Epic with a rich description, linking a child through the parent field, editing labels and description, setting a custom field and moving an issue through the workflow all work with the Jira write scope, and the description structure round-trips. Findings for the build: issue types differ per project, status must be read by category, and Atlassian's refresh token rotates so the connection must store each new one safely. Documentation only.
