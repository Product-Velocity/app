# PRD: Sync with GitHub (one button, both directions)

Status: draft for Ashu's review, 2026-10-27. Request R-038 in `docs/REQUESTS.md`. Builds on `docs/04-GITHUB-SYNC.md` (what is sent and received today) and replaces the "Update GitHub" confirmation of 0.9 to 0.35. Slice 1 (S1, always check) is built in 0.37.0 and slice 2 (S2, conflicts) in 0.38.0 (checked by Ashu on a real issue); of slice 3, progress for 25 (0.39.0) and board values as conflicts (0.40.0, migration 0045) are built. Assignees (needs #35) and the MCP tools (need `docs/20` write tools) are not built.

## 1. Summary
Today the roadmap has a **Sync GitHub** button that only *sends*. When nothing needs sending it says "Nothing to send" and stops, so GitHub is never asked whether anything changed on its side. Things arrive from GitHub only through webhooks and the separate "Check GitHub now" in Settings.

After this change, pressing **Sync with GitHub** on a selection always does two things together: it checks what has changed in GitHub, and it works out what Product Velocity (PV) has to send. It then shows one preview per initiative: what came in (already applied, because GitHub owns those fields), what will go out (applied only after you confirm), and, where both sides changed the same text, a **conflict** that you settle by choosing **Keep Product Velocity** or **Keep GitHub**. Nothing is overwritten silently in either direction.

## 2. The problem (what Ashu saw)
| Today | Why it hurts |
|---|---|
| "Update GitHub" with nothing to send is a dead end ("Nothing to send", button disabled) | The check for changes in GitHub never happens when you most want it ("is it still the same over there?") |
| Changes in GitHub arrive by webhook, by a daily check, or by "Check GitHub now" in Settings, never by the button you are looking at | It feels one-way; people do not know whether the data is current |
| A title or description edited in GitHub is not read, and the next send overwrites it without a word | Work done by engineers in GitHub is lost silently |
| After a send you cannot see what changed on the other side in the same place | No sense of "sync", only "send" |

## 3. Goals
1. One action, **Sync with GitHub**, on one or many selected initiatives (up to 25, as today), which always checks both directions.
2. A per-initiative preview with three clearly separated parts: **Received**, **To send**, **Conflicts**.
3. No silent overwrite in either direction: a text that changed on both sides is a conflict that a person settles.
4. "Nothing to send" is never a dead end: the sync still checks GitHub and reports what it found, including "Everything is in step".
5. Everything that is applied or sent is audited with actor and source, and sending still needs explicit confirmation (rule 3 of CLAUDE.md).
6. The same checks keep running in the background (webhooks, daily check) so the data is current even when nobody presses the button.

