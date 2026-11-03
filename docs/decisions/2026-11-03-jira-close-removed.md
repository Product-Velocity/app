---
date: 2026-11-03
by: Ashu (choice of 2026-11-03: "label and close"), built by Claude
request: 67
---
**When an initiative is deleted in Product Velocity, Sync with Jira offers to label and close the Jira issue that Sync created.** Before this, a delete moved the initiative to the Trash and never touched Jira, so its issue stayed open as an orphan. Ashu chose "label and close" over "leave it" and "label only".

## The exception to rule 6, stated precisely
CLAUDE.md rule 6 says status is tracker-driven and Product Velocity never sets it. This is the **only** place Product Velocity writes a status to Jira, and only when ALL of these hold:
1. the initiative is **in the Trash** (`items.deleted_at` set; a restored initiative is never offered);
2. its Jira link is in mode **`push`** (Product Velocity owns the issue). A link in mode `follow` (the issue came from Jira, read only) is **never** touched, in the app and in the database function;
3. it was **not handled before** (`item_jira_links.removed_handled_at` is null);
4. a **creator or admin** confirmed **that initiative** in the "Removed in Product Velocity" section of the Sync with Jira preview, after seeing what will happen. Nothing is written before. Claude (MCP) has no tool for it, a service account is refused by the server action and again by the database function, platform staff are refused (rules 3 and 10);
5. the transition's target status is in the Jira **status category `done`**. Status names mean nothing; the category does.

What stays true: Build Status stays read-only and comes from Jira; **Initiative Status is untouched** (set by people only); no transition happens anywhere else (`transition-guard.test.ts` fails if another file builds a `/transitions` request or imports `jira-close.ts`, and `outbound-allowlist.test.ts` still says create/update payloads carry no status); there is **no delete** of a Jira issue and no reopen (the request type has no DELETE).

## What happens, per confirmed initiative (one at a time, "Writing x/y")
1. Read the issue's status and `GET /issue/{key}/transitions` (reading again at confirm; a choice that is not a Done transition of this issue right now is refused before any write).
2. Add the label `pv:removed` with Jira's `update.labels.add` (every other label stays).
3. Close: exactly one Done transition: use it. Several (for example Done and Won't do): the person chooses in the preview, and the chosen Done **status** is remembered per Jira project (`jira_project_links.removed_close_status_id`) and preselected next time. None: label only, and the result says no transition to a Done status exists. The issue already in a Done status: label only.
4. Record it (`jira_record_removed`, service role only, audited as the person, source UI): result `closed`, `labeled`, `already_done` or `not_found`. The record is made only when the work is complete.

**Refusals.** Workflows differ per project and Jira may refuse (a required field such as Resolution): the refusal is shown with Jira's words on that initiative, the label stays, nothing is recorded and nothing is retried by itself; "Try again" is a person's click and re-adds the same label harmlessly. An initiative that keeps being refused stays on the list; untick it, or close the issue in Jira (the next Sync sees it Done and records `already_done`). 429 and 503 back off as in `jira-write.ts`; 401 and a lost sign-in say "sign in again" and stop. An issue Jira no longer returns is recorded as `not_found` (nothing to close, not offered again).

## Decisions made on the way
- **Restored after closing.** Product Velocity never reopens the issue. The label stays (a later send keeps `pv:removed`: it is the one `pv:` label that is not stripped), and the Sync preview of that initiative says the issue was labelled and closed when it was removed and to reopen it in Jira if the work continues. A restore before the person confirmed offers nothing.
- **Deleted again later.** Handled once is handled for good; it is not offered a second time.
- **Trash purge.** After 30 days the Trash is purged and the link goes with it; an unhandled issue is then no longer offered. Confirm within the retention window.
- **Adopted issues.** An issue that came from Jira and was adopted ("PV takes ownership") has mode `push`, so it is offered like a created one. The preview shows the key, the link and the current Jira status so the person sees what they close. Ashu to decide whether adopted issues need a stronger warning.
- **Migration not applied.** The new columns are read apart from everything else; without them the section offers nothing and writes nothing, and the rest of Sync is unaffected.
- **GitHub.** Not built. The dialog section and the `RemovedApi` shape are not Jira-specific; a GitHub version would close the tracking issue as "not planned" with a label, which needs no workflow logic. A separate request.

## Not verified here
Jira cannot be reached from the build environment; everything is tested against a fake Jira. Only a run on a real site shows: that a real workflow lists its Done transitions as read here, which projects refuse the transition (required fields on the transition screen), and a real 429. The older spike J4 (`write-test.ts`) also transitions and deletes its own test issues; it is not part of Sync and is listed by name in the guard test.
