---
date: 2026-11-05
by: Ashu (2026-11-05: Tags, Focus Area and Roadmap Category; Ready for Build and Agent-ready dropped for now), built by Claude
request: 321
status: built, to confirm
---
**Tags, Focus Area and Roadmap Category can be sent as labels to GitHub and Jira, per project, off by default (issue #321).** The field dictionary already says "Optional: push as label (off by default)" for these.

- **Labels.** `pv:tag/<tag>` (one per tag, sorted, no duplicates, at most 10), `pv:focus/<value>`, `pv:category/<value>`. Value as a slug (lower case letters, digits and hyphens, at most 40 characters), the same rule as `pv:group/…`. They are in the `pv:` namespace, so Sync adds those that apply and removes those that stop applying; labels people added are never touched.
- **Off by default.** The three are switches in the field configuration (new slots `github.label.tags|focus|category`, `jira.label.tags|focus|category`) that are OFF until a person turns them on. With nothing saved, payloads are identical to before (pinned by tests). This needed the slot model to know a default: `Slot.defaultOn`; the saved table keeps a row only when a switch differs from its default (migration `20261105150159_optional_field_labels.sql` replaces `tracker_set_field_config`; same permission rules).
- **Allowlist (rule 2).** `focus_area`, `roadmap_category` and `tags` are added to both outbound allowlists. They are strategy and filing fields, not commercial ones; they leave only as labels and only when switched on. **To confirm:** a Roadmap Category value such as "Grow customer revenues" is visible to anyone who can read the issue (repositories can be public). Leave that switch off for public repositories.
- **Read.** Tags are read from `item_tags` (kind tag) in both engines, Focus Area and Roadmap Category from their columns.
- **Parity.** Built for both trackers in the same change.
- **Not built: Ready for Build and Agent-ready.** Dropped by Ashu for now. Both are phase 4 and not stored (no `agent_ready` column; `ready_for_build` is a constant null in the item view), so there is nothing to send until the fields exist.
- **Not verified here:** a real Sync with these labels on a real GitHub repository and Jira site (the fake source and the fake Jira only).
