---
date: 2026-11-03
by: Ashu (send the group into Theme as well as the label, chosen per Jira project), built by Claude
request: 67
---
**The Initiative Group name also goes into a Jira "Theme" text field, chosen per Jira project.** Extends the per-project field mapping (`2026-11-03-jira-field-map.md`): `jira_project_links.field_map` gets an optional key `theme` (a custom field id `customfield_NNNN`), set only by `jira_set_field_map` (same rules: a human workspace admin; never Claude, a service account or platform staff; migration `jira_theme_field_map` replaces that function, nothing else).

- **Text fields only, single line.** The form offers the site's custom fields whose Jira type is single-line text (`…customfieldtypes:textfield`), the one named Theme first. **Select/dropdown fields are not offered**: Jira rejects a value that is not one of its options and PV never creates options, so "send only when it matches" would silently skip most groups. **Paragraph (multi-line) fields are not offered** either: Jira's v3 API wants rich text (ADF) there and a plain string is refused. If Theme on this site is a paragraph or a dropdown, it is not in the list; say so and a later slice can add it.
- **The value** is the group name as plain one-line text: control characters and line breaks removed, whitespace collapsed, at most 255 characters (the single-line limit). It goes through the Jira allowlist (`theme` was already on it); nothing commercial is added.
- **Unmapped or empty:** an item with a group but no mapped field is sent without it and the Sync preview says "Theme not sent: …"; an item without a group sends nothing and has no note. A group that is later removed in PV is not cleared in Jira (same as Start date: PV never blanks a value a person may have typed there). The label `pv:group/<name>` is sent as before.
- Changing the mapping changes the hash of what is sent (`extrasHash`), so the next Sync offers the newly mapped field. Saving the mapping writes nothing to Jira.
- **Migration order:** until the migration is applied, saving a mapping with a Theme is refused by the database (the key is unknown) while saving without one still works; reading the mapping and Sync are unaffected (a stored `theme` is simply absent before then).
- **Not verified here:** reading `/field` from a real site, that the chosen field is on the issue type's screen (Jira refuses the write and the refusal is shown per initiative), and a real Sync into Theme.
