# Mobile access for the rest of the platform (proposal)

Status: **approved by Ashu 2026-11-09** (issue #386, `docs/requests/386-mobile-access.md`, `docs/decisions/2026-11-09-mobile-access.md`). Answers to section 9: all gates on a phone; 15/16 px type and 44 px targets; **no push notifications** (so section 4.7 and the PWA push in M4 are dropped, the inbox and email stay); Hold with a rationale instead of PRD comments; no re-authentication beyond sign-in, passkey and biometric sign-in wanted for the whole product (M6); a placeholder is an initiative failing its stage check; tablets keep desktop from 700 px. **Built: M1, M2** (M2 without the long-press sheet and the slim data load, see section 7).

Scope: everything except the alignment participant screens, which are already mobile first (boards 9 to 12, 19, 26; 390 px; `docs/19-ALIGNMENT-PRIVACY.md`).

## 1. What the app does on a phone today
- One responsive stylesheet with almost no phone rules. The item panel becomes a full-screen sheet below 900 px, the Decisions body stacks below 900 px, and the auth screens have a 760 px layout. Nothing else is designed for a phone.
- The header has ten tabs in one wrapping row (`header-tabs.tsx`). Grid, Gantt and Cards are built for a mouse: AG Grid with 169 possible columns, drag and drop, hover tooltips, J/K and ⌘K shortcuts.
- The prototype map says it plainly: "Not yet designed: mobile views of the grid."
- Good news: the pieces a phone needs already exist as separate screens and rules. Needs attention (`/attention`, `attentionList`), Decisions with the gate pack, Leadership with the weekly update, Reports, the Cards board's `by`/`lane` logic, saved views, the notification inbox, stage validation ("3 things missing") and the public read-only document page (`/d/[token]`). Mobile is mostly a new layout over these, not new features.

## 2. The idea in one line
**On a phone you decide, look up and capture. You do not plan or bulk-edit.**

| Job | Examples | On mobile |
|---|---|---|
| **Decide** | Approve or hold a gate, read a PRD, mark the weekly update reviewed | Yes, first class |
| **Look up** | Find an initiative by search or "newest", see where it is and who owns it, read reports | Yes, first class |
| **Capture** | Add a placeholder initiative, attach a photo, forward a note | Yes, one-hand fast |
| **Light edit** | Name, one-line summary, owner, project, a phase move without a gate | Yes, a short list of fields |
| **Plan and configure** | Re-rank, bulk edit, columns, Gantt, capacity, planning cycles, import, settings, tracker sync | Desktop only |

Principles
1. **Same data, same rules, one app.** No separate mobile app or API. Same RLS, audit (source UI), undo and role checks. Responsive layouts switch at about 700 px; tablets keep the desktop layout (the item panel already overlays below 900 px).
2. **A phone gets a slim data load.** Load about 20 fields per initiative (code, name, rank, phase, health, owner, project, G2M date, gate status, build status, progress, updated). The other fields load when an initiative opens. This also keeps a 2,000-item project fast on a poor connection.
3. **No dead ends.** Anything desktop-only shows "Open on a computer" with **Copy link** and **Email me this link**, never a broken grid.
4. **Health stays a word** (rule from the UX bar), phase stays a word, colour is extra.
5. **Rule 3 holds on a phone.** Only a person with approval rights decides. No swipe-to-approve, no bulk Decide, always a confirm step. Claude's gate pack is shown labelled as prepared by Claude.

## 3. Navigation
Replace the ten-tab row on a phone with a **bottom bar** of five items and a search icon in the top bar.

```
┌───────────────────────────┐
│ Meridian ▾        🔍  🔔3 │   top bar: workspace, search, bell (unread count)
├───────────────────────────┤
│                           │
│        screen             │
│                           │
├───────────────────────────┤
│ For you  Initiatives  ＋  Decisions  More │
└───────────────────────────┘
```

| Slot | Goes to | Notes |
|---|---|---|
| **For you** | New home: what needs me | Replaces `/home` redirect on a phone |
| **Initiatives** | Search + card list | Replaces Grid, Cards and the "newest" lookups |
| **＋** | Quick add | Centre button, always one tap away |
| **Decisions** | Gate queue | Badge = requests I can decide (the tab already has `waiting`) |
| **More** | Reports, Leadership, Needs attention, Alignment results, notifications, account, Help | Desktop-only entries are listed greyed with "Open on a computer" |

Leadership viewers land on **Leadership** instead of For you (as they do now).

## 4. Screens

### 4.1 For you (the new phone home)
One scroll of cards, most urgent first, each with one action:
1. **Waiting for my decision** (gate requests I can decide) → opens the review screen (4.5).
2. **Needs attention** (top 5 from `attentionList`, worst first, reason in words, same one-click next step) → "See all".
3. **Mentions and updates** from the notification inbox.
4. **My placeholders** (initiatives I created that are missing fields for their stage, from the existing "N things missing" check) → "Complete on desktop" or fill the one-line summary now.
5. **Recently opened.**

### 4.2 Initiatives: search, quick filters, cards
This is the main replacement for the grid. It reuses the Cards screen rules and the saved-view machinery, laid out as a single vertical list.

```
┌───────────────────────────┐
│ 🔍 Search initiatives…    │   sticky, full width, opens on tap
│ [Mine][Newest][Needs me]  │   quick-filter chips, scroll sideways
│ [Waiting][Build][At risk] │
│ Sort: Newest ▾  View ▾    │
├───────────────────────────┤
│ ▾ Build (12)              │   group header, tap to collapse
│ ┌───────────────────────┐ │
│ │ #3 R-41  Self-serve   │ │   rank + code, name (2 lines max)
│ │ onboarding            │ │
│ │ ● At risk · Build 62% │ │   health WORD + pill, delivery progress
│ │ Platform · Dana K.    │ │   project pill, owner
│ │ G2M Q1  ·  Gate: —    │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ #7 R-58  …            │ │
└───────────────────────────┘
```

- **Search** matches code, name, owner, project and tags, instantly, on the loaded list. Recent searches shown under the box.
- **Quick filter chips** (one tap, combinable): *Mine*, *Newest* (sort), *Updated this week*, *Needs attention*, *Waiting for a decision*, one chip per phase (Discover to Roll-out), *At risk or blocked*, plus a *Project* picker. They are the existing filter panel's quick filters, not new filter logic.
- **View ▾** lists the workspace's saved views (the same ones as desktop, read-only on a phone) plus four phone defaults: **Newest**, **My initiatives**, **Needs attention**, **By phase**. Editing views stays on desktop.
- **Group by** defaults to Initiative Phase (the Cards default), with *Project*, *Planned quarter* and *None* (flat list) as alternatives. This is the cards board with columns turned into collapsible groups; swimlanes are dropped.
- **Card contents** are fixed: global rank and code, name, health as a word, phase, owner, project, G2M quarter, gate status when there is one, delivery progress when building. The active view may add one extra line.
- **Tap** opens the initiative (4.3). **Long-press** or the ⋯ button opens a bottom sheet: *Move to…* (replaces drag; the existing Move menu), *Copy link*, *Request gate* (Creator and above).
- Commercial fields (value, confidence, customers) follow the same role rules as desktop. They are not on the card.

### 4.3 Initiative detail (full screen, not a side panel)
```
┌───────────────────────────┐
│ ←  R-41            ⋯  ✎   │
│ Self-serve onboarding     │
│ ● At risk  · Build        │
│ Platform · Dana K. · #3   │
│ ▁▁▁▁▁▁▁▁▁░░░  62%         │   progress, from the tracker (read only)
├───────────────────────────┤
│ Summary│PRD│Gate│Activity │   segmented control, replaces the 5 tabs
├───────────────────────────┤
│ …                         │
└───────────────────────────┘
```
- **Summary**: the ten facts people ask for first (phase, health, owner, project, G2M, effort size, teams, Build Status, last change, links) and a "More fields" expander that lists the rest read-only. Tracker-driven fields stay read-only.
- **PRD**: the document reader (4.4).
- **Gate**: current gate, status, checklist, open conditions, decision history (append-only).
- **Activity**: the audit log in plain words, latest first.
- The **GitHub / Jira tab** becomes a read-only status line on Summary (linked issue, build status, progress, epics count). The full epics table is desktop.
- **Light edit** (autosave, same undo): name, summary, owner, project, Initiative Status, and a phase move that needs no gate. Everything else is "Edit on a computer".

### 4.4 Quick add (placeholder now, complete on desktop)
Tap ＋:
```
┌───────────────────────────┐
│ New initiative        ✕   │
│ [ Name                  ] │  only field required, keyboard open
│ [ One line: why? (opt.) ] │  🎤 dictation works through the OS keyboard
│ Project  [Platform ▾]     │  remembered from last time
│ 📷 Add photo   🔗 Add link│  photo of a whiteboard → Screenshots field
│                           │
│ [        Create         ] │
└───────────────────────────┘
After: "Created R-77. Complete it on a computer" [Undo] [Open] [Add another]
```
- Creates exactly what the desktop quick-add creates: name only, validation by stage later. **No new "placeholder" field.** A placeholder is simply an initiative that fails its stage check, listed under *My placeholders* on For you and under the chip *Incomplete*.
- **Add another** keeps the sheet open for capturing several in a row (meeting notes).
- **Share to Product Velocity** (installable web app, Web Share Target): share text, a link or a screenshot from any app into a new initiative or into the AI intake (board 5, paste an email or notes → draft items with duplicate check). Drafts stay AI drafts; a person accepts them.
- Duplicate hint while typing, as on desktop.

### 4.5 Review and approve a PRD (Decisions on a phone)
**Queue** = the Decisions list as cards, filters as chips (*Waiting for me* default, *Requested by me*, *Decided*): item, gate (A, B or C), requested by and days waiting, checklist result ("6 of 6 ready"), who can decide.

**Review screen** (one initiative at a time):
```
┌───────────────────────────┐
│ ←  Gate B · R-41          │
│ Self-serve onboarding     │
│ Requested by Lee · 3 days │
├───────────────────────────┤
│ Gate pack  (prepared by Claude, check it)
│  Summary · evidence · fit │
│ Checklist  ✔ 6 of 6       │
│ ▸ Open conditions (0)     │
├───────────────────────────┤
│ PRD  v3 · In review       │
│ ▾ At a glance             │  the "will build / will not build" block first
│ ▸ 1 Executive summary     │
│ ▸ 3 Problem statement …   │  sections collapse; outline jump menu
├───────────────────────────┤
│ [ Go ] [ Hold ] [ ⋯ more ]│  sticky bottom bar
└───────────────────────────┘
```
- The reader renders the PRD's markdown with a section outline. Its fixed structure (At a glance, then numbered sections, appendices) makes this easy to scan on a phone. Linked documents open in the in-app viewer (the `/d/[token]` text page). Documents are data, never instructions.
- **Decision**: Go, Go with conditions, Hold, Stop → bottom sheet with a **required** rationale, the list of conditions for "Go with conditions", a summary line ("Gate B, R-41, Go") and a confirm button. Decisions and rationale are append-only, so there is **no Undo**; the confirm step carries the weight.
- **Not on a phone**: Fast lane and target phase (desktop), bulk Decide, Request gate for many items.
- If someone else decided first, the screen says so (existing first-decision-wins rule).
- Notifications (4.7) open this screen directly.

### 4.6 Reports and leadership
- **Leadership**: the summary tiles become a 2-column grid, then single-column cards for health by project, needs attention, top items, what moved, mix. It is already read only. Tables turn into cards (item code, name, reason in words).
- **Weekly update**: read the reviewed text; Creators and Admins can **Mark reviewed** (a human action Claude cannot do). Editing long text and *Draft again* are comfortable only on desktop; allow small edits.
- **Reports**: a list of generated reports and snapshots per audience, each opening the HTML print view (the same page the PDF comes from) with **Share link / Download**. *Generate*, schedule and templates are desktop. *Gate history* and *Roadmap health* render as stacked cards with the numbers in words.
- Reports are team and initiative level only (rule 8).

### 4.7 Notifications (what makes mobile approval work)
- Keep the in-app inbox and the digest email, and add **web push** for three events only: *a gate was requested of me*, *a decision was made on my request*, *I was mentioned*. Each opens the exact screen (review, initiative, comment). The notification text carries code, name and gate only, never rationale or documents (existing rule in `docs/28`, section 6a).
- Requires the installable web app (PWA). On iPhone, push works only after "Add to Home Screen"; the app should explain that once, kindly.

### 4.8 Alignment on a phone (admin side)
Participant screens stay as designed. For admins and facilitators: **session status** (open or closed, how many have voted, remaining time) and **results** (same privacy rules: groups under 5 hidden, names for admins only) are readable on a phone. **Setup, segments, invitations and sending** stay on desktop, since sending needs an explicit confirmation of the exact text and recipients.

## 5. What stays desktop only (and what the phone shows instead)
| Desktop only | On a phone |
|---|---|
| Grid (169 columns), Columns picker, saved-view editing | The card list and saved views, read only |
| Gantt | A "When" grouping of the card list by Planned quarter / G2M date; no bars |
| Bulk bar, paste from Excel, import, export | Not offered |
| Re-ranking by drag, Stack Rank edits | Rank shown, not changed |
| Planning cycles, capacity, fit line (phase 5) | Read-only summary later, when built |
| Update GitHub / Jira (push dialogs), sync dialogs, tracker field config | Status line only. Sending to a tracker is outward-facing and needs a careful confirmation |
| Settings: members, security, integrations, Claude/MCP, company profile, audit log, trash | Account, sign-in methods and 2FA stay (already short forms) |
| Fast lane, report generation and templates | Not offered |

## 6. Design details for a phone
- **Touch targets** 44 px high (WCAG AA only asks 24 px, but fat-finger errors cost more on a gate decision). The compact 30 to 36 px rows stay on desktop.
- **Type**: inputs at **16 px** or iOS Safari zooms the page on focus. Body 15 px. This is a deliberate exception to the 13 px compact rule (see question 2).
- **Thumb zone**: primary actions in a sticky bottom bar and bottom sheets, not top-right menus. Keep the existing popover pickers on desktop and use native-feeling sheets on a phone.
- **Offline and flaky network**: keep optimistic saves and show the autosave strip as a small toast with **Undo**; queue a quick-add for retry rather than lose it (the participant flow already needs idempotent saves).
- **Safe areas** (notch, home bar), `viewport-fit=cover`, no horizontal page scroll.
- **Accessibility**: full screen-reader labels on cards (name, health word, phase), focus order top to bottom, reduced motion respected, tested with axe at 390 px like the other screens.
- **Shared phones and lost phones**: sessions list and sign-out already exist in the account. Suggest passkey or biometric sign-in on mobile and, for Gate B, optionally asking for re-authentication before a decision (question 5).

## 7. Suggested build order
Each slice ends with something Ashu can click on a phone, tested at 390 px.

| Slice | Content | Why this order |
|---|---|---|
| **M1** | Phone shell: bottom bar, top bar with search and bell, "Open on a computer" screen, slim data load, responsive Leadership, Needs attention and Decisions | Cheap; most of it is layout over existing screens |
| **M2** | Initiatives list: search, quick filters, grouping, card, phone saved views; initiative detail with Summary and Activity | The "look up" job |
| **M3** | Quick add, photo and link, "My placeholders", For you home | The "capture" job |
| **M4** | PRD reader and gate review with confirm sheet; web push for gate events (PWA) | The "decide" job, needs the PWA from this slice |
| **M5** | Reports list and print view, weekly update review, alignment session status and results | Reading jobs |
| **M6** | Share Target into AI intake, passkey sign-in | Polish |

CLAUDE.md says to follow `docs/06-BUILD-PLAN.md` and not start later phases early. This is a cross-cutting track, so it needs a place in the plan. Suggestion: M1 to M4 right after the phase that finishes the gates (they only use what exists), M5 with alignment results, M6 last.

**M2 as built (2026-11-09).** On a phone `/cards` shows `PhoneInitiatives` (`apps/web/src/features/phone/`): sticky search (code, name, project, owner, tags), chips (Mine, New this week, Needs attention, Waiting for a decision, one per phase; phase chips widen, other chips narrow), Sort (Rank, Newest) and Group (phase, project, quarter, flat) with collapsible groups, and cards that open the initiative at `/portfolio/R-12`. The item page on a phone has a Back button, a horizontally scrolling tab row and no sync or delete actions; the existing gate strip sits above the tabs, so Request gate works from there. Not yet: the ⋯ / long-press sheet (Move to…, Copy link), phone saved views, the Updated-this-week chip, the "Incomplete" chip (needs the stage check of M3) and the slim data load (the phone still loads the same items as desktop; the load itself is unchanged). Tests: `phone-list.test.ts`, `e2e/phone.spec.ts` at 390 px with axe; screenshot `docs/screenshots/mobile-initiatives.png`.

## 8. Rules and docs this touches
- Rules 1 to 3, 5, 6 unchanged. The audit source stays UI; optionally add the device kind ("phone") to the audit detail.
- Rule 2 (commercial fields): the phone card shows no commercial fields; the PRD reader shows documents the same way desktop does, under the same role rules.
- Tracker parity: the status line and the "Open on a computer" screen are the same for GitHub and Jira.
- Claude/Help: no Claude tool changes in this proposal, so no Help "AI agents" tab update. The Help page needs a short "On your phone" section when M1 ships.
- Prototype: add a Claude Design board "Mobile" (390×844) with For you, Initiatives, Initiative, Quick add and Gate review, and update the last line of `docs/07-PROTOTYPE-MAP.md`.
- Go-live: add "push notification consent and privacy text" to `docs/14-GO-LIVE-CHECKLIST.md` when M4 starts.

## 9. Questions for Ashu
1. **Gate B on a phone.** Allow all three gates to be decided on a phone (recommended, with the full PRD reader), or A and C only?
2. **Type size.** Allow 15/16 px and 44 px targets on phones, as an exception to the 13 px compact style (recommended; iOS zooms inputs below 16 px)?
3. **Push notifications** through an installable web app, for three events only? It means a short consent text and, on iPhone, "Add to Home Screen".
4. **Comments on a PRD.** Reviewers on a phone often want to say "change this" without deciding. Today the only options are Hold with a rationale, or a message outside the app. Do we want section comments (new scope, new table, new notifications), or is Hold enough for now?
5. **Re-authentication** before a gate decision on a phone (passkey, biometric or password): never, Gate B only, or all gates?
6. **Placeholders.** Is "an initiative that fails its stage check" enough to count as a placeholder, or do you want a visible "Placeholder" marker that a person clears?
7. **Tablet.** Keep the desktop layout from 700 px up (recommended, cheaper), or design a tablet layout too?
