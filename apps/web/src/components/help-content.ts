import { FIELDS, VISIBLE_FIELDS, FIELD_BY_KEY, setupGuides, type FieldDef } from "@pv/domain";

/**
 * Text of the Help guide. Short on purpose. The columns table is checked against the field dictionary (help-content.test.ts):
 * every key exists, and whether a column is read-only comes from the dictionary, not from this file.
 */
/**
 * GitHub and Jira wording for the columns that have something to say, by field key. Every other column is derived from the dictionary's own
 * GitHub-sync text, so a column added to the dictionary shows up in the table without anyone remembering to edit this file.
 */
type Link = { github: string; jira: string };

const NONE = "Not synced";
const COMMERCIAL = "Never synced (commercial)";
const same = (text: string): Link => ({ github: text, jira: text });
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const sent = (github: string, jira: string): Link => ({ github: `Sent to ${lower(github)}`, jira: `Sent to ${jira}` });
const read = (github: string, jira: string): Link => ({ github: `Read from ${lower(github)}`, jira: /^Not /.test(jira) ? jira : `Read from ${lower(jira)}` });
const JIRA_PER_MAPPING = "per mapping";

/**
 * Exact GitHub targets are from the push and read code (docs/04-GITHUB-SYNC.md): the tracking issue's title and managed block, the labels in the `pv:`
 * namespace, the milestone, the organisation's issue type, the linked Project board's fields, and what is read back from issues, pull requests, checks and releases.
 * The Jira column says what Sync with Jira does today (docs/16-ATLASSIAN.md, docs/decisions/2026-11-03-jira-write.md): what it sends, and what it reads back. "Not read yet" means planned, not built. Children of the linked issue are read (read only, never created by Product Velocity): docs/decisions/2026-11-03-jira-sub-items.md.
 */
