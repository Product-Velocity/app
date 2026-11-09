---
bump: patch
---
**GitHub connections no longer get stuck at "Installed: waiting for GitHub to confirm".** When GitHub's confirmation arrived while the install page was still finishing, the page wrote the old "installing" state over "connected". It now never overwrites a confirmed connection, and it confirms the installation itself from GitHub's answer. A new **Confirm with GitHub** button lets a workspace admin finish a connection whose confirmation never arrived, without asking the owner of the GitHub App to redeliver it.
