# Alignment sessions: privacy model

Status: **agreed by Ashu 2026-10-24** (issue #123, step 1; rule 7 in `CLAUDE.md`; PRD §4.7; `docs/03`), with one change from the proposal: admins may open names at any time, not only after close (Q2). Built in releases 0.21.0 (setup), 0.24.0 (participants, invitations, participant flow); scoring and results are #126. The decisions are in section 10.

## 1. What must hold (the rules we are not free to bend)
1. **Voters are anonymous to each other and to people reading results.** Participants see only anonymous aggregates; no one sees another person's ballot.
2. **Groups with fewer than 5 voters are hidden** wherever a group is shown.
3. **Admins see names** (rule 7). This is the one deliberate exception to anonymity, so it is narrow, deliberate and logged (section 4).
4. **Consent, retention and deletion are supported** (section 7).
5. **Claude never approves, ranks or sets Value** (rule 3): results are a score and a suggested order; a person decides. **Invitations are drafted by Claude and sent only after a person confirms** (#124).
6. **No voter emails in logs or error reports; no tracking pixels.** (CLAUDE.md "Secrets only in environment variables. Never log tokens, emails of voters".)
7. **No individual performance metrics** (rule 8): nothing here ranks people.

## 2. Who can see what
| Who | Sees | Never sees |
|---|---|---|
| Participant (magic link, no account) | the items the session allows, their own ballot, and after close, if the admin allows it, anonymous results | other people's ballots, names, emails, per-group results of a group under 5, commercial fields unless the audience profile allows them |
| Workspace member (viewer to creator) | that a session exists, its state, and (if allowed) the anonymous results | participants, emails, ballots |
| Admin | everything above, **participant list (names, emails, segment, voted or not)**, send and bounce state; **who voted what only through the "Show names" action** (section 4), at any time | nothing hidden by the system, but every look at names is logged |
| Claude (through the signed-in user's role) | session setup, draft invitation text, anonymous aggregates of a closed session | participants, emails, ballots, names. The MCP server does not expose those tables |
| Platform staff (docs/15) | session counts and states for support | participant emails and ballots, **even in `open` content-access mode** (proposal, question Q4) |

## 3. How ballots are stored
Tables (all with `tenant_id`, RLS on the fast pattern, two-tenant tests, on the probe list): `alignment_sessions`, `alignment_items`, `participants`, `ballots`, `votes`.
- **Identity and content are separate tables.** `participants` holds who (email, display name if given, segment, group, consent time, link token hash). `ballots` holds one row per participant and session (state, submitted time). `votes` holds the answers (item, coins or rank or ICE values) and is linked to the ballot, **not** to a name.
- **No table of this feature is readable through the normal API by anyone.** Reads go through functions that check the role and apply the rules in section 5 and 6 (security definer, same pattern as the GitHub tables). Participants use a separate server route that checks the link token; they have no database role at all.
- **Why the link between a ballot and a person exists at all:** a person can change their vote until the session closes, and admins see names. We therefore keep `ballots.participant_id`. The protection is access control, the narrow "Show names" path and the audit log, not unlinkability. If Ashu wants true unlinkability (admin sees who voted but never what), this changes: see Q1.
- **Email storage:** the email is needed to send, so it is stored (admin-only, encrypted at rest by the database) plus a hash for duplicate detection and suppression. Never in logs; never in URLs.
- **Magic link:** a random 256-bit token per participant; only its hash is stored. Valid until the session closes (the person can come back to change their vote) but **bound to the first browser** that opens it (a cookie), so a forwarded link does not give a second person the ballot; rate limited; a used-up, expired or revoked link shows a clear page and a way to request a new one (sent to the same address).

## 4. Admins and names
- The participant list shows who was invited, delivery state (sent, bounced), and **voted yes or no**.
- **Who voted what** is behind a "Show names" action that asks for a reason, is allowed **at any time, also while the session is open** (decision Q2), and writes an audit entry (actor, source, reason, time) visible in the workspace audit log. Because of that, the consent text says plainly that workspace admins can see who gave which answers. Admins see names per ballot, never a ranked list of people.
- Names are shown per ballot, never as a ranked list of people (rule 8).

## 5. Small groups (fewer than 5 voters)
Rule: a group with fewer than 5 voters is **not shown** to participants and not in per-group displays. Two traps to avoid:
1. **Subtraction.** If group results and the joint result are both shown and exactly one group is hidden, its score can be worked out. Rule: per-group results are shown only if **every group that exists in the session** has at least 5 voters; otherwise small groups are merged into one "Other" group, and "Other" is shown only if it has at least 5 voters (Q3 recommends this over hiding the group while still counting it).
2. **Participation counts.** "3 of 4 voted" for a small group is itself identifying. Participation is shown only per group of at least 5, and as a total.
The joint score counts everyone (as in `docs/02`), unless the admin excludes a group when setting up; that choice is fixed once the session is open.

## 6. When results appear
- **During an open session, participants see no results.** Watching a total change while voting identifies who moved it.
- After close, participants see the anonymous results page only if the admin allowed it in setup (default: off, Q5).
- Scores are computed by a function over the votes and stored as a snapshot when the session closes (`results_snapshot`), so later deletions of personal data do not change what was decided on.

## 7. Consent, retention and deletion
- **Consent:** the join page shows what is collected (email, segment, answers), who sees what (this note, in plain words), how long it is kept, and how to ask for deletion. Consent time and wording version are stored on the participant. No consent, no ballot.
- **Retention:** personal data of participants (name, email, link hash) is deleted **12 months after the session closes** by default; a workspace admin can choose a shorter time in workspace settings > Data (docs/15 §4). The votes and the results snapshot stay as anonymous aggregates.
- **Deletion on request:** an admin deletes a participant (or the person uses the link page). Personal data is removed; their ballot loses its link to a person (`participant_id` empty) and stays as an anonymous ballot, so counts and the snapshot are unchanged. If removing would drop a group below 5 voters on display, the group is shown as "Other" from then on.
- **Deleting a workspace or a session** removes everything. Backups follow the platform's backup retention (go-live checklist).

## 8. Built so far (release 0.21.0, issue #123)
`alignment_sessions` and `alignment_items` with the state machine (draft, open, closed, archived), settings locked once open (error PV009), a participant-safe snapshot of each initiative taken when the session opens (name, summary, value proposition), the closing time (lazily when a page is opened, and daily by the cron), a participant preview, admin-only changes through functions, audit with actor and source. `participants`, `ballots` and `votes` are not built yet: they hold personal data and come with #124 and #125. Sessions can be made from any selection; planning cycles (#121) are not built, so `cycle_id` stays empty for now.

## 8b. Built in 0.24.0 (issues #124 and #125)
`alignment_participants`, `alignment_ballots`, `alignment_votes` (no API access at all; migrations 0033 and 0034), `alignment_mailings` (members can read the state, never an address). The confirm step is a database rule: `alignment_mailing_recipients()` raises PV010 until a person confirmed the mailing, and `alignment_mailing_confirm()` refuses Claude and service accounts (PV004). Personal links are 256-bit, stored as a hash (the previous hash is kept so a replaced link can still ask for a new one) and tied to the first browser by a cookie; asking for a new link is limited to one email a minute and six in all. Ballot saves carry a revision and an older one is ignored; the vote is replaced in one step, so repeating a submit changes nothing. Participant and ballot audit entries hold states only. Personal data is cleared by the daily job after the retention time. Resend delivery events (delivered, bounced, spam) update participants as they do invitations.

## 8c. Built in 0.25.0 (issue #126)
The scoring rules are pure functions in `packages/domain/src/alignment-scoring.ts` with golden tests (the worked example in `docs/02`). The stored result (`results_snapshot`) holds aggregates only: item scores and places, and groups of 5 or more voters (small ones merged into Other, or no group at all when they would still be under 5). It is written once when the session is closed and cannot change afterwards. "Show names" (`alignment_reveal_names`) needs an admin, a person (not Claude) and a reason; the audit entry is written before any name is returned. Participants see the joint result and their own answers only, and only if the admin allowed it.

## 9. What this means for the issues
- **#123 (setup):** sessions, items, settings locked once open, preview as a participant, states Draft, Open, Closed, Archived. Commercial fields never shown unless the audience profile allows. Works on "any selection" until planning cycles (#121) exist.
- **#124 (invitations):** participants by paste or CSV, consent wording, Claude drafts, the admin edits, previews as a participant and confirms, then sending uses the same email path as #45 (Resend). Bounce handling, duplicates merged, unsubscribe stops reminders. A test proves nothing is sent without the confirm step, also through MCP, and a log spy proves no address is logged.
- **#125 (participant flow):** magic link, consent, the method (top 5 with duels, 100 coins max 30 per item, ICE), progress saved, change until close, no double counting after reload or a flaky network (idempotent saves by ballot and item), 390 px mobile screens.

## 10. Decisions (Ashu, 2026-10-24)
- **Q1. Admins see who voted what?** Yes, behind a logged "Show names" action (rule 7 as written). Votes stay linked to the participant so people can change their vote until close.
- **Q2. When?** At any time, also while the session is open, with a reason, always logged. (The proposal was after close only.)
- **Q3. Small groups:** merge groups under 5 voters into "Other", shown only at 5 or more voters; per-group results appear only when no group would leak by subtraction; otherwise only the joint score.
- **Q4. Platform staff:** never see participant emails or ballots, even in `open` content-access mode.
- **Q5. Participants see results after close:** off by default; the admin can allow it per session.
- **Q6. Retention:** personal data deleted 12 months after close; shortenable per workspace.