const OVERRIDES: Record<string, Link> = {
  item_code: { github: "Sent to issue title prefix \"R-12: \" and the link back in the issue body", jira: "Not sent. The Jira key shows next to the code in the grid" },
  initiative_name: sent("Issue title (after the \"R-12: \" prefix)", "Summary (the name, no code prefix)"),
  summary: sent("Issue body, managed block, section \"## Summary\"", "Jira description, section \"Summary\"; read back to compare, with Keep Product Velocity or Keep Jira"),
  description: sent("Issue body, managed block, section \"## Description\"", "Jira description, section \"Description\", converted to Jira's format (tables included); read back to compare, with Keep Product Velocity or Keep Jira"),
  hypothesis: sent("Issue body, managed block, section \"## Hypothesis (IF / THEN / RESULTING IN)\"", "Jira description, section \"Hypothesis (IF / THEN / RESULTING IN)\"; read back to compare, with Keep Product Velocity or Keep Jira"),
  artifacts: sent("Issue body, managed block, section \"## Artifacts\" (links; a link set to \"Do not share\" on the Spec tab stays out)", "Jira description, section \"Artifacts\" (links); can be switched off per project (Field configuration)"),
  screenshots: sent("Issue body, section \"## Files\" (share links, private repositories only)", "Jira description, section \"Files\" (share links of attached files; anyone who can open the issue can open them); can be switched off per project (Field configuration)"),
  initiative_phase: { github: "Not synced. May suggest Build when the first child issue starts", jira: NONE },
  initiative_status: same("Not synced. A closed issue never sets it"),
  health: { github: "Not synced. Signals only suggest", jira: NONE },
  stack_rank: sent("Label pv:rank/top-10, top-25, top-50 or later (the band, never the number)", "Label pv:rank/top-10, top-25, top-50 or later (the band, never the number)"),
  moscow: sent("Label pv:moscow/must, should, could or wont; board field Priority (P0, P1, P2). Each label can be switched off per project (Settings, Integrations, GitHub, Field configuration)", "Label pv:moscow/…; Priority too, once you choose a Jira priority per value (Settings, Integrations, Jira, Connect and configure, Field configuration)"),
  theme: sent("Label pv:group/<name>; board field Initiative", "Label pv:group/<name> only (the group name is not written into a Jira field)"),
  change_type: sent("Label pv:type/new-feature or improvement; issue Type Feature, Improvement or Enhancement", "Label pv:type/new-feature or improvement"),
  effort: { github: "Sent to project board field Size (XS to XL)", jira: "Not sent yet" },
  g2m_date_est: sent("Milestone \"YYYY Qn\" (due on the quarter's last day); board field Due date", "Due date"),
  home_project: sent("The repository that holds the tracking issue; label pv:project/<project>", "Label pv:project/<project>; the Jira project it is linked to holds the issue"),
  focus_area: sent("Label pv:focus/<value>, only when the project switches it on (Settings, Integrations, GitHub, Field configuration; off by default)", "Written into the Jira text field you choose as Theme (Settings, Integrations, Jira, Field configuration; not sent until you choose it); also label pv:focus/<value>, only when the project switches it on (off by default)"),
  value_type: sent("Label pv:value/<type> (for example pv:value/defend-revenue); switch it off in Settings, Integrations, GitHub, Field configuration. Only the type is sent, never the amount or the basis: repositories can be public, so switch it off for those", "Label pv:value/<type>; switch it off in Settings, Integrations, Jira, Field configuration. Only the type is sent, never the amount or the basis"),
  g2m_quarter: sent("Label pv:quarter/<quarter> (for example pv:quarter/q3-2027); switch it off in Settings, Integrations, GitHub, Field configuration. The milestone still comes from G2M Date (est)", "Label pv:quarter/<quarter> (for example pv:quarter/q3-2027); switch it off in Settings, Integrations, Jira, Field configuration"),
  tags: sent("One label pv:tag/<tag> per tag, at most 10, only when the project switches it on (Field configuration; off by default)", "One label pv:tag/<tag> per tag, at most 10, only when the project switches it on (Field configuration; off by default)"), planned_start: { github: "Not sent yet (the board's Start date is planned)", jira: "Start date field, once you choose it (Field configuration)" },
  assignees: { github: "Both: issue Assignees", jira: "Not synced yet" },
  github_links: { github: "The tracking issue (repository and issue number)", jira: "The Jira issue (key)" },
  status: read("Issue state: open, closed as completed (Done), closed as not planned (Cancelled). The one status Product Velocity ever writes to GitHub is the close of the issue of an initiative you deleted (closed as not planned), after you confirm it in Sync with GitHub (Removed in Product Velocity)", "Jira status category: to do = Not started, in progress = In progress, done = Done (the status name is on the Jira tab). The one status Product Velocity ever writes to Jira is the close of the issue of an initiative you deleted, after you confirm it in Sync with Jira (Removed in Product Velocity)"),
  gh_state: read("Issue state and state reason", "Not read yet"),
  issues_closed: read("State of the tracking issue's sub-issues", "Children of the linked issue (and their sub-tasks) in the Done status category, counted at the lowest level"),
  issues_total: read("Count of the tracking issue's sub-issues (epics and tasks)", "The count of the linked issue's children (and their sub-tasks), at the lowest level; the list is on the Jira tab"),
  delivery_progress_pct: read("Closed divided by total sub-issues", "Done children divided by all children, at the lowest level (a done child is progress, never a done initiative)"),
  blocked_issues: read("Label \"blocked\" on epics and tasks", "Flagged or blocked status (per mapping)"),
  stale_issues: read("Issue updated date: no activity for 14 days", "Not read yet"),
  gh_last_activity: read("Issue updated date", "Not read yet"),
  open_prs: read("Pull requests linked to the issues (closing references), open", "Not read yet"),
  merged_prs: read("Pull requests linked to the issues (closing references), merged", "Not read yet"),
  ci_status: read("Checks on the default branch of the primary repository (Passing, Failing, None)", "Not read yet"),
  latest_release: read("Latest published release of the linked repositories", "Not read yet"),
  repositories: read("Repositories of the linked issues", "Not read yet"),
  gh_project_status: read("Project board field Status (the field chosen for the board)", "Not read yet"),
  gh_iteration: read("Project board field Iteration", "Not read yet"),
  gh_target_date: read("Project board field Due date or Target date", "Not read yet"),
  planned_scope: { github: "Counted from the sub-issues when you mark the breakdown complete", jira: "Not read yet" },
  breakdown_route: { github: "Set by the app when the tracking issue is first sent", jira: "Not used for Jira" },
  breakdown_status: { github: "Marked complete in the app; set to Awaiting engineering when the issue is first sent", jira: "Not used for Jira" },
};

const COMMERCIAL_KEYS = ["value_12m", "value_basis", "confidence", "customers_requesting", "kr_metric", "kr_start", "kr_target", "decision", "realized_kr_value", "realized_per_year", "cost_of_not_doing"];
for (const k of COMMERCIAL_KEYS) OVERRIDES[k] = same(COMMERCIAL);

export type ColumnRow = { key: string; group: string; column: string; what: string; github: string; jira: string; access: string; updated: string };

/**
 * How a value gets changed (docs/04-GITHUB-SYNC.md, docs/21-SYNC-WITH-GITHUB.md):
 * a person editing, the Sync with GitHub button, the daily check (also "Check GitHub now" in Settings), or a webhook from the tracker.
 */
