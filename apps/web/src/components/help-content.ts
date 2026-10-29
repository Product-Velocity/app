import { FIELDS, FIELD_BY_KEY, type FieldDef } from "@pv/domain";

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
const BODY: Link = { github: "Issue body (managed block)", jira: "Description" };
const LABELS: Link = { github: "Optional: label", jira: "Optional: label or custom field" };
const TRACKER_COUNTS: Link = { github: "Sub-issues of the tracking issue", jira: "Child issues of the epic" };
const BOARD: Link = { github: "Projects v2 board", jira: "Board status, sprint, due date" };

const OVERRIDES: Record<string, Link> = {
  item_code: { github: "Backlink in the issue body", jira: "Backlink in the issue description" },
  initiative_name: { github: "Issue title", jira: "Summary" },
  description: BODY, hypothesis: BODY, summary: BODY,
  initiative_phase: { github: "Not synced. May suggest Build when work starts", jira: NONE },
  initiative_status: same("Not synced. A closed issue never sets it"),
  health: { github: "Not synced. Signals only suggest", jira: NONE },
  stack_rank: { github: "Optional: Priority field or label", jira: "Optional: Priority" },
  moscow: LABELS, effort: { github: "Optional: size field or label", jira: LABELS.jira }, theme: LABELS, tags: { github: "Optional: labels", jira: "Labels" },
  roadmap_category: LABELS, focus_area: LABELS,
  planned_start: { github: "Optional: date field", jira: "Optional: start date" },
  g2m_date_est: { github: "Optional: date field, milestone due date", jira: "Optional: due date" },
  home_project: { github: "Chooses the repository", jira: "Chooses the Jira project" },
  assignees: { github: "Issue assignees, two-way", jira: "Assignee" },
  github_links: { github: "Tracking issue", jira: "Jira issue link" },
  status: { github: "Issue open or closed", jira: "Status category" },
  issues_closed: TRACKER_COUNTS, issues_total: TRACKER_COUNTS, delivery_progress_pct: TRACKER_COUNTS, blocked_issues: TRACKER_COUNTS,
  planned_scope: TRACKER_COUNTS,
  open_prs: { github: "Pull requests", jira: "Bitbucket via issue keys" }, merged_prs: { github: "Pull requests", jira: "Bitbucket via issue keys" },
  ci_status: { github: "Checks on the pull request", jira: "Bitbucket pipelines" }, latest_release: { github: "Latest release", jira: "Fix version" },
  gh_project_status: BOARD, gh_iteration: { github: "Projects v2 iteration", jira: "Sprint" }, gh_target_date: { github: "Projects v2 target date", jira: "Due date" },
  gh_last_activity: { github: "Issue activity", jira: "Issue updated" },
  repositories: { github: "Repositories of the linked issues", jira: "Jira projects of the linked issues" },
};

const COMMERCIAL_KEYS = ["value_12m", "value_type", "value_basis", "confidence", "customers_requesting", "kr_metric", "kr_start", "kr_target", "decision", "realized_kr_value", "realized_per_year", "cost_of_not_doing"];
for (const k of COMMERCIAL_KEYS) OVERRIDES[k] = same(COMMERCIAL);

export type ColumnRow = { key: string; group: string; column: string; what: string; github: string; jira: string; access: string };

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
  roadmap_category: "Strategic category of the initiative.",
  change_type: "Kind of change.",
  value_type: "How the initiative creates business value.",
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
  return { github: "Optional: see the item panel", jira: "Per mapping (planned)" };
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

/** One row for every column in the dictionary, in dictionary order. */
export const COLUMN_ROWS: ColumnRow[] = FIELDS.map((f) => {
  const link = OVERRIDES[f.key] ?? derive(f);
  return { key: f.key, group: f.group, column: f.name, what: describe(f), github: link.github, jira: link.jira, access: accessLabel([f.key]) };
});

export const COLUMN_GROUPS: string[] = [...new Set(COLUMN_ROWS.map((r) => r.group))];
export const OVERRIDE_KEYS: string[] = Object.keys(OVERRIDES);

export const COLUMNS_NOTE = "Jira is planned: its mapping is chosen per customer. Nothing goes to GitHub or Jira until you confirm.";

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
