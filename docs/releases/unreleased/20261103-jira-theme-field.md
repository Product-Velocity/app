---
bump: minor
---
**Initiative Group into the Jira Theme field.** In Settings, Integrations, Jira, Field mapping, an admin can now choose a single-line text field of the Jira site (the one named Theme is listed first) to receive the Initiative Group name, in addition to the `pv:group/<name>` label. Sync shows "Theme not sent" in its preview when the field is not mapped, and offers the newly mapped field on the next Sync. Dropdown and paragraph fields are not offered yet. Needs the migration `jira_theme_field_map`.