export const UPDATE_EDIT = "You edit it";
export const UPDATE_MANUAL = "Manual sync (Sync with GitHub or Jira)";
export const UPDATE_AUTO = "Auto sync (daily check)";
export const UPDATE_WEBHOOK = "Webhook (real time)";
export const UPDATE_CALCULATED = "Calculated from other columns";
export const UPDATE_SYSTEM = "Set by the system";
const join = (...parts: string[]) => parts.join(" · ");
const TRACKER = join(UPDATE_WEBHOOK, UPDATE_AUTO, UPDATE_MANUAL);

const UPDATE_OVERRIDES: Record<string, string> = {
  // the tracker's own state: read in real time, repaired daily, and read again by the button
  status: TRACKER, gh_state: TRACKER, issues_closed: TRACKER, issues_total: TRACKER, delivery_progress_pct: TRACKER, blocked_issues: TRACKER,
  stale_issues: TRACKER, open_prs: TRACKER, merged_prs: TRACKER, ci_status: TRACKER, latest_release: TRACKER, repositories: TRACKER, gh_last_activity: TRACKER,
  // the board's Status field arrives by webhook; iteration and target date are read with it
  gh_project_status: TRACKER,
  gh_iteration: join(UPDATE_AUTO, UPDATE_MANUAL, "read again whenever Status changes"),
  gh_target_date: join(UPDATE_AUTO, UPDATE_MANUAL, "read again whenever Status changes"),
  // texts: you own them, Sync with GitHub compares and sends after you confirm
  initiative_name: join(UPDATE_EDIT, UPDATE_MANUAL), summary: join(UPDATE_EDIT, UPDATE_MANUAL), description: join(UPDATE_EDIT, UPDATE_MANUAL), hypothesis: join(UPDATE_EDIT, UPDATE_MANUAL),
  screenshots: join(UPDATE_EDIT, UPDATE_MANUAL),
  assignees: join(UPDATE_EDIT, UPDATE_MANUAL, "GitHub's side arrives by webhook"),
  github_links: join(UPDATE_MANUAL, "or Pull in from Incoming issues"),
  sync_state: "After every sync", last_synced: "After every sync", synced_with: "After every sync",
  tracker_ownership: "You: Take ownership or Make read only on the GitHub tab, or the choice when you pull an issue in",
  planned_scope: "You, with Mark breakdown complete", breakdown_route: "Set when the tracking issue is first sent", breakdown_status: join("Set when the tracking issue is first sent", "you mark it complete"),
  scope_added: join(UPDATE_CALCULATED, "after every tracker read"), schedule_variance_pp: join(UPDATE_CALCULATED, "after every tracker read"),
};

function updatedBy(f: FieldDef, link: Link): string {
  const o = UPDATE_OVERRIDES[f.key];
  if (o) return o;
  if (f.mode === "computed") return UPDATE_CALCULATED;
  if (f.mode === "system") return UPDATE_SYSTEM;
  if (f.mode === "locked" || f.storage.startsWith("GitHub-synced")) return TRACKER;
  // an editable column the tracker can carry (an optional label, field or date) is sent by Sync with GitHub
  return /^(sent to|both)/i.test(link.github) ? join(UPDATE_EDIT, UPDATE_MANUAL) : UPDATE_EDIT;
}

/** First sentence of the dictionary description, kept short. */
const sentence = (text: string | null): string => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const first = t.split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > 120 ? `${first.slice(0, 117).trimEnd()}…` : first;
};

/** Open lists and generated lists have no fixed values to print: say how they work instead. */
const OPEN_LISTS: Record<string, string> = {
  theme: "The Initiative Group the item belongs to. Open list: type any name; groups are managed in Settings.",
  focus_area: "The area of the product the item works on. Open list: type any value; the values already in use are offered.",
  audience: "Who the item is for. Open list: type any value; the values already in use are offered.",
  g2m_quarter: "Calendar quarter the work is planned for, chosen by a person. Any quarter from last year to three years ahead.",
};

/** Dictionary descriptions that are out of date or only repeat the values. */
const WHAT_OVERRIDES: Record<string, string> = {
  status: "State of the tracking issue's work, set by the tracker.",
  initiative_phase: "Where the initiative is in its lifecycle, set by people.",
  change_type: "Kind of change.",
  value_type: "How the initiative creates business value. Replaces the hidden Roadmap Category as the strategic category.",
  value_basis: "How the business value was arrived at.",
  confidence: "Confidence in the business value.",
  moscow: "Priority class.",
  decision: "Go or no-go call, set by people only.",
  horizon: "Now, Next or Later bucket for the roadmap view. Empty means unscheduled.",
  outcome_verdict: "Outcome compared with the key result.",
  created_via_values: "The ways an item can be created.",
  locked_by_source: "True when the value comes from the tracker (status, progress, PR, CI).",
};

