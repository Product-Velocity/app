# Requests

One file per change request from Ashu. **The request id is the GitHub issue number**: create the issue first (it gives the number, so two agents can never pick the same id), then add `docs/requests/<issue>-short-slug.md`.

```
---
issue: 238
status: open
logged: 2026-10-28
title: Short name of the request
---
What was asked, in Ashu's words where possible, and anything decided in the same conversation.
```

`status` is `open`, `in progress`, `done` or `blocked`. When you finish one, set `status: done` and add two lines to the header: `done: 2026-10-29` and `link: PR #240` (release version if there is one). To find what is open: `grep -l "status: open" docs/requests/*.md`.

Requests up to R-115 live in `docs/REQUESTS.md` (an archive: any row still `open` or `in progress` there is still yours to pick up, and is finished in that table). New requests are files here. Times are Europe/Madrid. A test checks that the ids are unique and the headers valid.
