---
bump: patch
---
**Atlassian test page: write test for Jira (spike J4, issue #257).** A separate link on the admin test page creates a test Epic and a child Story in a Jira software project, edits them, moves one through a workflow transition, reads them back and deletes both, then checks that the refresh token works. It never touches a Product Discovery project and lists anything it could not delete. The page and its two routes are now limited to workspace admins. No migration.
