import { FIELDS, FIELD_BY_KEY, setupGuides, type FieldDef } from "@pv/domain";

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
const read = (github: string, jira: string): Link => ({ github: `Read from ${lower(github)}`, jira: `Read from ${jira}` });
const JIRA_PER_MAPPING = "per mapping";
const NOT_YET = "Not sent yet (an optional label is planned)";

/**
 * Exact GitHub targets are from the push and read code (docs/04-GITHUB-SYNC.md): the tracking issue's title and managed block, the labels in the `pv:`
 * namespace, the milestone, the organisation's issue type, the linked Project board's fields, and what is read back from issues, pull requests, checks and releases.
 * Jira names are the planned targets (docs/16-ATLASSIAN.md); the customer's mapping decides the final field.
 */
const OVERRIDES: Record<string, Link> = {
  item_code: sent("Issue title prefix \"R-12: \" and the link back in the issue body", "Summary prefix and a link back in Description"),
  initiative_name: sent("Issue title (after the \"R-12: \" prefix)", "Summary"),
  summary: sent("Issue body, managed block, section \"## Summary\"", "Description"),
  description: sent("Issue body, managed block, section \"## Description\"", "Description"),
  hypothesis: sent("Issue body, managed block, section \"## Hypothesis (IF / THEN / RESULTING IN)\"", "Description"),
  artifacts: sent("Issue body, managed block, section \"## Artifacts\" (links)", "Issue links or Description"),
  screenshots: sent("Issue body, section \"## Files\" (share links, private repositories only)", "Not planned"),
  initiative_phase: { github: "Not synced. May suggest Build when the first child issue starts", jira: NONE },
  initiative_status: same("Not synced. A closed issue never sets it"),
  health: { github: "Not synced. Signals only suggest", jira: NONE },
  stack_rank: sent("Label pv:rank/top-10, top-25, top-50 or later (the band, never the number)", `Priority (${JIRA_PER_MAPPING})`),
  moscow: sent("Label pv:moscow/must, should, could or wont; board field Priority (P0, P1, P2)", `Label or custom field (${JIRA_PER_MAPPING})`),
  theme: sent("Label pv:group/<name>; board field Initiative", `Labels (${JIRA_PER_MAPPING})`),
  change_type: sent("Label pv:type/new-feature or improvement; issue Type Feature, Improvement or Enhancement", "Issue type"),
  effort: sent("Project board field Size (XS to XL)", `Custom field (${JIRA_PER_MAPPING})`),
  g2m_date_est: sent("Milestone \"YYYY Qn\" (due on the quarter's last day); board field Due date", "Due date"),
  home_project: sent("The repository that holds the tracking issue; label pv:project/<project>", "The Jira project of the issue"),
  roadmap_category: same(NOT_YET), focus_area: same(NOT_YET), tags: same(NOT_YET), planned_start: same("Not sent yet (the board's Start date is planned)"),
  assignees: { github: "Both: issue Assignees", jira: "Both: Assignee" },
  github_links: { github: "The tracking issue (repository and issue number)", jira: "The Jira issue (key)" },
  status: read("Issue state: open, closed as completed (Done), closed as not planned (Cancelled)", "Status category (To Do, In Progress, Done)"),
  gh_state: read("Issue state and state reason", "Status"),
  issues_closed: read("State of the tracking issue's sub-issues", "Status of the epic's child issues"),
  issues_total: read("Count of the tracking issue's sub-issues (epics and tasks)", "Count of the epic's child issues"),
  delivery_progress_pct: read("Closed divided by total sub-issues", "Closed divided by total child issues"),
  blocked_issues: read("Label \"blocked\" on epics and tasks", "Flagged or blocked status (per mapping)"),
  stale_issues: read("Issue updated date: no activity for 14 days", "Updated date"),
  gh_last_activity: read("Issue updated date", "Updated date"),
  open_prs: read("Pull requests linked to the issues (closing references), open", "Development panel (Bitbucket pull requests via the issue key)"),
  merged_prs: read("Pull requests linked to the issues (closing references), merged", "Development panel (Bitbucket pull requests via the issue key)"),
  ci_status: read("Checks on the default branch of the primary repository (Passing, Failing, None)", "Development panel (Bitbucket pipelines)"),
  latest_release: read("Latest published release of the linked repositories", "Fix versions (released)"),
  repositories: read("Repositories of the linked issues", "Jira projects of the linked issues"),
  gh_project_status: read("Project board field Status (the field chosen for the board)", "Board column (status)"),
  gh_iteration: read("Project board field Iteration", "Sprint"),
  gh_target_date: read("Project board field Due date or Target date", "Due date"),
  planned_scope: { github: "Counted from the sub-issues when you mark the breakdown complete", jira: "Counted from the child issues" },
  breakdown_route: { github: "Set by the app when the tracking issue is first sent", jira: "Set by the app" },
  breakdown_status: { github: "Marked complete in the app; set to Awaiting engineering when the issue is first sent", jira: "Marked complete in the app" },
};