/** What the column is, and, when it holds one of a fixed set of states, every state in full. */
function describe(f: FieldDef): string {
  if (OPEN_LISTS[f.key]) return OPEN_LISTS[f.key]!;
  let lead = WHAT_OVERRIDES[f.key] ?? sentence(f.description);
  if (f.allowed.length > 0) {
    if (!WHAT_OVERRIDES[f.key]) lead = (lead.includes(":") ? lead.split(":")[0]! : lead).replace(/^Always one of$/, "");
    // a description that only repeats the values adds nothing
    if (f.allowed.some((v) => lead.startsWith(v)) || lead.endsWith("so on")) lead = "";
    return `${lead ? `${lead.replace(/[.?!\s]+$/, "")}${/[?]$/.test(lead) ? "?" : "."} ` : ""}Values: ${f.allowed.join(" · ")}.`;
  }
  return lead;
}

function derive(f: FieldDef): Link {
  const g = f.githubSync?.trim() ?? "";
  if (g === "" || /^(not synced|n\/a)/i.test(g)) return same(NONE);
  if (/^never synced/i.test(g)) return same(COMMERCIAL);
  if (f.mode === "locked" || f.storage.startsWith("GitHub-synced")) return { github: "From GitHub, read-only", jira: "From Jira, read-only (planned)" };
  return { github: sentence(g), jira: "Per mapping (planned)" };
}

/** "Read/write", "Read-only (tracker)" or "Read-only", from the dictionary. */
export function accessLabel(keys: string[]): string {
  const kinds = new Set(keys.map((k) => {
    const f = FIELD_BY_KEY[k];
    if (!f) return "?";
    if (f.mode === "editable") return "Read/write";
    if (f.mode === "locked" || f.storage.startsWith("GitHub-synced")) return "Read-only (tracker)";
    return "Read-only";
  }));
  return [...kinds].join(" / ");
}

/** One row for every column the app shows (the dictionary without the hidden fields, e.g. Roadmap Category), in dictionary order. */
export const COLUMN_ROWS: ColumnRow[] = VISIBLE_FIELDS.map((f) => {
  const link = OVERRIDES[f.key] ?? derive(f);
  return { key: f.key, group: f.group, column: f.name, what: describe(f), github: link.github, jira: link.jira, access: accessLabel([f.key]), updated: updatedBy(f, link) };
});

export const COLUMN_GROUPS: string[] = [...new Set(COLUMN_ROWS.map((r) => r.group))];
export const OVERRIDE_KEYS: string[] = Object.keys(OVERRIDES);
export const UPDATE_OVERRIDE_KEYS: string[] = Object.keys(UPDATE_OVERRIDES);

export const COLUMNS_NOTE = "Jira is planned: its mapping is chosen per customer. Nothing goes to GitHub or Jira until you confirm. When you delete an initiative whose Jira issue Product Velocity owns, Sync with Jira offers, under Removed in Product Velocity, to label the issue pv:removed and close it; you confirm each one, and an issue that came from Jira is never touched. Sync with GitHub does the same for an issue Product Velocity owns: it adds the label pv:removed and closes the issue as not planned, you confirm each one, and an issue that is only followed from GitHub is never touched.";

export const UPDATE_LEGEND = "Webhook: GitHub tells the app the moment something changes. Auto sync: the app compares with GitHub once a day and repairs any difference. Manual sync: you press Sync with GitHub (or Check GitHub now in Settings), which also reads GitHub first.";

export type Table = { head: string[]; rows: string[][] };

export const FLOW_READ: Table = {
  head: ["Step", "What happens", "Where"],
  rows: [
    ["1. Connect", "Link GitHub (Jira is planned) and choose the repositories", "Account menu: Workspace admin, GitHub"],
    ["2. Choose", "Each issue is Not pulled, Pulled in or Ignored. Rules set the default for new issues. Nothing is pulled in by itself", "Account menu: This workspace, Incoming issues"],
    ["3. Pull in", "A pulled-in issue becomes an initiative. Choose Read only (it follows the issue) or Product Velocity owns it. Its tracker columns stay read-only either way", "Incoming issues: Pull in"],
    ["4. Clean up", "Rename, merge duplicates, regroup, rank, add value and owners. Every change can be undone with Ctrl+Z", "Grid, side panel, bulk bar"],
    ["5. Take ownership", "Choose it when you pull in, or later with Take ownership on the GitHub tab (Make read only undoes it). Product Velocity then sends the name, summary, description and hypothesis after a preview and a confirmation. You own phase, status, rank, value and decisions; the tracker owns build status, progress and PR/CI", "GitHub tab of the side panel; column Tracker Ownership"],
    ["6. Sync", "Sync with GitHub first lists issues that are new in GitHub, so you can pull them in or ignore them. Then it shows what came in, what will go out and any conflict. Nothing is sent until you confirm", "Grid: Sync with GitHub"],
  ],
};

