# Leadership view and weekly update (issue #29)

Open **Leadership** in the header (`/leadership`). A portfolio-level, **read-only** view. People with the Leadership viewer role land here after signing in; everyone else in the workspace can open it too. It follows the scope switcher (`?scope=`).

## What it shows
- **Summary tiles:** initiatives in scope, how many are On Track, how many need attention (with the words), how many are due by G2M date in the next two weeks.
- **Portfolio health by project:** one row per project with initiatives in the scope (A to Z): the count, a bar and the words ("2 On Track · 1 At Risk · 1 Blocked"). Health is never colour alone.
- **Needs attention:** Blocked, Delayed and At Risk initiatives, initiatives past their G2M Date (est) that are not finished, and initiatives with blocked GitHub issues (once GitHub sync exists). Worst first (Blocked, then Delayed, then the rest by rank), each with its reasons in words. Over-capacity items join when capacity planning exists (phase 5).
- **Top items by global rank:** the first ten, in the columns of the **Leadership view** (sheet "Default views (ordered)", `docs/reference/default-views.csv`). Columns of later phases (Delivery Progress %, G2M Quarter, G2M Slip, Current Gate, Fit by Team) are listed as arriving with their phase. Commercial columns follow the visibility rule of `docs/DECISIONS.md` (every role that can read the workspace sees internal columns).
- **What moved this week:** from the audit log (ISO week, Monday to Sunday): a rank change is the net move over the week ("moved up 3 places (#9 to #6)"; moving away and back is not a change), status and health changes in words. Read through `weekly_item_changes` (migration 0015), because the audit table is admin-only.
- **Investment mix:** initiatives per Roadmap Category (the five values, then "No category") with counts and shares.
- Click an item code to open the **item panel** beside the page (read-only for a leadership viewer).

## The weekly update
- Stored per workspace, ISO week and scope (`weekly_updates`). **Creators and admins** press **Draft weekly update**: a template-based text from the data (heading, Highlights, Risks and asks with an `Ask:` line, What moved this week, Next two weeks, Investment mix). Every statement names its initiative; the page lists the initiatives the draft draws on, as links.
- The text is **editable** (saved when you leave the box). **Mark reviewed** records who and when (the database sets both; Claude can write a draft but never mark it reviewed). **Editing the text clears the review.** **Draft again from the data** asks before replacing your text. **Copy text** copies it.
- **Nothing is sent anywhere** automatically; sharing is copy and paste for now. Claude writes the text in phase 4 on the same screen.
- **Leadership viewers and other read-only roles** see the *reviewed* update, read-only; if only a draft exists they are told it has not been reviewed yet and do not see the draft.

## Read-only, and tested
A leadership viewer can change nothing: the browser tests check the page has no draft or review controls and the item panel's fields are disabled; the database tests (`leadership-readonly.test.ts`, `weekly-updates.test.ts`) check that the role cannot insert, update or delete in items, projects, views, scopes, groups, tags or weekly updates, nor re-rank, rename or merge.

## Not in this issue
Sending by email or Slack, notifications, velocity insights (phase 7), priority alignment (phase 8). Over-capacity risk arrives with capacity planning.
