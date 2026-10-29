import { FIELD_BY_KEY } from "@pv/domain";

/**
 * Text of the Help guide. Short on purpose. The columns table is checked against the field dictionary (help-content.test.ts):
 * every key exists, and whether a column is read-only comes from the dictionary, not from this file.
 */
export type ColumnRow = { keys: string[]; columns: string; what: string; github: string; jira: string };

const NONE = "Not synced";
const COMMERCIAL = "Never synced (commercial)";

export const COLUMN_ROWS: ColumnRow[] = [
  { keys: ["item_code"], columns: "Initiative ID", what: "Stable ID (R-01…)", github: "Backlink in the issue body", jira: "Backlink in the issue description" },
  { keys: ["initiative_name"], columns: "Initiative Name", what: "The initiative's title", github: "Issue title", jira: "Summary" },
  { keys: ["description"], columns: "Description", what: "What and why, Markdown", github: "Issue body (managed block)", jira: "Description" },
  { keys: ["hypothesis"], columns: "Initiative Hypothesis", what: "IF / THEN / RESULTING IN", github: "Issue body (managed block)", jira: "Description" },
  { keys: ["summary"], columns: "Summary", what: "Short text shown to participants", github: "Issue body (managed block)", jira: "Description" },
  { keys: ["initiative_phase"], columns: "Initiative Phase", what: "Discover to Sunset", github: "Not synced. May suggest Build when work starts", jira: "Not synced" },
  { keys: ["initiative_status"], columns: "Initiative Status", what: "Active, On hold, Completed, Cancelled", github: "Not synced. A closed issue never sets it", jira: "Not synced. A closed issue never sets it" },
  { keys: ["health"], columns: "Health", what: "On Track, At Risk, Delayed, Blocked", github: "Not synced. Signals only suggest", jira: "Not synced" },
  { keys: ["stack_rank"], columns: "Stack Rank", what: "Global priority order", github: "Optional: Priority field or label", jira: "Optional: Priority" },
  { keys: ["moscow", "effort", "theme", "tags"], columns: "MoSCoW, Effort, Initiative Group, Tags", what: "Planning labels", github: "Optional: labels (Effort: size field)", jira: "Optional: labels or custom field" },
  { keys: ["planned_start", "g2m_date_est"], columns: "Planned Start, G2M Date (est)", what: "Dates you plan", github: "Optional: date field, milestone due date", jira: "Optional: start and due date" },
  { keys: ["home_project"], columns: "Home Project", what: "Where delivery is tracked", github: "Chooses the repository", jira: "Chooses the Jira project" },
  { keys: ["assignees"], columns: "Assignees", what: "Who is on the work", github: "Issue assignees, two-way", jira: "Assignee" },
  { keys: ["github_links"], columns: "GitHub Links", what: "The linked tracking issue", github: "Tracking issue", jira: "Jira issue link" },
  { keys: ["status"], columns: "Build Status", what: "Not started, In progress, Done, Cancelled", github: "Issue open or closed", jira: "Status category" },
  { keys: ["issues_closed", "issues_total", "delivery_progress_pct", "blocked_issues", "stale_issues"], columns: "Issues Closed, Issues Total, Delivery Progress %, Blocked, Stale", what: "Progress of the child work", github: "Sub-issues of the tracking issue", jira: "Child issues of the epic" },
  { keys: ["open_prs", "merged_prs", "ci_status", "latest_release"], columns: "Open PRs, Merged PRs, CI Status, Latest Release", what: "Delivery evidence", github: "Pull requests, checks, releases", jira: "Bitbucket via issue keys" },
  { keys: ["gh_project_status", "gh_iteration", "gh_target_date", "gh_last_activity"], columns: "Delivery Status, Iteration, Target Date, Last Activity", what: "Where the work sits on the board", github: "Projects v2 board and issue activity", jira: "Board status, sprint, due date" },
  { keys: ["value_12m", "confidence", "value_type", "customers_requesting", "kr_metric", "decision", "realized_kr_value", "cost_of_not_doing"], columns: "Business Value, Confidence, Customers, Key results, Decision, Outcomes, Cost of Not Doing", what: "Commercial and decision fields", github: COMMERCIAL, jira: COMMERCIAL },
  { keys: ["sponsor", "product_manager", "engineering_manager", "audience", "gtm_enablement_notes", "visibility"], columns: "People, Audience, GTM notes, Visibility, other columns", what: "Everything else", github: NONE, jira: NONE },
  { keys: ["crowd_rank", "value_weighted", "adoption_pct", "days_in_phase", "created_at"], columns: "Crowd Rank, weighted value, adoption, days in phase, created at", what: "Calculated or system-set", github: NONE, jira: NONE },
];

export const COLUMNS_NOTE = "All 169 columns are in the grid's Columns picker. Jira is planned: its mapping is chosen per customer, and nothing goes to GitHub or Jira until you confirm.";

/** "Read/write" or the reason a column cannot be edited. A row holding several columns shows each kind once. */
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

export type Table = { head: string[]; rows: string[][] };