export const FLOW_CREATE: Table = {
  head: ["Way in", "How", "You get"],
  rows: [
    ["Quick add", "Type a name, press Enter. Add #group @person M ~now in the same line", "One initiative"],
    ["Paste a list", "Paste from Excel or one line per initiative, then map the columns", "Up to 200 initiatives"],
    ["Discovery (Claude)", "Run write_discovery with a short brief", "One initiative in Discover and a discovery document"],
    ["PRD (Claude)", "Run write_prd with a brief, or on an existing initiative", "Fields filled, a PRD document, a Description extract to confirm"],
    ["Execute", "Sync with GitHub on the initiative", "A tracking issue with only the allowed fields, after you confirm"],
  ],
};

export const FLOW_LIFECYCLE: Table = {
  head: ["Phase", "What happens", "Evidence in Product Velocity", "Gate at the end"],
  rows: [
    ["Discover", "Objective, problem, evidence, candidate solutions. People choose one", "Discovery document", "Gate A: discovery approved"],
    ["Define", "Write the PRD, align on why, what, how and when, estimate, rank", "PRD, alignment, effort, Stack Rank", "Gate B: PRD approved, ready for build"],
    ["Build", "Engineers deliver in GitHub or Jira", "Build Status, progress, PRs and CI (read-only)", "None: a Creator moves it to Test"],
    ["Test", "Limited release to check it works", "Health, notes", "None: a Creator moves it to Experiment"],
    ["Experiment", "Test with a population against a threshold", "Rollout plan in the PRD", "Gate C: may it roll out?"],
    ["Roll-out", "Widen to the target markets and customers", "Customers live, adoption", "None: set Initiative Status to Completed"],
    ["Completed", "Measure the outcome against the key result (reviews at +30, +60 and +90 days)", "Outcome fields, learning", "None"],
  ],
};

export const LIFECYCLE_NOTES = [
  "People move the phase. Claude and the tracker never do; the app may suggest Test when the build is done in GitHub or Jira. A suggestion is one click for you to accept.",
  "Initiative Status (Active, On hold, Completed, Cancelled) is set by people only. Setting it to Completed moves the phase to Completed; a closed ticket means the build is done, not the initiative.",
  "The phase cell in the grid is read-only. Use Request gate, Decide or Move to next phase (item panel, multi-select bar, command palette).",
  "Items sync to GitHub or Jira from Gate B. Before that, an optional Request engineering review sends the name, summary, description and hypothesis while the PRD is in review. Discover never syncs.",
  "Syncing stops 14 days after an initiative is Completed or Cancelled; an approver or admin can resume it.",
];

// ---------------------------------------------------------------------------------------------------------------------------------------
// Decision gates (issue #323, docs/28-DECISION-GATES.md)

export const GATES_INTRO = "A decision gate is the one moment where a person with approval rights says whether an initiative may move on. There are three: A, B and C. Claude can prepare the gate pack (evidence and a checklist) but never decides.";

export const GATES_TABLE: Table = {
  head: ["Gate", "Between", "The question", "What passing does"],
  rows: [
    ["A", "Discover and Define", "Is this worth defining? Is the discovery solid?", "Approves the discovery document and moves the phase to Define"],
    ["B", "Define and Build", "Do we commit to build it?", "Approves the PRD (the only place a PRD is approved), moves the phase to Build and marks it Ready for build until the tracker starts; offers the GitHub or Jira handover"],
    ["C", "Experiment and Roll-out", "Did the experiment pass, and may it roll out?", "Moves the phase to Roll-out"],
  ],
};

export const GATES_STEPS: Table = {
  head: ["Step", "Who", "What happens"],
  rows: [
    ["1. Request", "Creator or above", "Request gate A, B or C on one item or on a selection. Gate Status becomes In review. A checklist shows what is missing; it informs, it does not block."],
    ["2. Decide", "Anyone with approval rights for that gate", "Go, Go with conditions, Hold or Stop, with a rationale that cannot be edited later. The first decision wins; the others see it closed. You may approve your own request."],
    ["3. Complete", "The app, in one step", "Records the decision, moves the phase and its start date, approves the document (gate A: discovery, gate B: PRD), sets Ready for build at gate B, and writes the audit log. Sending to GitHub or Jira still needs your confirmation."],
  ],
};

export const GATES_OUTCOMES: Table = {
  head: ["Outcome", "What it means"],
  rows: [
    ["Go", "Move on. The phase changes."],
    ["Go with conditions", "Move on, and each condition becomes a task that is tracked until it is done."],
    ["Hold", "Stay in the phase and come back (a review date is recorded)."],
    ["Stop", "Do not continue. Initiative Status becomes Cancelled and you are offered to close the tracker issue."],
  ],
};

