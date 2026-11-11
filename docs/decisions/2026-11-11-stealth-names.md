---
date: 2026-11-11
by: Ashu (stealth scope and editing, 2026-11-11), built by Claude
request: 411
status: built, to confirm
---
**Stealth mode: the names Product Velocity writes to GitHub and Jira can be changed per project, so nothing in the tracker has to say "pv" or "Product Velocity" (issue #411).** Ashu: "in some cases I want to connect PV to delivery platforms in stealth mode"; he chose full stealth, edited per row plus one prefix box.

- **Where.** The field configuration form of each project, the same on GitHub and Jira (parity). Each label row gets a text (`pv:moscow/` becomes `moscow/`, then the value). A **Names** block under the table has: "Prefix for all labels" with "Apply to all labels and save" (an empty prefix gives `moscow/<value>`), the base label (a switch and a text; off = none), the removed label, the define label, the Jira hidden item label or the GitHub marker word, and on GitHub "Hide the Product Velocity name".
- **What changes.** Value labels (`project`, `moscow`, `rank`, `type`, `group`, `focus`, `value`, `quarter`, `tag`), `product-velocity`, `pv:removed`, `pv:define`, Jira's `pv:item/<hash>`, GitHub's `<!-- pv:begin -->` / `<!-- pv:end -->` words, and with "Hide the name" the GitHub footer (replaced by a neutral sentence, no link back to the app) and the description of labels and milestones we create (empty). Jira descriptions carry no Product Velocity text, so there is no switch there.
- **Defaults unchanged.** With nothing saved every payload is identical to before (pinned by tests). A saved name changes the issue hash, so the next Sync rewrites the issue.
- **Ownership (the one real risk).** A push removes labels it owns that no longer apply. Owned = the current names, **and always the old `pv:` namespace and `product-velocity`**, so switching to other names cleans up what was sent before. The removed label is never taken off. Consequence: with a custom prefix such as `moscow/`, any label on the issue that starts with a prefix we manage is ours and is removed when it no longer applies. Choose prefixes people do not use by hand. Names changed twice leave the first set behind (only `pv:` is always cleaned).
- **Rules for a name.** Labels: letters, digits and `: _ . / -`. Prefix 2 to 30 characters ending in `/` (a missing slash is added); two prefixes can not be the same; base, removed and define at most 50 and different from each other; marker word lower case, 1 to 20. The database checks the same shapes (`tracker_set_field_config`, column `tracker_field_config.label_text`).
- **Reading.** The managed block is found under any marker word and both footers, so issues written under old names are still read, merged and replaced.
- **Not hidden (cannot be).** The item code in the GitHub issue title (`PV-12: Name`), the Jira marker hash, a GitHub issue's history, and anything people write. The tracker's audit log shows the GitHub App's name. If the App itself must be neutral, rename it in GitHub.
- **Not verified here:** a real Sync on a real GitHub repository and Jira site (fake sources only).