export const FLOW_READ: Table = {
  head: ["Step", "What happens", "Where"],
  rows: [
    ["1. Connect", "Link GitHub (Jira is planned) and choose the repositories", "Account menu: GitHub"],
    ["2. Choose", "Each issue is Not pulled, Pulled in or Ignored. Rules set the default for new issues. Nothing is pulled in by itself", "Account menu: Incoming issues"],
    ["3. Pull in", "A pulled-in issue becomes an initiative. Its tracker columns stay read-only", "Incoming issues: Pull in"],
    ["4. Clean up", "Rename, merge duplicates, regroup, rank, add value and owners. Every change can be undone with Ctrl+Z", "Grid, side panel, bulk bar"],
    ["5. Take ownership", "From now on you own phase, status, rank, value and decisions. The tracker owns build status, progress and PR/CI", "Grid"],
    ["6. Sync", "Sync with GitHub shows what came in, what will go out and any conflict. Nothing is sent until you confirm", "Grid: Sync with GitHub"],
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
  head: ["Phase", "What happens", "Evidence in Product Velocity"],
  rows: [
    ["Discover", "Objective, problem, evidence, candidate solutions. People choose one", "Discovery document"],
    ["Define", "Write the PRD, align on why, what, how and when, estimate, rank", "PRD, alignment, effort, Stack Rank"],
    ["Build", "Engineers deliver in GitHub or Jira", "Build Status, progress, PRs and CI (read-only)"],
    ["Beta-test", "Limited release to check it works", "Health, notes"],
    ["Experiment", "Test with a population against a threshold", "Rollout plan in the PRD"],
    ["Roll-out", "Widen to the target markets and customers", "Customers live, adoption"],
    ["Completed", "Measure the outcome against the key result", "Outcome fields, learning"],
    ["Sunset", "Retire it", "Initiative Status"],
  ],
};

export const LIFECYCLE_NOTES = [
  "People move the phase. Claude and the tracker never do; the app may suggest Build when the first child issue starts.",
  "Initiative Status (Active, On hold, Completed, Cancelled) is set by people only. A closed ticket means the build is done, not the initiative.",
  "Decision gates G1 to G4 (Go, Hold, Kill) are decided by a person with the Approver permission. Claude can prepare, never approve.",
];

export const CLAUDE_OPTIONS: Table = {
  head: ["What", "How to start", "Result", "Stays in Product Velocity"],
  rows: [
    ["Discovery document", "Prompt write_discovery (optional: brief, item)", "Document of kind Discovery and one initiative in Discover", "Yes, never sent to GitHub"],
    ["PRD", "Prompt write_prd (optional: brief, modules like A1 D1 D4, item)", "PRD document and initiative fields it can support", "Full PRD yes; only the extract goes to the Description"],
    ["Update a document", "Name the initiative, e.g. R-12", "A new version; the old one is kept", "Yes"],
    ["Other documents", "Ask for business requirements, technical requirements, acceptance criteria, research", "A document on the initiative", "Yes"],
    ["Several initiatives", "Paste notes or a PRD and ask for initiatives", "A dry run first, then created after you agree", "Fields only"],
  ],
};

export const CLAUDE_RULES = [
  "Connect Claude first: account menu, Connect Claude. Claude then works as you, with your role.",
  "Claude asks once for what is missing. Answer, or say skip. It never invents numbers, dates, customers or competitors; gaps read \"to define\".",
  "Claude shows a dry run or a diff before writing. It never sets Stack Rank, Decision, Business Value or Confidence, and never approves.",
  "Everything it writes is an AI draft and can be undone with undo_last.",
];

export const CLAUDE_PROMPTS: { when: string; prompt: string }[] = [
  { when: "Start an idea", prompt: "Use write_discovery. Brief: customers leave after the first month. Objective is to improve retention. I have support tickets and churn data; ask me what you need." },
  { when: "Turn a discovery into a PRD", prompt: "Use write_prd for R-12. Read its discovery document first and reuse the objective, key results and risks. Show me the draft here before you save." },
  { when: "PRD from your own notes", prompt: "Use write_prd with modules A1, D1 and D4. Brief: (paste your notes). List what you could not fill in one message." },
  { when: "Several initiatives at once", prompt: "Create initiatives from this list in group Growth, project Marketplace. Do a dry run first and show me the values." },
  { when: "Find overlap before you add", prompt: "Search for initiatives related to loyalty and retention. Tell me which overlap with this brief and which I should link with Related To." },
  { when: "Improve a draft", prompt: "Review the PRD of R-12. List unclear acceptance criteria, missing risks and anything that sounds like a claim without evidence. Do not change anything yet." },
  { when: "Tighten the rollout", prompt: "Check D1 of R-12. Does every experiment have a metric, a threshold and a decision rule? Suggest what to add and write \"to define\" where I must decide." },
  { when: "Fix a mistake", prompt: "Undo your last change." },
];

export const CLAUDE_PROMPT_TIPS = "Name the initiative code, the group and the project. Paste the source text, do not summarise it. Say \"show me first\" when you want to align before anything is saved.";
