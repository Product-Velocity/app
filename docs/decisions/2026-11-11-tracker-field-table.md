---
date: 2026-11-11
by: Claude (for Ashu to review)
request: tracker field table (no issue number yet)
---
**The tracker's own field list is now the starting point of the field configuration, on Jira and GitHub (same flow, `2026-11-03-tracker-parity.md`).** Ashu asked for search, filter and sort on the list, to see which fields are linked to a Product Velocity field, and the sync direction of each. This is slice 1 (his choice): it changes what is shown, not what Sync sends.

1. **One table, a row per tracker field.** Columns: name, id, type, kind, options (when any), filled in sample (Jira), **Linked to Product Velocity field**, **Sync direction**. Directions: Product Velocity to tracker, tracker to Product Velocity (read only), both ways, not synced. A field no slot names says "Not linked: ignored by Sync".
2. **Derived, not new.** Links come from the slots and the person's saved settings (`tracker-fields/links.ts`), so the table can never disagree with what Sync does. Commercial fields have no slot and cannot appear (a test pins it, rule 2). A link switched off shows "switched off"; one that needs a choice (Jira priority) shows "not set up yet" and counts as not synced. A link on in some projects of the same connection only says "on in <projects>".
3. **Search, filter, sort** (client side, `table-query.ts`, tested): search over name, id, options and linked field; filters for type, system/custom and sync (used, a direction, not synced); header click sorts ascending, descending, then back to the tracker's order; empty values go last. Lists of 8 or fewer fields stay plain.
4. **Order on the page:** tracker fields first, then the table of Product Velocity fields (the editor, unchanged). Editing stays there: one editor per setting.
5. **Not in this slice (needs a decision):** linking more tracker fields (Story points to Effort, Assignee, Components, Fix versions) needs new slots, engine changes in both directions, conflict rules and the same on GitHub. Jira's 303 fields are site-wide; only the fill rate and options are sampled from the linked project.
6. Also fixed a stale label in the GitHub e2e test (issue type now says "Feature, Improvement or Bug").
