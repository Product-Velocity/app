---
issue: 324
status: done
logged: 2026-11-05
done: 2026-11-05
link: PR for issue 324
title: Hide Roadmap Category; Business Value Type and Planned Quarter as labels; Focus Area into a Jira text field
---
Ashu (2026-11-05): hide, but do not remove, the Roadmap Category field for now from the Product Velocity user view; move its label sync to Business Value (it holds almost the same information); update Help. Planned Quarter: also sync to the labels/tags on both delivery platforms. Focus Area: next to the label on Jira, also sync it to the Jira "Theme" field. Asked and answered: "Business Value" means Business Value Type (the amount stays private). Built: `HIDDEN_FIELDS` in the domain package, labels `pv:value/<type>` (off by default) and `pv:quarter/<quarter>` (on by default), a Focus Area field mapping for Jira, migration `20261105162014_value_quarter_labels_focus_field.sql`, Help. Follow-up (Ashu, same day): Leadership chart uses Business Value Type; pv:value label on by default; Focus Area goes into Jira Theme and the Initiative Group only into labels (migration `20261105163916_value_label_default_on_theme_is_focus.sql`). Decision in `docs/decisions/2026-11-05-value-type-and-quarter-labels.md`. Apply the migration (it replaces `tracker_set_field_config` and `jira_set_field_map`).
