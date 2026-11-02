---
bump: patch
---
**Atlassian test page: results recorded, less personal data shown (spikes J1 and J2).** The first real Jira connection worked (read and write scopes, refresh token, hierarchy, 81 fields). The page now counts a field as filled only when it holds a real value (Jira returns empty comment, vote and progress objects on every issue), lists an issue type name once, and no longer prints the account email, id, avatar or site address. No migration.