export const GATES_NOTES = [
  "Fast lane: the person who decides can pick a later phase and tick Fast lane with a comment. The skipped phases and gates are recorded as Skipped (fast lane). There are no size or confidence checks; it is your call.",
  "There is no auto-pass. Nothing moves through a gate without a person deciding.",
  "Who can decide is set per gate in Settings, Workspace. Admins can by default; you can give any account approval rights. Claude, service accounts and staff impersonation never can.",
  "Decisions screen: every gate request, filtered by Waiting for approval (the default), Decided, Requested by me, and Can decide. Open a row to read the gate pack; J and K move through the list.",
  "Multi-select bar: Request gate, Decide (one rationale for all selected, with a confirmation listing each item) and Move to next phase.",
  "The outcome review at +30, +60 and +90 days is not a gate; it is a scheduled review after Roll-out.",
];

// ---------------------------------------------------------------------------------------------------------------------------------------
// Reports (issue #233 Overview, request R-129 / issue #287 Roadmap Health): what each report answers and how its numbers are defined.

export const REPORTS_INTRO = "The Reports tab has a list of reports next to its title; Overview opens first. The filters, the click-to-filter pills and the two toggles (archived, AI drafts) are shared, so they stay when you switch reports, and the address keeps the report and the filters so you can share a link.";

export const REPORTS_LIST: Table = {
  head: ["Report", "What it answers", "What is on it"],
  rows: [
    ["Overview", "What is the shape of the roadmap, and how long does work take to reach the market?", "Donuts by Status, Phase, Focus Area, Team and MoSCoW; stacked bars by Product Manager, Team, Group, Status and Health; Impact and Effort; Time to Market; the timeline; the matching initiatives; CSV export"],
    ["Roadmap Health", "Where does active work pile up, how long has it been in its phase, and what is Blocked, At Risk or Delayed?", "Counts of active, Blocked, At Risk and Delayed initiatives; active initiatives by Team and Phase and by Team and Health; median days in the current phase for each phase; the 10 initiatives that have waited longest; completed delivery duration; every active initiative with days in phase and age"],
  ],
};

export const ROADMAP_HEALTH_DEFINITIONS: Table = {
  head: ["Term", "How it is counted"],
  rows: [
    ["Active", "Initiative Status is Active. On hold, Completed and Cancelled are not counted (completed ones feed only the completed delivery duration)."],
    ["Blocked, At Risk, Delayed", "The Health column of active initiatives, counted separately. Click one to filter every chart and the list to it; click again to remove it."],
    ["Days in current phase", "Today minus the start date of the phase the initiative is in (Start Discovery, Start Definition, Start Building, Start Test, Start Experiment, Start Roll-Out), else the day Phase Changed At."],
    ["Age", "Today minus Start Date, else Planned Start."],
    ["No date", "An initiative whose date is empty, invalid or in the future is not left out silently: the summary counts them and the list says No date."],
    ["Completed delivery duration", "The Time to Market card, for completed initiatives only: G2M Date (actual) minus the earlier of Start Discovery and Start Date, with the median, the distribution, the number counted and the number excluded."],
    ["Several teams", "An initiative with several teams counts once per team, so team bars can add up to more than the number of initiatives. The chart says so."],
  ],
};

export const ROADMAP_HEALTH_NOTES = [
  "Roadmap Health only reads: nothing is edited from it, and it uses no commercial field (value, confidence, customers, decisions, key results).",
  "Each chart has Show as table with the same numbers, and health always has a text label, never colour alone.",
];

// ---------------------------------------------------------------------------------------------------------------------------------------
// AI agents (request #230): what they are for in the Product Velocity flow, and how to set up and use Claude, ChatGPT and Gemini.
// The setup steps come from the same list as the Connect an AI assistant page (setupGuides), so the two cannot disagree.

export const AGENT_TABS = [
  { id: "use-cases", label: "Use-cases" },
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "gemini", label: "Gemini" },
] as const;
export type AgentTabId = (typeof AGENT_TABS)[number]["id"];

export const AGENT_INTRO =
  "An AI agent is an assistant you already use (Claude, ChatGPT or Gemini) connected to Product Velocity. It works as you, with your role, reads what you can read, and writes drafts you review. It never approves anything and never sets Stack Rank, Decision, Value or Confidence.";

