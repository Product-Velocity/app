---
issue: 413
status: open
logged: 2026-11-11
title: Delivery platform sync fields expansion
---
Ashu, after seeing the Jira field list (303 fields): the tracker's field list should be the basis of what to sync from Product Velocity and to where, with the linked Product Velocity field and the sync direction per field. Slice 1 is built (search, filter, sort, linked field, direction; `docs/decisions/2026-11-11-tracker-field-table.md`). This request is the rest: let a person link more tracker fields, such as Jira Story point estimate to Effort, Assignee, Components, Fix versions and Sprint, and the same on GitHub.

To decide first (write it in `docs/decisions/`): which tracker fields get a Product Velocity field and whether the dictionary grows; direction and conflict rules per link; which stay read-only because the tracker drives them (rule 6); per-project scope. Never commercial fields (rule 2); Initiative Status is never set by a tracker. Same flow on Jira and GitHub (parity), GitLab later.

Product Velocity initiative: group "Delivery platform sync fields expansion".
