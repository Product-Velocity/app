---
bump: patch
type: fixed
---
**GitHub permission errors name the right permission.** When the GitHub App was refused while reading pull requests or the checks of a branch, the log said to grant the Organization Projects permission, which sent admins to the wrong setting. It now says Pull requests (read), or Checks and Commit statuses (read). The Projects message stays for the Projects boards.