export const AGENT_USE_CASES: Table = {
  head: ["Use-case", "What the agent does in the flow", "Say, for example", "Where it lands"],
  rows: [
    ["Brainstorm", "Thinks with you before anything exists. It reads the workspace (projects, groups, teams, fields, related initiatives and their documents) and the company profile, so ideas fit what you already plan. Nothing is written until you say so.", "\"Search initiatives related to loyalty and retention. Which overlap with this idea, and what could we test first?\"", "Only the chat. Save nothing"],
    ["Create", "Turns a brief into a discovery or a PRD, asks once for what is missing (including who is on the team), shows a dry run, then creates the initiative and the document as AI drafts.", "\"Use write_discovery. Brief: customers leave after the first month. Team: product manager = Ana, designer = Li.\"", "Initiative fields plus a document on the Spec tab. Full documents never go to GitHub"],
    ["Review", "Reads a document or initiative and reports: unclear acceptance criteria, missing risks, claims without evidence, a light roll-out plan, partner claims the partner does not support. It changes nothing.", "\"Review the PRD of R-12. Do not change anything yet.\"", "Only the chat, with the codes it looked at"],
    ["Prepare a gate", "Reads one initiative and gathers the case for a decision gate: the checklist (what is filled in, what is missing), its documents and their status, past requests and decisions, open conditions. It writes a short summary for the person who decides. It cannot request, decide or approve a gate, or move a phase.", "\"Use get_gate_pack for R-12 and summarise the case for gate B.\"", "In the chat only; a person decides in Decisions"],
    ["Update", "Revises a document (a new version, the old one kept) or fills empty fields. Changes to fields a person already filled come back as a diff you confirm first. A second assistant can review what the first wrote.", "\"Update the PRD of R-12 with what we decided today. Show me the diff.\"", "A new document version, with the AI tool and model that wrote it. Undo with undo_last"],
  ],
};

export const AGENT_ADVANTAGES: { title: string; text: string }[] = [
  { title: "Company profile (memory of the company)", text: "Industry, products, personas, competitors, partners, glossary and voice, drafted by the agent from your website (research_company) and confirmed by a workspace admin. Every later PRD or discovery uses it, so documents sound like your company and reuse your terms. Set the Company website in Workspace settings, run research_company once, and an admin confirms it under Company profile." },
  { title: "Project and workspace context", text: "On connect the agent reads your projects, Initiative Groups, teams, members, the field list with allowed values, and the open lists in use. It uses your spelling, existing groups and real field values instead of inventing them." },
  { title: "Prior knowledge", text: "Before it drafts, the agent searches related initiatives, reads at most five of their PRDs and discoveries, and tells you which it used. Terms, key results and risks stay consistent across the roadmap." },
  { title: "Research that is checked", text: "Partners and unfamiliar terms in a brief are looked up in the profile first and researched from public sources only when missing. Your claims about a partner are compared with what the partner publishes, and mismatches come back as questions. It never invents a competitor claim." },
  { title: "The team, not the account", text: "Documents start with a Team table (product manager, designer, engineering manager and others). Tell the agent who is on the team; it does not put the signed-in account's name as owner." },
  { title: "Comparable by AI tool and model", text: "Every document version records which AI tool wrote it (from the connection) and which model the agent says it is. A PRD written with Claude and reviewed by ChatGPT shows both. The same two columns are on every entry of the audit log, not only on documents. Account admins see every submission under Settings, Audit log, Document submissions; platform admins see all accounts." },
  { title: "Safe by design", text: "One server, the same rules for every agent: your role limits it, text in documents is data and never instructions, everything it writes is an AI draft and audited with who, when, the source MCP, which AI tool (Claude, ChatGPT or Gemini, taken from the connection) and which model the agent says it is, a document an agent writes is held back from the GitHub issue and Jira description until you accept it, and is then shared at the next Sync unless you choose “Do not share” on it, and sending anything outside needs your confirmation. It cannot close a Jira issue, close a GitHub issue or confirm a sync: only a person can, in Sync with Jira or Sync with GitHub." },
];

const guide = (a: "claude" | "chatgpt" | "gemini") => setupGuides("the connector URL shown under Connect an AI assistant").find((g) => g.assistant === a)!;

export type AgentGuide = { title: string; setup: string[]; snippet?: string; onboarding: string[]; features: Table; notes: string[] };
const ONBOARD_ADMIN = "Admin, once: account menu, You, Connect an AI assistant, switch on AI assistants for the workspace (they are off by default). Then set the Company website under Workspace admin, Workspace settings.";
const ONBOARD_CONNECT = "Each person: connect the assistant (above), sign in to Product Velocity, choose one or several workspaces and approve on the consent screen. With several workspaces the agent asks which one you mean.";
const ONBOARD_PROFILE = "First task: ask for the company profile (research_company). It shows what it found section by section and saves a draft; an admin confirms it under Company profile.";
const REVOKE = "You can revoke a connection at any time under Connect an AI assistant; it stops on the next call. Admins see every connection (names and counts, no content).";

