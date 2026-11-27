---
bump: patch
type: fixed
---
**Fix: the Product Manager as the Jira assignee of a new issue also works for people without an account.** A Product Manager who is in the people directory but has no account, or no email, was not found, so the assignee stayed empty. The person's own email is now used, and with no email Jira can match, their exact name, but only when exactly one Jira user has exactly that name. The Sync preview shows who would be assigned, and says when it was matched by name, before anything is written.
