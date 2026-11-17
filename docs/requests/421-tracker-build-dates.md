---
issue: 421
status: open
logged: 2026-11-11
title: Start Building and Build Completed from the tracker's own dates
---
Ashu, after seeing R8P-7049: Build Status is In progress but Start Building is empty, and Jira has no Build Completed. Decided 2026-11-11 (`docs/decisions/2026-11-11-tracker-build-dates.md`): the tracker's real start and completion, read from history, with the in-progress or done status category; Jira's own Start date fields are not a source; backfill on the next read. Jira is built in this request; GitHub's start signal is issue 422.

Product Velocity initiative: group "Delivery platform sync fields expansion".
