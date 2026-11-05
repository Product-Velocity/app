---
bump: minor
---
**Business Value Type and Planned Quarter labels, Focus Area into Jira Theme.** Roadmap Category is now hidden in the app (kept in the data; nothing is deleted) and the Leadership investment mix uses Business Value Type instead. Business Value Type is sent as `pv:value/<type>` on GitHub and Jira, on by default and switchable off per project; only the type is sent, never the amount. Planned Quarter is sent as a label such as `pv:quarter/q3-2027`, also on by default. On Jira the Theme field you choose now receives the Focus Area; the Initiative Group goes only into its label. The Help columns table is updated. Migrations `20261105162014_value_quarter_labels_focus_field.sql` and `20261105163916_value_label_default_on_theme_is_focus.sql`.