export const AGENT_GUIDES: Record<"claude" | "chatgpt" | "gemini", AgentGuide> = {
  claude: {
    title: "Claude (claude.ai, the desktop app, Claude Code)",
    setup: guide("claude").steps,
    snippet: guide("claude").snippet?.code,
    onboarding: [ONBOARD_ADMIN, ONBOARD_CONNECT, ONBOARD_PROFILE, "After a Product Velocity update, reconnect it in Claude to pick up new tools and prompts.", REVOKE],
    features: {
      head: ["What", "How to start in Claude", "Result"],
      rows: [
        ["Discovery", "Prompt write_discovery (brief, item, team). In claude.ai type / and pick it; in Claude Code type /mcp__product-velocity__write_discovery", "A Discovery document and one initiative in Discover"],
        ["PRD", "Prompt write_prd (brief, modules such as A1 D1 D4, item, team)", "A PRD document and the initiative fields it can support"],
        ["Company profile", "Prompt research_company (url, focus)", "A draft profile for an admin to confirm"],
        ["Several initiatives", "Ask in plain words: create initiatives from this list in group Growth, project Marketplace", "A dry run first, then created after you agree"],
        ["Change what exists", "Name the initiative, e.g. R-12, and say what to change", "A diff to confirm when a person already filled the field; undo with \"undo your last change\""],
        ["Documents, files and links", "Write documents, attach screenshots or PDFs and add links on the Spec tab (drag and drop, paste an image or a web address); each is shared with the issue unless you choose Do not share", "Spec tab of the initiative; documents and file links are not written to the issue of a public repository"],
      ],
    },
    notes: ["Claude first asks whether to save the draft or show it in the chat to align; say which in your prompt to skip the question.", "Claude Code can also work in your repository while it reads Product Velocity; it has the same role limits."],
  },
  chatgpt: {
    title: "ChatGPT",
    setup: guide("chatgpt").steps,
    onboarding: [ONBOARD_ADMIN, "ChatGPT Business, Enterprise and Edu: a ChatGPT workspace admin must allow custom connectors (Developer mode) before anyone can add one.", ONBOARD_CONNECT, ONBOARD_PROFILE, REVOKE],
    features: {
      head: ["What", "How to start in ChatGPT", "Result"],
      rows: [
        ["Discovery, PRD, company profile", "ChatGPT cannot start prompts. Say \"use the write_discovery playbook\" (or write_prd, research_company) and give the brief and the team. It reads the same instructions through the get_playbook tool", "The same documents and AI drafts as with Claude"],
        ["Deep research and company knowledge", "Ask in a research chat. ChatGPT uses two read-only tools, search and fetch, to read your initiatives and documents", "Findings that cite initiative codes; nothing is written"],
        ["Several initiatives, changes, files", "Ask in plain words, as with Claude", "A dry run or diff first, then written after you agree"],
        ["Confirmations", "ChatGPT asks you to confirm each tool call that changes something", "Product Velocity still shows its own dry run or diff first"],
      ],
    },
    notes: ["Use Developer mode in a normal chat for writing. Deep research mode only reads.", "The ChatGPT connector is new: if a step looks different in your plan or region, look for \"custom connector\" or \"MCP server\" and tell your admin which step failed."],
  },
  gemini: {
    title: "Gemini (Gemini CLI and Code Assist agent mode)",
    setup: guide("gemini").steps,
    snippet: guide("gemini").snippet?.code,
    onboarding: [ONBOARD_ADMIN, ONBOARD_CONNECT, ONBOARD_PROFILE, "Optional: install the Gemini extension in the repository's connectors/gemini folder; it adds a context file with the house rules and the flow names. Replace the placeholder address with your deployment's before installing.", REVOKE],
    features: {
      head: ["What", "How to start in Gemini", "Result"],
      rows: [
        ["Sign in", "/mcp auth product-velocity (opens a browser to sign in and approve)", "A connection you can revoke"],
        ["Check the connection", "/mcp lists the server, its tools and its prompts", "Product Velocity listed as connected"],
        ["Discovery, PRD, company profile", "Type / and pick write_discovery, write_prd or research_company, or ask in plain words", "The same documents and AI drafts as with Claude"],
        ["Several initiatives, changes, files", "Ask in plain words, as with Claude", "A dry run or diff first, then written after you agree"],
      ],
    },
    notes: ["The consumer Gemini app has no custom connectors today. Other Gemini clients that support remote MCP with OAuth can use the same connector URL.", "Tool definitions are simplified for Gemini; Product Velocity still checks every value on the server.", "The Gemini connector is new: report what does not work so it can be fixed."],
  },
};

export const AGENT_TIPS = "Name the initiative code, the group and the project. Paste the source text, do not summarise it. Name the team (product manager = ..., designer = ...). Say \"show me first\" when you want to align before anything is saved.";
