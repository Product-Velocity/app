---
date: 2026-11-03
by: Ashu (parity instruction 2026-11-03: GitHub and Jira do the same), built by Claude
request: 67
---
**When an initiative is deleted in Product Velocity, Sync with GitHub offers to label and close the GitHub issue that Product Velocity owns.** This is the GitHub twin of `2026-11-03-jira-close-removed.md` (gap (c) of `2026-11-03-tracker-parity.md`), with the same boundaries and the same words. Before this, a delete moved the initiative to the Trash and never touched GitHub, so its tracking issue stayed open as an orphan.

## The exception to rule 6, stated precisely
CLAUDE.md rule 6 says status is tracker-driven and Product Velocity never sets it. This is the **only** place Product Velocity writes a status to GitHub, and only when ALL of these hold:
1. the initiative is **in the Trash** (`items.deleted_at` set; a restored initiative is never offered);
2. its GitHub link is in mode **`push`** (Product Velocity owns the issue: the tracking issue it created, or an issue it adopted). A link in mode `follow` (the issue is only followed, read only) is **never** touched, in the app and in the database function;
3. it was **not handled before** (`item_github_links.removed_handled_at` is null);
4. a **creator or admin** confirmed **that initiative** in the "Removed in Product Velocity" section of the Sync with GitHub preview, after seeing what will happen. Nothing is written before. Claude (MCP) has no tool for it; a service account and a write whose source is MCP are refused by the server action and again by the database function; platform staff are refused (rules 3 and 10);
5. the repository is one the app may write to: **not marked read-only** in Settings > GitHub and still available through the connection (the same boundary as a push).

What stays true: Build Status stays read-only and comes back from GitHub (a closed-as-not-planned issue is read back as **Cancelled**, as the app already does for any issue closed that way); **Initiative Status is untouched** (set by people only); the write carries no field of the initiative (rule 2: the payload is the label `pv:removed` and `{state: closed, state_reason: not_planned}`, tested with a sentinel in every one of the 165 fields); there is **no delete** of an issue, **no reopen** and no comment. Closing is allowed in exactly one file: `lib/github/github-close.ts`, used only by `github-removed-engine.ts`, called only from `portfolio/github-removed.ts` (`close-guard.test.ts` fails otherwise, the way `transition-guard.test.ts` does for Jira).

## What happens, per confirmed initiative (one at a time, "Writing x/y")
1. Read the issue (open or closed, and why) just before writing.
2. Add the label `pv:removed` (the label is created in the repository first when it is missing; GitHub's "add labels" keeps every other label).
3. Close: an **open** issue is closed with `state_reason` **`not_planned`**. Recommended and chosen because the work was removed, so "not planned" is the truthful reason, and the app already reads it back as Cancelled; no existing rule says otherwise (`completed` would read back as Done, which would be false). An issue that is **already closed** (completed, not planned or duplicate): label only, its close reason is left as it was.
4. Record it (`github_record_removed`, service role only, audited as the person, source UI): result `closed`, `already_done` (closed already, label only) or `not_found`. The record is made only when the work is complete.

**Refusals and limits.** GitHub may refuse (for example a protected repository): the refusal is shown on that initiative, the label stays, nothing is recorded and nothing is retried by itself; "Try again" is a person's click and re-adds the same label harmlessly. An issue GitHub does not return (404/410) is recorded as `not_found`: nothing is recreated and it is not offered again. **Rate limits (429, or 403 with Retry-After):** a wait of up to 10 seconds is waited out, at most twice; a longer one stops with "try again in about N seconds" (the existing GitHub write code never waited at all and said the same). **A token that expired or an app without permission:** 401 and a failed installation token say "Reconnect GitHub (Settings, Integrations, GitHub)" and stop reading further initiatives; 403 without Retry-After says the App needs the Issues permission with write access. Nothing is written in either case.

## Decisions made on the way
- **The label `pv:removed` and the `pv:` namespace.** It is in the `pv:` namespace (Product Velocity's own labels), so it follows the same rule: only Product Velocity writes it. It is the one `pv:` label that a later push does **not** strip (`REMOVED_LABEL` is exempt in `pushTrackingIssue`), because it records that Product Velocity closed the issue, even if the initiative is restored. Labels outside `pv:` are never touched.
- **Restored after closing.** Product Velocity never reopens the issue. The label stays, and the Sync preview of that initiative says the issue was labelled and closed when it was removed and to reopen it in GitHub if the work continues. A restore before the person confirmed offers nothing.
- **Deleted again later.** Handled once is handled for good; it is not offered a second time.
- **Trash purge.** After 30 days the Trash is purged and the link goes with it; an unhandled issue is then no longer offered. Confirm within the retention window.
- **Adopted issues (same as Jira: stronger warning, in red).** An issue that came from GitHub and was adopted ("PV takes ownership", `item_set_link_mode` / pull-in with ownership) has mode `push`, so it is offered, but its card carries a red warning ("this issue was in GitHub before Product Velocity took it over. Closing it ends real work there") and its checkbox is **not ticked** by default. GitHub records adoption the same way Jira does: `items.source` starts with **"GitHub issue "** (set by `tracker_pull_in`, e.g. "GitHub issue #12"); the engine reads that one column with the server client because deleted rows are invisible to the person's own reads. An initiative later switched back to read-only (`follow`) is not offered at all.
- **Links without an issue number** (a failed first push) have nothing to close and are not offered.
- **Migration not applied.** The new columns are read apart from everything else; without them the section offers nothing and writes nothing, and the rest of Sync is unaffected.
- **Shared code.** The card model (`RemovedCard`), `RemovedApi`, the section component and `willText` are shared; the permission gate is shared (`lib/tracker/removed-gate.ts`); `SyncApi.removed` is now per tracker. The tracker-specific parts (what to read, what to write, wording of states) are separate files. Jira's behaviour and tests are unchanged.
- **Jira gets the same MCP-source check (Ashu, 2026-11-04).** `jira_record_removed` now also refuses a write whose source is MCP (migration `20261104090419_jira_record_removed_refuse_mcp.sql`), so the two functions are identical in who they refuse.

## Not verified here
GitHub cannot be reached from the build environment; everything is tested against a fake GitHub (`MemorySourceControl`) and a fake database. Only a run against a real GitHub App shows: that the App's Issues permission allows `PATCH` with `state_reason`, how a real repository with rules (a protected or archived repository) refuses it, and a real secondary rate limit. The production migration is applied by hand by Ashu.