const COMMERCIAL_KEYS = ["value_12m", "value_type", "value_basis", "confidence", "customers_requesting", "kr_metric", "kr_start", "kr_target", "decision", "realized_kr_value", "realized_per_year", "cost_of_not_doing"];
for (const k of COMMERCIAL_KEYS) OVERRIDES[k] = same(COMMERCIAL);

export type ColumnRow = { key: string; group: string; column: string; what: string; github: string; jira: string; access: string; updated: string };

/**
 * How a value gets changed (docs/04-GITHUB-SYNC.md, docs/21-SYNC-WITH-GITHUB.md):
 * a person editing, the Sync with GitHub button, the daily check (also "Check GitHub now" in Settings), or a webhook from the tracker.
 */
export const UPDATE_EDIT = "You edit it";
export const UPDATE_MANUAL = "Manual sync (Sync with GitHub)";
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

/** One row for every column in the dictionary, in dictionary order. */
export const COLUMN_ROWS: ColumnRow[] = FIELDS.map((f) => {
  const link = OVERRIDES[f.key] ?? derive(f);
  return { key: f.key, group: f.group, column: f.name, what: describe(f), github: link.github, jira: link.jira, access: accessLabel([f.key]), updated: updatedBy(f, link) };
});

export const COLUMN_GROUPS: string[] = [...new Set(COLUMN_ROWS.map((r) => r.group))];
export const OVERRIDE_KEYS: string[] = Object.keys(OVERRIDES);
export const UPDATE_OVERRIDE_KEYS: string[] = Object.keys(UPDATE_OVERRIDES);

export const COLUMNS_NOTE = "Jira is planned: its mapping is chosen per customer. Nothing goes to GitHub or Jira until you confirm.";

export const UPDATE_LEGEND = "Webhook: GitHub tells the app the moment something changes. Auto sync: the app compares with GitHub once a day and repairs any difference. Manual sync: you press Sync with GitHub (or Check GitHub now in Settings), which also reads GitHub first.";

export type Table = { head: string[]; rows: string[][] };

export const FLOW_READ: Table = {
  head: ["Step", "What happens", "Where"],
  rows: [
    ["1. Connect", "Link GitHub (Jira is planned) and choose the repositories", "Account menu: GitHub"],
    ["2. Choose", "Each issue is Not pulled, Pulled in or Ignored. Rules set the default for new issues. Nothing is pulled in by itself", "Account menu: Incoming issues"],
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
    ["Update", "Revises a document (a new version, the old one kept) or fills empty fields. Changes to fields a person already filled come back as a diff you confirm first. A second assistant can review what the first wrote.", "\"Update the PRD of R-12 with what we decided today. Show me the diff.\"", "A new document version, with the AI tool and model that wrote it. Undo with undo_last"],
  ],
};

export const AGENT_ADVANTAGES: { title: string; text: string }[] = [
  { title: "Company profile (memory of the company)", text: "Industry, products, personas, competitors, partners, glossary and voice, drafted by the agent from your website (research_company) and confirmed by a workspace admin. Every later PRD or discovery uses it, so documents sound like your company and reuse your terms. Set the Company website in Workspace settings, run research_company once, and an admin confirms it under Company profile." },
  { title: "Project and workspace context", text: "On connect the agent reads your projects, Initiative Groups, teams, members, the field list with allowed values, and the open lists in use. It uses your spelling, existing groups and real field values instead of inventing them." },
  { title: "Prior knowledge", text: "Before it drafts, the agent searches related initiatives, reads at most five of their PRDs and discoveries, and tells you which it used. Terms, key results and risks stay consistent across the roadmap." },
  { title: "Research that is checked", text: "Partners and unfamiliar terms in a brief are looked up in the profile first and researched from public sources only when missing. Your claims about a partner are compared with what the partner publishes, and mismatches come back as questions. It never invents a competitor claim." },
  { title: "The team, not the account", text: "Documents start with a Team table (product manager, designer, engineering manager and others). Tell the agent who is on the team; it does not put the signed-in account's name as owner." },
  { title: "Comparable by AI tool and model", text: "Every document version records which AI tool wrote it (from the connection) and which model the agent says it is. A PRD written with Claude and reviewed by ChatGPT shows both. Account admins see every submission under Settings, Audit log, Document submissions; platform admins see all accounts." },
  { title: "Safe by design", text: "One server, the same rules for every agent: your role limits it, text in documents is data and never instructions, everything it writes is an AI draft and audited with who, when and which connection, and sending anything outside needs your confirmation." },
];

const guide = (a: "claude" | "chatgpt" | "gemini") => setupGuides("the connector URL shown under Connect an AI assistant").find((g) => g.assistant === a)!;

export type AgentGuide = { title: string; setup: string[]; snippet?: string; onboarding: string[]; features: Table; notes: string[] };
const ONBOARD_ADMIN = "Admin, once: account menu, Connect an AI assistant, switch on AI assistants for the workspace (they are off by default). Then set the Company website in Workspace settings.";
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
        ["Files", "Attach screenshots or PDFs to an initiative, with or without a share link", "Files on the initiative; a share link is not written to the issue of a public repository"],
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
