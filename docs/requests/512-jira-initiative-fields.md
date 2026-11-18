---
issue: 512
status: in progress
logged: 2026-11-18
title: Jira Initiative fields: Health, Initiative Status and Phase mapped to Jira custom fields
---
Ashu, 2026-11-18: the RR Jira Initiative has its own status (Backlog, WIP Research, Done) that has nothing to do with Build Status. He wants custom fields on the Jira Initiative with the same values as Product Velocity (phase, health, initiative status), set both ways when either side changes, with detection of the fields, a mapping to a Product Velocity field, a direction per field and a map of the dropdown values (as for MoSCoW). Decided in the same conversation: **amend rule 6 for Initiative Status**; build slices 1 to 5 (Health, Initiative Status, Phase, docs, GitHub parity). See `docs/decisions/2026-11-18-jira-initiative-fields.md`.

Built in the PR for #512: slices 1 to 4 for Jira. **Slice 5 (GitHub parity) is not built**: issue #513 (a Projects v2 single-select field per value, the same card and the same flagged conflicts).