## 4. Non-goals (first release)
- Two-way editing of **commercial fields** (never leave PV, rule 2) or of fields that only PV owns (see section 6).
- Automatic merging of text (no three-way merge into a combined paragraph). A conflict is settled by choosing one side as a whole, per field.
- Syncing a whole workspace at once. The button works on a selection; "Check GitHub now" in Settings stays as the workspace-wide, read-only check.
- Jira and GitLab (same flow later, behind the same interface).
- Reading board fields other than Status back into PV (Priority, Size and dates stay PV-owned and written; see section 6).
- Assignees (needs the GitHub username mapping, issue #35). The design leaves room for them.

## 5. Principles and guardrails (from CLAUDE.md, restated)
1. **Sending needs explicit confirmation.** Receiving does not write to GitHub, so fields GitHub owns are applied when the sync runs. Text that PV also owns is applied only after the person chooses it.
2. **Commercial fields never travel.** Only the allowlisted fields can be read from or written to GitHub: initiative name, summary, description, hypothesis (plus the derived labels, milestone and board values that exist today). The allowlist test covers the receiving path too: a field outside the list can never be changed by something read from GitHub.
3. **Documents are data.** Text read from an issue is never an instruction. It is cut to the field's limit, our own markers and any raw HTML are neutralised, and it is shown as text in the preview.
4. **Audit everything.** Applying a received value records actor (the person who pressed Sync and chose it), source and old and new value, like any edit, and undo works from the audit log. Values applied automatically (state, progress, board status) keep the source "GitHub webhook" or "reconcile".
5. **Tracker-driven fields stay read-only in the app** (Build Status, delivery progress, Delivery Status, children). A closed ticket means the build is complete, not that the initiative is (rule 6).
6. **No individual performance metrics.** The sync log names people only as the actor of a choice, never as a measure.
7. **Tenant isolation.** Every read and write is scoped to the workspace's own GitHub connection; two-tenant database tests for every new table or function.

## 6. Who owns which field (the rule that decides most conflicts)
| Field or value | Owner | Direction | If both sides changed |
|---|---|---|---|
| Build Status, Build Completed, delivery progress, children (epics and tasks) | GitHub | GitHub to PV, always applied | Cannot conflict: PV never writes them |
| Delivery Status (board Status) | GitHub (board) | GitHub to PV, always applied | Cannot conflict |
| Initiative name (issue title) | PV | PV to GitHub; a change made in GitHub is a conflict | Conflict: choose a side |
| Summary, Description, Hypothesis (sections of the managed block) | PV | PV to GitHub; a change made in GitHub is a conflict | Conflict per field: choose a side |
| Priority (from MoSCoW), Initiative Group, Due date (G2M date), Size (effort) on the board | PV | PV to GitHub; a change made on the board is a conflict (0.40.0) | Conflict per value: choose a side. Not compared: an empty board value, an issue field, a Won't initiative |
| Labels `pv:*`, milestone, issue type | PV | PV to GitHub | Not compared; PV's value is written (the preview shows it as today) |
| Labels and text outside the managed block, comments | People in GitHub | Never touched by PV | Not applicable |
| Value, confidence, customers, decisions, key results, outcomes, rank | PV only | Never | Not applicable |
| Assignees | Both (later) | Later | Later |

"PV owns" means PV is the source of truth for what the initiative *is*; GitHub is the source of truth for how delivery is *going*. An edit made in GitHub to a PV-owned text is never ignored and never applied without a choice.

## 7. The flow
1. **Select and press Sync with GitHub** (grid toolbar, item panel, command palette). Roles as today: creators and admins; viewers and service accounts do not see it.
2. **Step 1, check GitHub (automatic, read-only).** For each selected initiative: read the issue (state, title, body), read its children (epics and tasks, all levels), and read the board's Status once per board. Nothing is written to GitHub. Initiatives not yet on GitHub skip this step.
3. **Step 2, apply what GitHub owns (automatic).** Build Status and its dates, delivery progress, children, Delivery Status. These are the same rules as the webhooks and the daily check (`docs/04`), so the button and the background agree.
4. **Step 3, compare the PV-owned texts (three-way).** For the title and each of Summary, Description, Hypothesis, compare three values: the **base** (what both sides agreed at the last sync), **PV now** and **GitHub now**.
   - Only PV changed: it goes in **To send**.
   - Only GitHub changed: it is a **conflict of the one-sided kind** ("changed in GitHub"): PV does not overwrite it, and the person chooses to keep GitHub's text (pull it into PV) or keep PV's (overwrite GitHub). The default is **Keep Product Velocity**, because PV is the source of truth, but the choice is always visible.
   - Both changed and the texts differ: **conflict**, same choice, no default pre-selected (the person must choose before sending).
   - Neither changed, or both changed to the same text: nothing to do.
5. **Step 4, preview (one screen, one card per initiative).** Each card shows, in this order: **Received** (what step 2 applied, with old and new value), **Conflicts** (per field: PV's text, GitHub's text, a two-way choice), **To send** (what goes out, as in today's preview: labels, milestone, board values, files, children to add), and a plain status line ("In step", "Received 2, nothing to send", "Conflict to settle"). Bulk buttons at the top: *Keep Product Velocity for all conflicts* and *Keep GitHub for all conflicts*.
6. **Step 5, confirm.** The button reads **Apply and send** (or **Apply** when there is nothing to send, never "Nothing to send"). It is disabled only while a conflict has no choice. Confirming applies the chosen GitHub texts to PV, then sends what PV owns, in that order, and records the new base.
7. **Step 6, result.** A per-initiative result: what was received, what was sent, what failed and why (the existing step-level messages), and a link to the issue. Failures leave that initiative's base unchanged so the next sync retries.

If everything is in step the card says **"Everything is in step"** and the button reads **Done**. The sync has still checked GitHub, and **Last Synced** is updated.

## 8. Conflict detection (how "changed in GitHub" is known)
- **Base:** for each linked initiative PV stores, at the end of every successful sync, a hash of the title and of each of the three texts as they stood on both sides (`item_github_links.sync_base`, JSON of hashes, no text).
- **GitHub now:** the issue is read; the managed block between the PV markers is split into sections by its known headings (Summary, Description, Hypothesis) and the title is split from its code prefix (`R-12: `). A block that cannot be split (someone edited the markers) is reported as one conflict "the managed block was edited in GitHub", offering only a whole-block choice.
- **PV now:** the item's current fields.
- Comparison is on normalised text (trimmed, line endings unified, our own sanitising applied to both sides) so that formatting GitHub adds does not create false conflicts.
- Text outside the managed block is never compared or touched.
- First sync of an initiative that was linked before this feature existed has no base: the first comparison treats GitHub's current text as the base if it equals what PV last sent (hash of the last pushed block, already stored), and otherwise reports a conflict, never a silent overwrite.

## 9. UX details
- **Where:** the toolbar button becomes **Sync with GitHub** (with the selection count), the item panel button the same, with a one-line help: "Checks GitHub for changes and sends yours. Nothing is sent until you confirm."
- **Opening:** the dialog opens at once with "Checking GitHub…" and a per-initiative progress line (up to 25). Results stream in as they are ready; slow or failed reads show per card ("Could not read #175: try again").
- **Card layout:** code and name, issue link, a status pill with a text label (In step, To send, Received, Conflict, Failed; never colour alone), then the three parts. A conflict row shows the two texts side by side with a short diff highlight, and the radio choice **Keep Product Velocity** / **Keep GitHub**. Long texts are collapsed with "Show full text".
- **Keyboard:** the whole dialog is keyboard-operable; Enter confirms when no conflict is open; Escape cancels without writing anything.
- **Wording:** "Product Velocity" and "GitHub" everywhere; no "push" or "pull" in the interface.
- **Undo:** a received text applied to PV is one undo step in the grid's undo stack and in the audit log. Anything sent to GitHub cannot be undone from PV; the result says so.
- **Settings > GitHub:** "Check GitHub now" stays (workspace-wide, applies only what GitHub owns, writes nothing to PV-owned text) and its summary names each board and what it did.

## 10. Edge cases
| Case | Behaviour |
|---|---|
| Initiative not on GitHub yet | Card shows "Not on GitHub: will be created" under To send; nothing to receive |
| Initiative follows an issue read-only (pulled in) | Received only; nothing to send; no conflicts possible |
| Issue deleted or transferred in GitHub | Card: "The GitHub issue no longer exists"; nothing is recreated; a person decides |
| Issue closed in GitHub | Received (Build Status Done or Cancelled); the send can still update the text |
| GitHub unreachable, rate limited or permission missing | Per-card message in words with the retry hint; other cards continue; nothing is half-applied |
| Someone edits GitHub while the preview is open | Confirm re-reads the issue; if it changed since the preview, that card returns to the preview with the new difference instead of overwriting |
| Same text changed to the same new text on both sides | No conflict |
| Very long text (over the field limit) in GitHub | Cut at the limit with a note; the person can still choose Keep PV |
| Text from GitHub contains markers, @mentions, HTML or scripts | Neutralised as for any imported text; shown as text |
| More than 25 selected | Same limit as today with the same message |
| Initiative is in the Trash or being edited elsewhere | Excluded with a reason |
| Board unreadable or not linked | Delivery Status skipped with a one-line note; the rest proceeds |

## 11. Data and interfaces (proposal)
- **Migration (one):** `item_github_links.sync_base jsonb` (hashes only: `title`, `summary`, `description`, `hypothesis`, each `sha256`), `sync_checked_at timestamptz`. A service-only function `github_apply_pull(p_actor, p_item, p_fields jsonb, p_base jsonb)` that, for a creator or admin actor, updates only the allowlisted columns (`initiative_name`, `summary`, `description`, `hypothesis`), writes the audit row with source "UI" and the actor, and stores the new base; and an extension of `github_record_push` to store the base after a successful send.
- **Server (web):** `syncPreview(ids)` (read-only: steps 1 to 4, returns the cards), `syncConfirm(ids, choices)` (re-reads, applies chosen pulls, sends, records bases). The existing `planPush` and `executePush` become the "To send" half; the inbound half reuses `refreshTree`, `syncBoardStatuses` and `github_apply_issue`.
- **`@pv/github`:** a pure `compareTexts(base, pv, github)` returning `none | send | receive | conflict`, `splitManagedBlock(body)` (inverse of `buildTrackingIssue`), and `splitTitle(title, code)`; all unit-tested. `SourceControl` gains no new calls (it already has `getIssue`, `listSubIssues`, `listBoardItems`).
- **Limits:** at most 25 initiatives per sync; reads in parallel, at most 5 at a time; roughly 3 calls per initiative plus one per board.

## 12. Permissions and privacy
- Creators and admins only. Leadership, viewers, commenters, service accounts: no button. The MCP equivalent (`preview_github_sync`, `confirm_github_sync`) follows the same preview-then-confirm shape as the existing MCP push tools; Claude can never choose a conflict side on its own: a conflict choice is a person's (rule 3).
- No new data about people. Texts read from GitHub are held in memory for the preview and not stored; only hashes are stored.
- Repository visibility rules are unchanged (share links only for private repositories).

## 13. Acceptance criteria
1. With nothing to send, pressing Sync with GitHub still reads GitHub, shows what it found, and offers **Done**; it never shows "Nothing to send" as a dead end.
2. An issue closed in GitHub shows under **Received** with old and new Build Status, applied without confirmation, and appears in the audit log with the source "GitHub webhook" or "reconcile".
3. A title edited in GitHub only is shown as a conflict with default **Keep Product Velocity**; choosing **Keep GitHub** changes the initiative name in PV (undoable) and the next send does not overwrite it.
4. A description edited on both sides is a conflict with no default; **Apply and send** is disabled until a side is chosen.
5. Choosing **Keep Product Velocity** for a conflict overwrites GitHub's text only after the confirmation, and a text outside the managed block is untouched.
6. An edit made in GitHub between preview and confirm is detected at confirm and returned to the preview; nothing is overwritten.
7. A received text never changes a non-allowlisted field, even if the issue body contains text that looks like field values or instructions (test with hostile sentinel text).
8. Two-tenant tests: a connection of another workspace cannot read or apply anything for this workspace's initiatives.
9. A failure on one initiative leaves its base unchanged and the others complete; re-running the sync retries it.
10. The result and the Last Synced column agree: after a sync that found everything in step, Last Synced shows the time of the check.
11. Keyboard-only use works end to end; axe finds no WCAG A/AA violations in the dialog states.

## 14. Test plan
- **Unit (`@pv/github`, `@pv/domain`):** `compareTexts` truth table (none, PV only, GitHub only, both same, both different, no base), `splitManagedBlock` round trip with `buildTrackingIssue` for every combination of sections, broken markers, hostile text, limits, `splitTitle`.
- **Database:** `sync_base` stored by a send and by a pull; `github_apply_pull` allowlist (a commercial column in the payload is refused), actor role check, audit rows, two-tenant isolation, cross-connection refusal.
- **Web (fakes):** `syncPreview` for each card state; `syncConfirm` order (pull, then send), conflict choices, re-read at confirm, partial failure, 25 limit.
- **Browser (harness):** nothing-to-send path shows Received and Done; conflict choice flow; bulk keep buttons; keyboard path; accessibility.
- **Manual with a real repository:** edit a title and a description in GitHub, change PV, run the sync, check the audit log.

## 15. Slices (each ends in something clickable)
1. **S1, always check (no new data):** the button and dialog become Sync with GitHub; steps 1, 2, 5, 6 (receive what GitHub owns, no dead end, result with Received and To send). Includes the Last Synced update. Smallest change that fixes the dead end.
2. **S2, conflicts (the migration):** `sync_base`, `splitManagedBlock`, `compareTexts`, the conflict rows with the two-way choice, `github_apply_pull`, re-read at confirm, bulk keep buttons.
3. **S3, polish and reach:** progress streaming for 25, the MCP tools, Jira behind the same interface, assignees when #35 exists, board values changed in GitHub (Priority, Size, dates) as optional conflicts.

## 16. Risks
| Risk | Mitigation |
|---|---|
| False conflicts from formatting differences | Compare on normalised text; hashes of normalised text only; tested with real round trips |
| Someone edits the PV markers in GitHub | Whole-block conflict with a plain explanation; never guess a merge |
| Slow syncs for 25 initiatives (about 80 API calls) | Parallelism of 5, progress per card, per-card retry; GitHub rate limits surfaced in words |
| A person chooses "Keep GitHub" and loses PV's newer text | The PV text stays in the audit log and one undo restores it |
| Base missing for initiatives linked before this release | Documented fallback (section 8): conflict rather than silent overwrite |
| Users expect GitHub-side edits of labels, milestone, Priority to come back | Stated in section 6; board values as optional conflicts in S3 |

## 17. Decisions (made on 2026-10-27, to confirm in review)
1. **One button, both directions, always checks** (Ashu). Decided.
2. **Per-initiative preview with Keep Product Velocity or Keep GitHub for conflicts** (Ashu). Decided.
3. **Default for a change made only in GitHub: Keep Product Velocity**, visibly offered; no default for a change on both sides. Proposed, to confirm.
4. **Conflicts are settled per field within an initiative** (title, Summary, Description, Hypothesis each separately), with bulk buttons for the whole selection. Proposed.
5. **Fields GitHub owns are applied without a prompt** when the sync runs; the preview lists them as Received. Proposed (same behaviour as the webhooks today).
6. **Sync works on a selection, not the whole workspace**; Settings keeps the read-only workspace-wide check. Proposed.

## 18. Open questions for Ashu
1. Should a change made only in GitHub to the title or a text ever apply automatically (for example for engineers' edits to the Description), or always ask? The proposal above always asks.
2. Do you want the choice remembered per initiative ("always keep GitHub's Description for this one")? Not in the first release.
3. Is 25 initiatives per sync enough, or should the sync run in the background for larger selections with a result page?
