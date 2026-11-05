---
bump: minor
---
**Business Value Type and Planned Quarter labels, Focus Area into Jira.** Roadmap Category is now hidden in the app (kept in the data; nothing is deleted). Its optional label moves to Business Value Type: `pv:value/<type>` on GitHub and Jira, off by default per project, and only the type is sent, never the amount. Planned Quarter is sent as a label such as `pv:quarter/q3-2027` on both trackers, on by default and switchable off. On Jira, Focus Area can also be written into a text field you choose, such as Theme (Settings, Integrations, Jira, Field configuration). The Help columns table is updated. Migration `20261105162014_value_quarter_labels_focus_field.sql`.
