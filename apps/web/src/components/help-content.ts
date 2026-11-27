import { FIELDS, VISIBLE_FIELDS, FIELD_BY_KEY, GUIDED_ONLY, SKILL_COMMANDS, SKILL_PLANS, SKILL_STAGE_LABEL, SKILL_TIERS, SKILL_TIER_LABEL, SKILLS, docKindLabel, includedCommands, setupGuides, type FieldDef } from "@pv/domain";

/** Every PV skill by command, generated from the catalogue so a new skill cannot ship without Help. */
const SKILL_LIST = [...GUIDED_ONLY.map((g) => g.command), ...SKILL_COMMANDS].join(", ");

/** What a skill gives you, in words: a report in a format, a document on the initiative or in Documents, and the fields it can fill. */
function skillResult(s: (typeof SKILLS)[number]): string {
  if (s.output === "advice") return "Advice in the chat: the skill that fits, what to bring and what comes before and after. Nothing is saved";
  if (s.output === "report") return "A report in the format you choose (email, slides, document, Slack message or just in the chat). Nothing is saved or sent unless you ask for a copy in Documents";
  const fields = s.fields.map((k) => FIELD_BY_KEY[k]?.name ?? k);
  const where = s.target === "none" ? `A ${docKindLabel(s.doc.kind)} document in Documents (an AI draft)` : `A ${docKindLabel(s.doc.kind)} document on the initiative's Spec tab (an AI draft)`;
  return [where, s.profileSave ? `after you agree, the relevant part can be added to the company profile (${s.profileSave.section}; an admin confirms it)` : "", fields.length ? `empty fields it can fill from the document after you agree: ${fields.join(", ")}` : ""].filter(Boolean).join("; ");
}

const STAGE_HINT: Record<string, string> = {
  direction: "Before roadmap decisions: where the product is going, how big the market is and what counts as success. These write company-level documents and can add the confirmed result to the company profile",
  discover: "When you are learning what customers need: personas, and the tree that leads from an outcome to opportunities and ideas",
  decide: "When a choice has to be made and defended: the case for it",
  define: "When an idea becomes a plan: the one-pager, the PR/FAQ, a prototype test card and the pre-mortem before a gate",
  deliver: "When the team starts to build: stories with acceptance scenarios",
  launch: "When it is about to reach customers: the go-to-market plan, release notes and what is known about competitors",
  prove: "When you need to know whether it worked: success metrics and experiments",
  run: "Every week or quarter: the weekly update and the quarter plan",
};

/** Which skill to reach for at which point, generated from the catalogue (stages in lifecycle order). */
export const AGENT_SKILL_STEPS: Table = {
  head: ["When", "Skills", "Use them when"],
  rows: (Object.keys(SKILL_STAGE_LABEL) as (keyof typeof SKILL_STAGE_LABEL)[])
    .filter((st) => SKILLS.some((s) => s.stage === st) || GUIDED_ONLY.some((g) => g.stage === st))
    .map((st) => [SKILL_STAGE_LABEL[st], [...GUIDED_ONLY.filter((g) => g.stage === st), ...SKILLS.filter((s) => s.stage === st)].map((s) => s.command).join(", "), STAGE_HINT[st] ?? ""]),
};

/** What each kind of skill is for and which skills are of that kind, generated from the plans (issue #643): a beginner starts with the guided ones. */
const TIER_HINT: Record<(typeof SKILL_TIERS)[number], string> = {
  guided: "Beginners start here. A guided skill shows its plan (\"This will run: ...\"), asks once whether you want quick or full, and runs the building blocks it needs as steps of one document. Skip any step",
  block: "One job each. They run on their own and the guided skills use them as steps",
  company: "Company level, run once and kept current. They are the sub-skills of pv-company and can add what you confirm to the company profile",
  advanced: "Stand-alone skills for a specific decision or document",
  router: "Not sure where to start? pv-which names the lightest skill for where an initiative is; pv-help lists them all",
};
export const AGENT_SKILL_TIERS: Table = {
  head: ["Kind", "Skills", "What it is for"],
  rows: SKILL_TIERS.map((t) => [
    SKILL_TIER_LABEL[t],
    Object.keys(SKILL_PLANS).filter((c) => SKILL_PLANS[c]?.tier === t).join(", "),
    TIER_HINT[t],
  ]),
};
/** What a guided skill runs, from the same data the prompt is built from: always, and offered. */
/** What a guided skill does by itself when no other skill always runs inside it. */
const OWN_WORK: Record<string, string> = { "pv-company": "Its own work: research the company and draft the profile", "pv-gate": "Its own work: the gate pack and the decision brief", "pv-outcome": "Its own work: the outcome review brief" };
export const AGENT_SKILL_INCLUDES: Table = {
  head: ["Guided skill", "Always runs", "Offered, skippable"],
  rows: [...GUIDED_ONLY, ...SKILLS]
    .filter((s) => includedCommands(SKILL_PLANS[s.command]?.includes).length > 0)
    .map((s) => {
      const inc = SKILL_PLANS[s.command]!.includes!;
      const byGate = (["A", "B", "C"] as const).filter((g) => (inc.byGate?.[g] ?? []).length > 0).map((g) => `Gate ${g}: ${(inc.byGate![g] ?? []).join(", ")}`);
      return [s.command, inc.always.join(", ") || OWN_WORK[s.command] || "None", [...inc.offered, ...byGate].join("; ") || "None"];
    }),
};

/** How to get the most out of the skills, in the order a person meets it. */
export const AGENT_SKILL_TIPS: string[] = [
  "New here? Start with a guided skill: pv-company once, then pv-discovery and pv-prd for each initiative. A guided skill shows its plan first (\"This will run: ...\"), asks once whether you want quick (only the steps that always run) or full (adds the offered ones), and lets you skip any step. It reuses what exists, such as the confirmed company personas, competitors and market and an initiative's hypothesis and key result, instead of asking again. The building blocks inside it still run on their own.",
  "Start with the company profile: ask the assistant to run pv-company, and an admin confirms it. Every skill reads it, so what it writes sounds like your company. The direction skills (pv-vision, pv-strategy, pv-northstar, pv-compete, pv-personas, pv-canvas) can then add what you confirm to the profile, which later skills use instead of asking again.",
  "Answer the one message of questions, and skip what you do not know. Nothing is invented: a gap stays \"to define\" and is listed so you can fill it later.",
  "Add --draft to see the result in the chat before anything is saved. The report skills (pv-weekly, pv-release-notes) take --format=email, slides (PowerPoint), document, slack or chat and save nothing unless you ask for a copy. They cover every initiative unless you name some: pv-weekly R-1 to R-5 --format=slides.",
  "Results land where they belong: a skill that works on an initiative saves on its Spec tab, a company-level skill saves under Documents in the account menu, and a report is delivered in the format you chose. Document text never goes to GitHub or Jira.",
  "A skill fills initiative fields only from a short block at the end of its document, only after you have seen a preview and agreed, and a field that already has a value comes back as a before-and-after to confirm. Stack Rank, Value, Confidence, Decision and approvals are always yours.",
  "To change a saved document, ask the assistant to revise it: the old version is kept. Ask it to run the skill again only when the facts have changed.",
  "Ask about a quarter the way you say it: \"the Q4-26 roadmap with statuses\", \"pv-weekly Q4-26\". A quarter always means the Planned Quarter field and is the first filter applied; an initiative without a Planned Quarter is listed apart, never guessed into a quarter.",
  "Not sure which skill? Ask pv-which and describe your situation: it recommends one skill, what to bring and what to run before or after.",
  "Skills prepare; people decide. Every document says who decides, and gates stay in the app.",
];

/** One row per skill, generated from the catalogue (packages/domain/src/skills-catalog.ts): a new skill shows up here, with its result, without anyone editing this file. */
export const AGENT_SKILLS: Table = {
  head: ["Skill", "What it does", "Works on", "You get"],
  rows: [
    ...GUIDED_ONLY.map((g) => [`${g.command} (${SKILL_STAGE_LABEL[g.stage]})`, g.summary.charAt(0).toUpperCase() + g.summary.slice(1), g.command === "pv-company" ? "The whole workspace; no initiative needed" : "One initiative (a code such as R-12), or a new idea", g.command === "pv-company" ? "A company profile draft for an admin to confirm" : g.command === "pv-discovery" ? "A discovery document and one initiative in Discover (AI drafts)" : "A PRD document and the initiative with the fields it can support (AI drafts)"]),
    ...SKILLS.map((s) => [`${s.command} (${SKILL_STAGE_LABEL[s.stage]})`, s.summary.charAt(0).toUpperCase() + s.summary.slice(1), s.output === "advice" ? "Your situation in your own words" : s.focus ? "All initiatives, or only the ones you name (codes, a range such as R-1 to R-5, a view or a group)" : s.target === "none" ? "The whole workspace; no initiative needed" : "One initiative (a code such as R-12)", skillResult(s)]),
    ["pv-help", "Lists the skills and how to use them", "Nothing", "A list in the chat"],
  ],
};

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
  artifacts: sent("Issue body, managed block, section \"## Links\" (links; a link set to \"Do not share\" on the Spec tab stays out)", "Jira description, section \"Artifacts\" (links); can be switched off per project (Field configuration)"),
  screenshots: sent("Issue body, section \"## Files\" (share links, private repositories only)", "Jira description, section \"Files\" (share links of attached files; anyone who can open the issue can open them); can be switched off per project (Field configuration)"),
  // a label goes out, but no tracker ever sets the phase back (the "You edit it" rule): so this is not a "Sent to" row
  initiative_phase: { github: "Label pm:phase/<phase> (for example pm:phase/discover) goes out; switch it off in Settings, Integrations, GitHub, Field configuration. Never set from GitHub; a first child issue may suggest Build", jira: "Label pm:phase/<phase> (for example pm:phase/discover) goes out; switch it off in Settings, Integrations, Jira, Field configuration. Never set from Jira" },
  product_manager: { github: "Not synced here: the issue assignees are the Assignees column", jira: "Sent as the assignee of a NEW issue only (matched to a Jira user by email, or by exact name when the person has no email; never changed afterwards; left empty with a note when no single user matches)" },
  initiative_status: { github: "Not synced. A closed issue never sets it", jira: "Optional per project (Settings, Integrations, Jira, Field mapping, Initiative Status in Jira): sets the Jira workflow status of the initiative's issue to the status you mapped, after the Sync preview and your confirmation; nothing comes back. Not Build Status. A closed issue never sets it" },
  health: { github: "Not synced. Signals only suggest", jira: NONE },
  stack_rank: sent("Label pm:rank/top-10, top-25, top-50 or later (the band, never the number)", "Label pm:rank/top-10, top-25, top-50 or later (the band, never the number)"),
  moscow: sent("Label pm:moscow/must, should, could or wont; board field Priority (P0, P1, P2). Each label can be switched off per project (Settings, Integrations, GitHub, Field configuration)", "Label pm:moscow/…; Priority too, once you choose a Jira priority per value (Settings, Integrations, Jira, Connect and configure, Field configuration)"),
  theme: sent("Label pm:group/<name>; board field Initiative", "Label pm:group/<name> only (the group name is not written into a Jira field)"),
  change_type: sent("Label pm:type/new-feature, improvement or bug (the label keeps its name when the value is called Feature); issue Type Feature, Improvement, Enhancement or Bug", "Label pm:type/new-feature, improvement or bug"),
  effort: { github: "Sent to project board field Size (XS to XL)", jira: "Not sent yet" },
  g2m_date_est: sent("Milestone \"YYYY Qn\" (due on the quarter's last day); board field Due date", "Due date"),
  home_project: sent("The repository that holds the tracking issue; label pm:project/<project>", "Label pm:project/<project>; the Jira project it is linked to holds the issue"),
  focus_area: sent("Label pm:focus/<value>, only when the project switches it on (Settings, Integrations, GitHub, Field configuration; off by default)", "Written into the Jira text field you choose as Theme (Settings, Integrations, Jira, Field configuration; not sent until you choose it); also label pm:focus/<value>, only when the project switches it on (off by default)"),
  value_type: sent("Label pm:value/<type> (for example pm:value/defend-revenue); switch it off in Settings, Integrations, GitHub, Field configuration. Only the type is sent, never the amount or the basis: repositories can be public, so switch it off for those", "Label pm:value/<type>; switch it off in Settings, Integrations, Jira, Field configuration. Only the type is sent, never the amount or the basis"),
  g2m_quarter: sent("Label pm:quarter/<quarter> (for example pm:quarter/q3-2027); switch it off in Settings, Integrations, GitHub, Field configuration. The milestone still comes from G2M Date (est)", "Label pm:quarter/<quarter> (for example pm:quarter/q3-2027); switch it off in Settings, Integrations, Jira, Field configuration"),
  tags: sent("One label pm:tag/<tag> per tag, at most 10, only when the project switches it on (Field configuration; off by default)", "One label pm:tag/<tag> per tag, at most 10, only when the project switches it on (Field configuration; off by default)"), planned_start: { github: "Not sent yet (the board's Start date is planned)", jira: "Start date field, once you choose it (Field configuration)" },
  assignees: { github: "Both: issue Assignees", jira: "Not synced yet" },
  github_links: { github: "The tracking issue (repository and issue number)", jira: "The Jira issue (key)" },
  status: read("Issue state: open, closed as completed (Done), closed as not planned (Cancelled). The one status Product Velocity ever writes to GitHub is the close of the issue of an initiative you deleted (closed as not planned), after you confirm it in Sync with GitHub (Removed in Product Velocity). The one other thing is the board Status “Ready” for an initiative that is Ready for build, after you confirm the Sync (only while the board item is still in Backlog or has no status, only if the board already has a Ready option, once)", "Jira status category: to do = Not started, in progress = In progress, done = Done (the status name is on the Jira tab). The one status Product Velocity ever writes to Jira is the close of the issue of an initiative you deleted, after you confirm it in Sync with Jira (Removed in Product Velocity). The one other thing is the move to “To do” for an initiative that is Ready for build, after you confirm the Sync (only while the issue is still in a To Do status category such as Backlog, only when the workflow allows it, once)"),
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
  tracker_status: read("Project board Status, else the state of the issue (Open, Closed)", "The issue's status name, as Jira spells it. In a project set read only for Jira, an initiative with only listed epics shows how many of them are done (for example \"3 of 11 epics done\")"),
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
  gh_project_status: TRACKER, tracker_status: TRACKER,
  flags: "Worked out again on every change and every load", actions: "Worked out again on every change and every load",
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
  okr_objective: "The objective (OKR) the item serves, in your own words. Open list: type any value; the values already in use are offered. Independent of Business Line.",
  roadmap_category: "The roadmap category the item belongs to, for example New big bets or Operational efficiency. Open list: type any value; the values already in use are offered.",
  sponsor: "The business owner of the item: a name or an email address, as you like. Open list: type any value; the values already in use are offered. It is context for the roadmap, text, not a link to a workspace member. The workspace member who created the item is the Creator column.",
  business_line: "The business line the item belongs to, for example Programmatic, Direct or Platform. Open list: type any value; the values already in use are offered. Independent of Objective.",
  g2m_quarter: "Calendar quarter the work is planned for, chosen by a person. Any quarter from last year to three years ahead.",
};

/** Dictionary descriptions that are out of date or only repeat the values. */
const WHAT_OVERRIDES: Record<string, string> = {
  status: "State of the tracking issue's work, set by the tracker.",
  initiative_phase: "Where the initiative is in its lifecycle, set by people.",
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

/** One row for every column the app shows (the dictionary without the hidden fields, e.g. Roadmap Category), in dictionary order. */
export const COLUMN_ROWS: ColumnRow[] = VISIBLE_FIELDS.map((f) => {
  const link = OVERRIDES[f.key] ?? derive(f);
  return { key: f.key, group: f.group, column: f.name, what: describe(f), github: link.github, jira: link.jira, access: accessLabel([f.key]), updated: updatedBy(f, link) };
});

export const COLUMN_GROUPS: string[] = [...new Set(COLUMN_ROWS.map((r) => r.group))];
export const OVERRIDE_KEYS: string[] = Object.keys(OVERRIDES);
export const UPDATE_OVERRIDE_KEYS: string[] = Object.keys(UPDATE_OVERRIDES);

export const COLUMNS_NOTE = "Jira is planned: its mapping is chosen per customer. Nothing goes to GitHub or Jira until you confirm. When you delete an initiative whose Jira issue Product Velocity owns, Sync with Jira offers, under Removed in Product Velocity, to label the issue pm:removed and close it; you confirm each one, and an issue that came from Jira is never touched. An initiative an approver stopped at a decision gate is offered the same way (marked “Stopped at gate”). Sync with GitHub does the same for an issue Product Velocity owns: it adds the label pm:removed and closes the issue as not planned, you confirm each one, and an issue that is only followed from GitHub is never touched.";

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
    ["Discovery (Claude)", "Run pv-discovery with a short brief", "One initiative in Discover and a discovery document"],
    ["PRD (Claude)", "Run pv-prd with a brief, or on an existing initiative", "Fields filled, a PRD document, a Description extract to confirm"],
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
    ["Sunset", "After Completed: a shipped feature is being retired", "Notes", "None: a Creator chooses it from Roll-out or Completed"],
  ],
};

export const LIFECYCLE_NOTES = [
  "People move the phase. Claude and the tracker never do; the app may suggest Test when the build is done in GitHub or Jira. A suggestion is one click for you to accept.",
  "Initiative Status (Backlog, Active, On hold, Completed, Cancelled) is set by people only. Backlog is an initiative that has not started and is parked; On hold is one that was running and was paused. Setting it to Completed moves the phase to Completed; a closed ticket means the build is done, not the initiative.",
  "The phase cell in the grid is read-only. Use Request gate, Decide or Change phase (item panel, multi-select bar, command palette).",
  "Items sync to GitHub or Jira from Gate B. Before that, an optional Request engineering review sends the name, summary, description and hypothesis while the PRD is in review. Discover never syncs.",
  "Syncing stops 14 days after an initiative is Completed or Cancelled; an approver or admin can resume it.",
];

// Needs attention (issue #337, docs/28-DECISION-GATES.md)
export const ATTENTION_INTRO = "The Needs attention tab lists the initiatives you can see that need a person to look, with the reason in words and the next step. Everything on it is a suggestion: nothing changes until you press a button. It is about initiatives, never about people. It is a list: search it (press /), filter by reason, urgency, phase, health or group, sort and choose columns, select several rows to move them to Test, request a gate or snooze them, and download what you see. Snoozing hides a reason for everyone until a date, or until someone brings it back; it never changes the initiative.";
export const ATTENTION_TABLE: Table = {
  head: ["Reason", "When it shows", "Next step"],
  rows: [
    ["Delivery risk", "Health is Blocked, At Risk or Delayed, the G2M date has passed, or issues are blocked", "Open the initiative"],
    ["Build done", "The tracker says the build is done, or every linked issue or epic is closed, while the phase is still Build", "Move to Test"],
    ["Work before the gate", "Tracker work started while the phase is Discover or Define", "Request the gate"],
    ["Cancelled but building", "Initiative Status is Cancelled while the build is in progress", "Open the initiative; stop the work in the tracker"],
    ["Hold due", "The review date of a Hold has come", "Request the gate again"],
    ["Waiting for a decision", "A gate request has waited more than 7 days", "Open Decisions"],
    ["Open conditions", "A Go with conditions left tasks that are not done", "Open the initiative"],
    ["Stalled in a phase", "Active, and in a phase longer than 30 days (Discover, Define, Test), 45 (Experiment), 60 (Roll-out) or 90 (Build)", "Open the initiative"],
    ["Completed with open work", "Initiative Status or phase is Completed, but the tracker still shows the build in progress or issues that are not closed", "Open the initiative; close the work or set the status back"],
    ["Phase ahead of the build", "The phase is Test, Experiment or Roll-out and the tracker says the build has not started", "Open the initiative"],
    ["Stale issues", "Active, the build is in progress and linked issues have had no activity for a while", "Open the initiative"],
    ["No health set", "Active, the phase is Build or later and Health is empty", "Open the initiative; set Health"],
  ],
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Decision gates (issue #323, docs/28-DECISION-GATES.md)

export const GATES_INTRO = "A decision gate is the one moment where a person with approval rights says whether an initiative may move on. There are three: A, B and C. Claude can prepare the gate pack (evidence and a checklist) but never decides.";

export const GATES_TABLE: Table = {
  head: ["Gate", "Between", "The question", "What passing does"],
  rows: [
    ["A", "Discover and Define", "Is this worth defining? Is the discovery solid?", "Approves the discovery document and moves the phase to Define"],
    ["B", "Define and Build", "Do we commit to build it?", "Approves the PRD (the only place a PRD is approved), moves the phase to Build and marks it Ready for build until the tracker starts; offers the GitHub or Jira handover, and the next Sync shows “Set Status to Ready” (GitHub board) or “Move to To do” (Jira) so engineers can see what is ready. Hold or Stop writes nothing"],
    ["C", "Experiment and Roll-out", "Did the experiment pass, and may it roll out?", "Moves the phase to Roll-out"],
  ],
};

export const GATES_STEPS: Table = {
  head: ["Step", "Who", "What happens"],
  rows: [
    ["1. Request", "Creator or above", "Request gate A, B or C on one item or on a selection. Gate Status becomes In review. A checklist shows what is missing; it informs, it does not block."],
    ["2. Decide", "Anyone with approval rights for that gate", "Go, Go with conditions, Hold or Stop, with an optional comment that cannot be edited later. On a phone the choices are Go, Hold and Stop, and Add conditions sits under Go. The first decision wins; the others see it closed. You may approve your own request."],
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
  "Multi-select bar: Request gate, Decide (one comment for all selected, with a confirmation listing each item) and Change phase.",
  "Change counts: the Notifications bell also counts the changes (Phase, Status, Health, Build status, linked issue) made on each project in every account you can open since you last cleared it, as a number on the bell. Open the bell for each project with a count per type; Clear counts resets them to 0; a click on a project opens its change log (the Changes report) and clears that project. Your own changes are not counted.",
  "Notifications: when a gate is requested, the people who can decide it (or only the people the requester asked) see it under Notifications in the top bar; the requester sees the decision there. No email is sent. Mark a notice read by opening it, or Mark all as read.",
  "The outcome review at +30, +60 and +90 days is not a gate; it is a scheduled review after Roll-out.",
];

// ---------------------------------------------------------------------------------------------------------------------------------------
// Status changes (issue #358, docs/decisions/2026-11-06-ready-at-gate-b.md): which status changes, what triggers it, when, where, and the exact state names.

export const STATUS_INTRO = "Three different things are called status. Initiative Phase (Discover to Completed) and Initiative Status (Backlog, Active, On hold, Completed, Cancelled) belong to Product Velocity and are changed by people. Build Status (Not started, In progress, Done, Cancelled) belongs to the tracker and is read-only here. Product Velocity writes to a tracker in only three cases, always after you confirm in Sync, and never for an issue that is only followed.";

export const STATUS_TO_TRACKER: Table = {
  head: ["What happens in Product Velocity", "Trigger and when", "GitHub: from → to", "Jira: from → to", "Never happens when"],
  rows: [
    ["Ready for build (Gate B: Go or Go with conditions)", "A person confirms Sync with GitHub or Sync with Jira after the gate. Once per initiative", "Project board Status: empty or Backlog → Ready (the board must already have a Ready option). The issue itself stays open", "Issue status: a status in the category To Do, such as Backlog → To do (the workflow must allow the move)", "The tracker item is already further along (In progress, In review, Done, Ready, To do). The initiative is on Hold or Stop. The issue is only followed, or the board has no Ready option, or the workflow has no such transition: the preview says so and nothing is written"],
    ["Initiative deleted (Trash)", "A person confirms, one initiative at a time, in Sync under Removed in Product Velocity", "Issue: open → closed as not planned, and the label pm:removed. Already closed: only the label", "Issue: current status → a Done status you choose (category Done), and the label pm:removed. No Done transition: only the label", "The issue came from the tracker (followed, or adopted by default) or is in a read-only repository"],
    ["Stopped at a gate (Stop)", "Initiative Status becomes Cancelled; the same confirmed offer as a deleted initiative, marked Stopped at gate", "Same as deleted: open → closed as not planned, label pm:removed", "Same as deleted: → a Done status, label pm:removed", "A later Go or setting the status back to Active withdraws the offer"],
    ["Title, summary, description, hypothesis, labels, dates, links", "A person confirms Sync (the Define phase adds the label pm:define)", "Issue text and labels; board fields Priority, Initiative, Due date, Size", "Issue summary, description, labels", "Value, confidence, customers, decisions and other commercial fields are never sent. No status is written by this row"],
  ],
};

export const STATUS_FROM_TRACKER: Table = {
  head: ["Tracker state", "Becomes in Product Velocity", "When it updates", "Notes"],
  rows: [
    ["GitHub issue open", "Build Status: Not started (only when it had no status)", "Webhook, daily check, Check GitHub now, after a send", "An open issue never overwrites a status; GitHub issues have no in-progress state, so In progress comes from Jira or the board Status below"],
    ["GitHub issue closed as completed", "Build Status: Done. Build Completed date is set", "Same", "The build is done, not the initiative: Initiative Status never changes"],
    ["GitHub issue closed as not planned", "Build Status: Cancelled", "Same", "No Build Completed date"],
    ["GitHub issue reopened (from Done or Cancelled)", "Build Status: Not started", "Same", ""],
    ["GitHub Project board Status (for example Backlog, Ready, In progress, In review, Done)", "Delivery Status: the board's own words, unchanged", "Real time (Project item events), daily check, after a send", "Read-only. Not mapped to Build Status or Initiative Status. Also read: Iteration and the board's date field"],
    ["Jira status category To Do (for example Backlog, To do)", "Build Status: Not started", "Webhook (when on), daily check, Sync with Jira", "Jira's status name is shown on the Jira tab. Names mean nothing, the category does"],
    ["Jira status category In Progress (for example In progress, In review)", "Build Status: In progress", "Same", ""],
    ["Jira status category Done (for example Done, Won't do)", "Build Status: Done", "Same", "The build is done, not the initiative"],
    ["Sub-issues (GitHub) or child issues (Jira) closed", "Issues Closed, Issues Total and Delivery Progress %", "Same", "Counted at the leaves; work closed as not planned leaves the total"],
  ],
};

export const STATUS_NEXT_IN_PV: Table = {
  head: ["Trigger", "Product Velocity then", "Who decides"],
  rows: [
    ["Build Status Done while the phase is Build", "Needs attention suggests Move to Test (one click)", "A Creator or above"],
    ["Gate decision Go or Go with conditions (A, B, C)", "Initiative Phase moves; at Gate B also Ready for build, which Sync then shows in the tracker as above", "A person with approval rights for that gate"],
    ["Gate decision Hold", "Phase stays, Gate Status Held. Nothing is written to a tracker", "A person with approval rights"],
    ["Gate decision Stop", "Initiative Status becomes Cancelled and the close offer appears in Sync", "A person with approval rights"],
    ["Initiative Status set to Completed", "Initiative Phase becomes Completed. Sync stops 14 days later (also for Cancelled)", "A person"],
  ],
};

export const STATUS_NOTES = [
  "Claude never decides or moves a gate or a phase, never sets Initiative Status and never writes to a tracker: it can prepare a gate pack. Sending to GitHub or Jira always needs your confirmation.",
  "Reading never fights writing. Product Velocity sets Ready or To do once, only while the item is still at its start; after that the board or Jira status is read back and never overwritten. If someone moves the item back to Backlog, Product Velocity leaves it.",
  "The GitHub App needs the Projects permission with Read and write to set Ready (Settings, Integrations, GitHub shows whether it has it). Jira needs a sign-in that may transition issues.",
];

// ---------------------------------------------------------------------------------------------------------------------------------------
// Reports (issue #233 Overview, request R-129 / issue #287 Roadmap Health): what each report answers and how its numbers are defined.

export const REPORTS_INTRO = "The Reports tab has a list of reports next to its title; Overview opens first. The filters (including Objective, Key Result, Business Line and Initiative Status), the click-to-filter pills and the two toggles (archived, AI drafts) are shared, so they stay when you switch reports, and the address keeps the report and the filters so you can share a link.";

export const REPORTS_LIST: Table = {
  head: ["Report", "What it answers", "What is on it"],
  rows: [
    ["Overview", "What is the shape of the roadmap, and how long does work take to reach the market?", "Donuts by Status, Phase, Focus Area, Team and MoSCoW; stacked bars by Product Manager, Team, Group, Status and Health; Impact and Effort; Time to Market; Build time in weeks (from Start Building to the tracker's Build Completed, against the estimate, by Team and Effort); the timeline; the matching initiatives; CSV export"],
    ["Roadmap Health", "Where does active work pile up, how long has it been in its phase, and what is Blocked, At Risk or Delayed?", "Counts of active, Blocked, At Risk and Delayed initiatives; active initiatives by Team and Phase and by Team and Health; median days in the current phase for each phase; the 10 initiatives that have waited longest; completed delivery duration; every active initiative with days in phase and age"],
    ["Gate history", "How do decision gates go: how many requests, what was decided, and how long do decisions and the start of building take?", "Tiles for what is waiting and what needs attention; every open request, longest wait first; outcomes and initiatives passing each gate as charts; days to decide per gate with the usual range and the outliers, each marked Faster than usual, Within usual time, Longer than usual or Needs attention against your own past decisions (no target is set); the wait between a Gate B Go and Start Building. A table of every figure per gate. For the whole team: nothing is shown per approver"],
    ["Changes", "Which initiatives changed today, this week or this month, and what changed?", "Grouped by initiative: Phase, Status, Health, Build status and the status of linked GitHub and Jira issues, each with the time it was registered, where it came from and who made it. Shown on a grid with the same action bar as the Roadmap (Filter, Columns, Group by, Search): group by initiative, change type, source, source type or day, with colour for the type of change and for the value it ended on. Source says where the value came from (Product Velocity, Jira or GitHub), Source type how it arrived (UI, API, Claude MCP, GitHub webhook, import, system); for a tracker value the person on the row only ran the Sync. A Jira or GitHub move is one row: the status of the linked issue with the Build Status that went with it, and for Jira a Jira user column says who moved the issue. A Build Status change that follows child tickets instead names who moved those children (up to two names and a count), read by the daily check. Says whether the initiative itself moved or only its linked issues, shows the Jira or GitHub issue behind a change as a link, and marks initiatives with a flag to follow up (the Needs attention reasons, plus two for initiatives with no phase) with a button for the next step: Move to Test where that is allowed, Request gate where the move passes a decision gate. The bar also has Refresh and Collapse all. Filter by change type or flagged only; follows the Reports filters"],
    ["Velocity", "How long does work take from Start Discovery to roll-out, to each gate and in Build, how widely does it vary, where does the time go, and how long do gates take to decide?", "Time measured (Total, To Gate A, To Gate B, To Gate C, or one phase: Discover, Define, Build, Test, Experiment), always the sum of the phases that have dates, counted from the start or the previous gate, in weeks or days; the median, average and percentiles with a bell-shaped distribution; by T-shirt size and by Team, Key Result, Objective, Business line, Initiative Group or Focus Area; the average, median and percentiles of each phase; the trend per quarter; working or waiting; the stages of the journey; time to decide per gate and what the gates decided; Build, Test and Experiment on their own; in-flight initiatives already slower than usual; every initiative with search, filters and sort. Team level only"],
    ["OKRs", "How are the initiatives spread over Objectives and Business Lines, how does the focus move from quarter to quarter, and how far along is each Objective in the current quarter?", "The Objectives grouped by Business Line with their Focus Area, Owner, Business Value Type and number of initiatives; initiatives per Objective for each Planned Quarter as bars; and the Objectives of the quarter we are in split by Initiative Phase. Click an Objective, Business Line, quarter or phase to filter. Initiatives without an Objective, Business Line or quarter are shown as Not set or Unscheduled, never left out"],
  ],
};

export const ROADMAP_HEALTH_DEFINITIONS: Table = {
  head: ["Term", "How it is counted"],
  rows: [
    ["Active", "Initiative Status is Active. Backlog, On hold, Completed and Cancelled are not counted (completed ones feed only the completed delivery duration)."],
    ["Blocked, At Risk, Delayed", "The Health column of active initiatives, counted separately. Click one to filter every chart and the list to it; click again to remove it."],
    ["Days in current phase", "Today minus the start date of the phase the initiative is in (Start Discovery, Start Definition, Start Building, Start Test, Start Experiment, Start Roll-Out), else the day Phase Changed At."],
    ["Age", "Today minus Start Date, else Planned Start."],
    ["No date", "An initiative whose date is empty, invalid or in the future is not left out silently: the summary counts them and the list says No date."],
    ["Completed delivery duration", "The Time to Market card, for completed initiatives only: G2M Date (actual) minus the earlier of Start Discovery and Start Date, with the median, the distribution, the number counted and the number excluded."],
    ["Several teams", "An initiative with several teams counts once per team, so team bars can add up to more than the number of initiatives. The chart says so."],
  ],
};

export const VELOCITY_DEFINITIONS: Table = {
  head: ["Term", "How it is counted"],
  rows: [
    ["Time measured", "The time of an initiative is the sum of the phases that have dates, so a missing date never removes an initiative. Total adds every phase with a start and an end date, from Discovery to Start Roll-Out (the 30, 60 and 90 days after roll-out up to Completed are not counted). To Gate A, B and C add the phases up to that gate's decision. Discover, Define, Build, Test and Experiment show one phase on its own. A phase runs from its own start to the next date the initiative has (a gate request, a decision or the next phase start); Build is the tracker's Actual Build when there is one (the same number, in weeks). A waiting phase needs both of its dates; a zero-day wait is not counted."],
    ["Counted from", "The phases of the measure, or for Gate B (Define and waiting for Gate B) and Gate C (from the Gate B decision to the Gate C decision) only the phases after the previous gate."],
    ["Counted and not there yet", "An initiative counts as soon as one phase of the measure has a start and an end date that has passed; its time is what its dated phases add up to. One that has started a phase but finished none is counted apart as not there yet, never as zero; one with no dates for the measure is left out and the report says how many. When too few can be measured, the report says how many initiatives have dates."],
    ["Time in each phase", "One chart with the average, median and the 10th and 90th percentile of each phase of the measure, over the initiatives that have dates for that phase (it says how many). Use the Time measured buttons and the filters to zoom into specific phases or between gates."],
    ["Median, average and percentiles", "The median is the middle initiative: half were faster. The average is the mean. The fastest tenth took less than the 10th percentile, the slowest tenth more than the 90th, and the middle half lies between the 25th and 75th. 80% finished within the 80th."],
    ["Bell", "Bars count the initiatives that took about that long; the curve smooths them. Colours mark the fastest tenth, the middle half and the slowest tenth, and are always named in words under the chart."],
    ["Box and line", "On the range charts the box is the middle half, the thin line runs from the 10th to the 90th percentile, the tick is the median and the diamond the average. A row with fewer than 5 initiatives shows its single dots instead."],
    ["Size-adjusted", "A group's median against what its own mix of T-shirt sizes predicts: for each initiative the median of its size (or all sizes when that size has fewer than 3), then the median of those. +20% means 20% longer than expected for the work it does."],
    ["Stages", "The journey in ten steps: Discover, waiting for Gate A, Define, waiting for Gate B, waiting to start build, Build, Test, Experiment, waiting for Gate C and waiting to start roll-out. A wait is from the gate request to the decision, or between a decision and the start of the next phase. A phase without dates is not part of that initiative's time, so the steps always add up to the initiative's total."],
    ["Working or waiting", "The share of elapsed time spent in a phase, waiting for a gate decision or waiting in a queue."],
    ["Time to decide", "Days from a gate request to its decision, for decided requests, for the whole team. A request that is still open is listed with the days it has waited. Nothing is shown per approver."],
    ["In flight and already slower than usual", "For the measure chosen: started it, not at its end yet, neither Cancelled nor Completed, and elapsed time since its start above the 80th percentile of the finished initiatives of the same size for that measure (all sizes together when that size has fewer than 5). It needs at least 5 finished initiatives to compare with."],
    ["Several teams", "An initiative with several teams counts once per team, so team groups can add up to more than the number of initiatives. An initiative has one Key Result (the Primary KR), one Objective and one Business Line."],
  ],
};

export const VELOCITY_NOTES = [
  "Velocity only reads: nothing is edited from it. It is for the team: no figure is about a person or an approver.",
  "Each chart has Show as table with the same numbers, and every comparison carries words and an arrow, never colour alone.",
  "Product Velocity writes no commentary on the numbers. To get one, ask your own Claude through the connected assistant to read the report.",
];

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
  "An AI agent is an assistant you already use (Claude, ChatGPT or Gemini) connected to Product Velocity. It works as you, with your role, reads what you can read, and writes drafts you review. It never approves anything and never sets Stack Rank, Decision, Value or Confidence. It can read the 30, 60 and 90 day outcome reviews and record numbers you give it, with your words kept.";

export const AGENT_USE_CASES: Table = {
  head: ["Use-case", "What the agent does in the flow", "Say, for example", "Where it lands"],
  rows: [
    ["Brainstorm", "Thinks with you before anything exists. It reads the workspace (projects, groups, teams, fields, related initiatives and their documents) and the company profile, so ideas fit what you already plan. Nothing is written until you say so.", "\"Search initiatives related to loyalty and retention. Which overlap with this idea, and what could we test first?\"", "Only the chat. Save nothing"],
    ["Create", "Turns a brief into a discovery or a PRD, asks once for what is missing (including who is on the team), shows a dry run, then creates the initiative and the document as AI drafts.", "\"Use pv-discovery. Brief: customers leave after the first month. Team: product manager = Ana, designer = Li.\"", "Initiative fields plus a document on the Spec tab. Full documents never go to GitHub"],
    ["Review", "Reads a document or initiative and reports: unclear acceptance criteria, missing risks, claims without evidence, a light roll-out plan, partner claims the partner does not support. It changes nothing.", "\"Review the PRD of R-12. Do not change anything yet.\"", "Only the chat, with the codes it looked at"],
    ["Prepare a gate", "Reads one initiative and gathers the case for a decision gate: the checklist (what is filled in, what is missing), its documents and their status, past requests and decisions, open conditions. It writes a short summary for the person who decides. It cannot request, decide or approve a gate, or move a phase.", "\"Use get_gate_pack for R-12 and summarise the case for gate B.\"", "In the chat only; a person decides in Decisions"],
    ["Link Jira epics", "Records the Jira epic keys that belong under an initiative (any Jira project). It writes nothing to Jira: the next Sync with Jira links the epics that have no parent without asking again, and shows any epic that would move from another parent for you to confirm. In a project an admin set to read only for Jira, nothing is ever written: the epics are only read, with their children, and their status and delivery progress roll up on the initiative.", "\"Put the epics R8P-1234 and DATA-56 under R-12.\"", "The initiative's Jira tab, then Sync with Jira"],
    ["Record outcome metrics", "Reads the 30, 60 and 90 day outcome reviews of an initiative, and records a checkpoint only with numbers you stated: the realised value of the key result, the adoption % and a note, with your own words kept next to them. It never asks anyone for metrics (you do that in the app, and the Product Manager is notified), never estimates or invents a number, and cannot change a checkpoint that is already recorded. It can also draft the message that asks for the metrics (text only: nothing is sent, and you press Request metrics in the app).", "\"Record the 30 day metrics for R-12: 42 activations and 18% adoption.\" or \"Draft the request for the 30 day metrics of R-12.\"", "The Outcome reviews section of the initiative panel, with the audit entry"],
    ["Read a Confluence page", "Reads the text of a page that is already a link on an initiative (or the page a document is kept from) as Markdown, so it can answer from the latest version, quote it or draft from it. It reads only pages someone linked, never browses Confluence, and writes nothing. It says what could not be carried over (images, some macros).", "\"Read the Confluence page linked on R-12 and summarise what changed in the plan.\"", "Only the chat"],
    ["Ask to publish to Confluence", "Asks for a document to be published to a page, with the space and parent page when it knows them. It only leaves a request: nothing is sent. You open the document, review the preview (with the warning for commercial text) and confirm.", "\"Publish the go-to-market one-pager of R-12 to the GTM space, kept in sync.\"", "A request on the document (“Publish requested by Claude”); the page only after you confirm"],
    ["Ask to import or refresh from Confluence", "Asks for a linked page to be copied into a new document, or for a document to be updated from its page. It only leaves a request: nothing is read into a document and nothing is changed. You review the preview (the converted text and what could not be carried over) and confirm; the old text stays as a previous version.", "\"Import the Confluence page linked on R-12 as the business case, and keep it up to date from the page.\"", "A notice on the Spec tab, or “Update requested by Claude” on the document; the document only after you confirm"],
    ["Skills (pv-)", "Runs a guided skill on an initiative: a pre-mortem that turns imagined failure into ranked risks, or a one-pager that asks for one decision. It reads the company profile and what the workspace stores, asks once (every question can be skipped) and saves a document as an AI draft. pv-help lists them. Company-level skills (vision, strategy, north star, competitive analysis, personas) need no initiative and can save their result into the company profile once you agree", "pv-premortem R-12, or pv-one-pager R-12 for Friday's leadership meeting, or pv-strategy. Add --draft to see it first", "The initiative's Spec tab, or Documents in the account menu for the whole workspace; nothing reaches the issue"],
    ["Update", "Revises a document (a new version, the old one kept) or fills empty fields. Changes to fields a person already filled come back as a diff you confirm first. A second assistant can review what the first wrote.", "\"Update the PRD of R-12 with what we decided today. Show me the diff.\"", "A new document version, with the AI tool and model that wrote it. Undo with undo_last"],
  ],
};

export const AGENT_ADVANTAGES: { title: string; text: string }[] = [
  { title: "Company profile (memory of the company)", text: "Industry, products, personas, competitors, partners, glossary, voice, vision, strategy, north star and planning conventions, drafted by the agent from your website (pv-company) and confirmed by a workspace admin. Every later PRD or discovery uses it, so documents sound like your company and reuse your terms. Set the Company website in Workspace settings, run pv-company once, and an admin confirms it under Company profile." },
  { title: "Project and workspace context", text: "On connect the agent reads your projects, Initiative Groups, teams, members, the field list with allowed values, and the open lists in use. It uses your spelling, existing groups and real field values instead of inventing them." },
  { title: "Prior knowledge", text: "Before it drafts, the agent searches related initiatives, reads at most five of their PRDs and discoveries, and tells you which it used. Terms, key results and risks stay consistent across the roadmap." },
  { title: "Research that is checked", text: "Partners and unfamiliar terms in a brief are looked up in the profile first and researched from public sources only when missing. Your claims about a partner are compared with what the partner publishes, and mismatches come back as questions. It never invents a competitor claim." },
  { title: "The team, not the account", text: "Documents start with a Team table (product manager, designer, engineering manager and others). Tell the agent who is on the team; it does not put the signed-in account's name as owner. It can name members and people you added to the list before they were invited (Members shows them as \"Not invited\"); it cannot add or invite anyone." },
  { title: "Comparable by AI tool and model", text: "Every document version records which AI tool wrote it (from the connection) and which model the agent says it is. A PRD written with Claude and reviewed by ChatGPT shows both. The same two columns are on every entry of the audit log, not only on documents. Account admins see every submission under Settings, Audit log, Document submissions; platform admins see all accounts." },
  { title: "Safe by design", text: "One server, the same rules for every agent: your role limits it, text in documents is data and never instructions, everything it writes is an AI draft and audited with who, when, the source MCP, which AI tool (Claude, ChatGPT or Gemini, taken from the connection) and which model the agent says it is, a document an agent writes is held back from the GitHub issue and Jira description until you accept it, and is then shared at the next Sync unless you choose “Do not share” on it, and sending anything outside needs your confirmation. It cannot close a Jira issue, close a GitHub issue or confirm a sync: only a person can, in Sync with Jira or Sync with GitHub." },
];

const guide = (a: "claude" | "chatgpt" | "gemini") => setupGuides("the connector URL shown under Connect an AI assistant").find((g) => g.assistant === a)!;

export type AgentGuide = { title: string; setup: string[]; snippet?: string; onboarding: string[]; features: Table; notes: string[] };
const ONBOARD_ADMIN = "Admin, once: account menu, You, Connect an AI assistant, switch on AI assistants for the workspace (they are off by default). Then set the Company website under Workspace admin, Workspace settings.";
const ONBOARD_CONNECT = "Each person: connect the assistant (above), sign in to Product Velocity, choose one or several workspaces and approve on the consent screen. With several workspaces the agent asks which one you mean.";
const ONBOARD_PROFILE = "First task: ask for the company profile (pv-company). It shows what it found section by section and saves a draft; an admin confirms it under Company profile.";
const REVOKE = "You can revoke a connection at any time under Connect an AI assistant; it stops on the next call. Signing out of Product Velocity on one device keeps Claude connected; \"Sign out other devices\" and \"Sign out everywhere\" on the Account page disconnect it, and you reconnect it in Claude. Admins see every connection (names and counts, no content).";

export const AGENT_GUIDES: Record<"claude" | "chatgpt" | "gemini", AgentGuide> = {
  claude: {
    title: "Claude (claude.ai, the desktop app, Claude Code)",
    setup: guide("claude").steps,
    snippet: guide("claude").snippet?.code,
    onboarding: [ONBOARD_ADMIN, ONBOARD_CONNECT, ONBOARD_PROFILE, "After a Product Velocity update, reconnect it in Claude to pick up new tools and prompts.", REVOKE],
    features: {
      head: ["What", "How to start in Claude", "Result"],
      rows: [
        ["Discovery", "Prompt pv-discovery (brief, item, team). In claude.ai type / and pick it; in Claude Code type /mcp__product-velocity__pv-discovery", "A Discovery document and one initiative in Discover"],
        ["PRD", "Prompt pv-prd (brief, modules such as A1 D1 D4, item, team). It shows its plan first and can run success metrics and a split as steps", "A PRD document and the initiative fields it can support"],
        ["Company profile", "Prompt pv-company (url, focus)", "A draft profile for an admin to confirm"],
        ["Skills (pv-)", `Pick a pv- prompt in the menu (${SKILL_LIST}; pv-help lists them) with an initiative code where the skill needs one, your own words and optionally draft = true (the report skills take format = email, slides, document, slack or chat)`, "A document (on the initiative, or in Documents for company-level skills) saved as an AI draft, or for pv-weekly and pv-release-notes a report in the format you choose; nothing is saved when you ask for a draft only"],
        ["Several initiatives", "Ask in plain words: create initiatives from this list in group Growth, project Marketplace", "A dry run first, then created after you agree"],
        ["Change what exists", "Name the initiative, e.g. R-12, and say what to change", "A diff to confirm when a person already filled the field; undo with \"undo your last change\""],
        ["Documents, files and links", "Write documents, attach screenshots or PDFs and add links on the Spec tab (drag and drop, paste an image or a web address); each is shared with the issue unless you choose Do not share", "Spec tab of the initiative; documents and file links are not written to the issue of a public repository"],
      ],
    },
    notes: ["Claude first asks whether to save the draft or show it in the chat to align; say which in your prompt to skip the question.", "Claude Code can also work in your repository while it reads Product Velocity; it has the same role limits.", "Claude asks you to confirm every tool that changes or removes something that already exists (changing an initiative, revising a document, relations, file sharing, the company profile, undo). Adding something new, such as creating initiatives or a document, does not ask again."],
  },
  chatgpt: {
    title: "ChatGPT",
    setup: guide("chatgpt").steps,
    onboarding: [ONBOARD_ADMIN, "ChatGPT Business, Enterprise and Edu: a ChatGPT workspace admin must allow custom connectors (Developer mode) before anyone can add one.", ONBOARD_CONNECT, ONBOARD_PROFILE, REVOKE],
    features: {
      head: ["What", "How to start in ChatGPT", "Result"],
      rows: [
        ["Discovery, PRD, company profile", "ChatGPT cannot start prompts. Say \"use the pv-discovery playbook\" (or pv-prd, pv-company; the older names write_discovery, write_prd and research_company still work) and give the brief and the team. It reads the same instructions through the get_playbook tool", "The same documents and AI drafts as with Claude"],
        ["Skills (pv-)", `Type the command, e.g. pv-premortem R-12 focus on payments --draft (skills: ${SKILL_LIST}, pv-help; the report skills take --format=email, slides, document, slack or chat). The assistant reads it through the get_playbook tool`, "A document (on the initiative, or in Documents for company-level skills) saved as an AI draft, or for pv-weekly and pv-release-notes a report in the format you choose"],
        ["Deep research and company knowledge", "Ask in a research chat. ChatGPT uses two read-only tools, search and fetch, to read your initiatives and documents", "Findings that cite initiative codes; nothing is written"],
        ["Several initiatives, changes, files", "Ask in plain words, as with Claude", "A dry run or diff first, then written after you agree"],
        ["Confirmations", "ChatGPT asks you to confirm each tool call that changes something", "Product Velocity still shows its own dry run or diff first"],
      ],
    },
    notes: ["Use Developer mode in a normal chat for writing. Deep research mode only reads.", "The ChatGPT connector is new: if a step looks different in your plan or region, look for \"custom connector\" or \"MCP server\" and tell your admin which step failed."],
  },
  gemini: {
    title: guide("gemini").title,
    setup: guide("gemini").steps,
    snippet: guide("gemini").snippet?.code,
    onboarding: [
      ONBOARD_ADMIN,
      "Direct connect: Add the remote connector URL directly under Gemini Settings → Connectors / MCP Servers, then sign in and approve your workspace on the consent screen.",
      "Native skills: Use /pv-prd and /pv-discovery for interactive single-batch interview workflows.",
      ONBOARD_PROFILE,
      "Optional: install the Gemini extension in the repository's connectors/gemini folder; it adds a context file with the house rules and the flow names. Replace the placeholder address with your deployment's before installing.",
      REVOKE,
    ],
    features: {
      head: ["Skill / Capability", "How to ask Gemini", "Result"],
      rows: [
        ["Sign in", "Connect via Settings URL, or run /mcp auth product-velocity in CLI (opens browser to sign in and approve)", "A connection you can revoke"],
        ["Check connection", "/mcp lists the server, its tools and its prompts", "Product Velocity listed as connected"],
        ["PRD authoring (pv-prd)", "Ask \"Write a PRD for [feature]\" or /pv-prd", "Drafts 4D PRD, asks for team/KRs in one grouped batch, diff preview, and saves AI draft to Spec tab with safe tracker extract"],
        ["Opportunity discovery (pv-discovery)", "Ask \"Run discovery on [topic]\" or /pv-discovery", "Evaluates candidate solutions, checks evidence depth, and prepares Gate A decision dossier"],
        ["Company & partner research (pv-company)", "Ask \"Research the company\" or /pv-company", "Drafts company profile, competitor context, and glossary for workspace admin confirmation"],
        ["Roadmap & portfolio queries", "Ask in natural language (e.g. \"Which Q3 initiatives are stalled?\")", "Real-time roadmap intelligence, dependencies, and dry-run proposal diffs"],
      ],
    },
    notes: [
      "Direct connection: Use the remote connector URL directly in Antigravity, Gemini Code Assist, or any MCP-compatible Gemini client.",
      "Human in the loop: Gemini never approves decision gates, never marks items Ready for build, and never sets Stack Rank or Value.",
      "Commercial privacy: Full PRD documents and commercial metrics stay strictly in Product Velocity and never sync to GitHub or Jira.",
      "Tool definitions are simplified for Gemini function calling; Product Velocity validates every parameter strictly on the server.",
    ],
  },
};

export const AGENT_TIPS = "Name the initiative code, the group and the project. Paste the source text, do not summarise it. Name the team (product manager = ..., designer = ...); someone who is not a member yet works too once they are on the people list. Say \"show me first\" when you want to align before anything is saved.";

/* ---------------------------------------------------------------------------------------------------------------------------------
 * People, roles and access (issue #696). The three kinds of people, the roles, what an alignment vote shows each of them, how a person
 * moves between states, and the common cases. Keep in step with docs/15 (accounts), docs/19 (alignment privacy) and docs/28 (gates).
 * ------------------------------------------------------------------------------------------------------------------------------- */

export const PEOPLE_KINDS: Table = {
  head: ["", "Participant", "Person not invited yet", "Member"],
  rows: [
    ["What it is", "Someone you ask to vote in an alignment session. They open a one-time link and never join the workspace.", "A first name (and a last name), and an email if you have one, typed into Product Manager, Engineering Manager, Designer, Analyst or Business Manager before the person has an account.", "A person with an account in your workspace and a role."],
    ["Has an account", "No", "No", "Yes"],
    ["Can open the workspace", "No. Only their own ballot, through their link.", "No", "Yes, as far as their role allows"],
    ["Knows about it", "Yes. They were emailed and see how their answers are used before they vote.", "No. Nothing is sent to them until an admin invites them.", "Yes"],
    ["Can be named on an initiative", "No", "Yes", "Yes"],
    ["Can decide a gate", "No", "No", "Only with approval rights"],
    ["Shown in", "The participant list of the session (admins only)", "Pickers, filters, reports and exports by name; Members, under Not invited yet (admins)", "Members, with role and status"],
    ["Added by", "An admin, from a pasted list in an alignment session", "A Creator or an admin, from a person field or from Members", "An admin, by invitation; or people who join through your company domain"],
    ["Becomes a member", "Never. Voting stays separate on purpose, so answers stay anonymous", "When an admin invites them and they accept, or they join with the same email", "Already is"],
  ],
};

export const ROLE_TABLE: Table = {
  head: ["Role", "Can do", "Cannot do", "Typical person"],
  rows: [
    ["Viewer", "Read initiatives, views, reports and the roadmap. Connect an AI assistant to read.", "Create, edit, delete, invite or decide.", "A stakeholder who needs to see the plan."],
    ["Commenter", "Everything a Viewer can. Today it behaves exactly like a Viewer; the role is kept for comments.", "Create, edit, delete, invite or decide.", "A reviewer."],
    ["Creator", "Create and edit initiatives, request a gate, add people to the people list, delete the initiatives they created, work with an AI assistant that changes things. Sees who voted after a vote closes, if participants agreed.", "Manage members, settings or connections. Decide a gate without approval rights.", "A product manager."],
    ["Admin", "Everything a Creator can, plus members and invitations, settings, GitHub and Jira connections, delete any initiative, see the participant list of a vote, and decide every gate by default.", "Let Claude or a service account decide a gate: nobody can.", "The owner of the workspace."],
    ["Leadership viewer", "Read the whole portfolio. Opens on the Leadership page.", "Create, edit, delete, invite or decide.", "An executive."],
    ["Approver (a separate permission)", "Decide gates: Go, Go with conditions, Hold or Stop. Admins have it by default; an admin can give any member approval for a single gate (A, B or C) in Settings, Workspace.", "Be held by Claude or by a service account, ever.", "Whoever is accountable for a gate."],
  ],
};

export const PEOPLE_STATES: Table = {
  head: ["Status", "What it means", "Access", "Moves to"],
  rows: [
    ["Not invited", "Named on initiatives; no account.", "None", "Invited, when an admin invites them."],
    ["Invited", "A pending invitation. It works once, for that email, for 7 days.", "None until accepted", "Active when they accept; cancelled if you revoke it."],
    ["Requested Access", "Asked to join (for example from your company domain, when automatic joining is off).", "None", "Active or Revoked, by an admin."],
    ["Active", "A member.", "By role", "Paused or Revoked."],
    ["Paused", "Access switched off for now. The name stays on initiatives and in reports.", "None", "Active or Revoked."],
    ["Revoked", "Access ended.", "None", "Active, if you change your mind."],
  ],
};

export const VOTE_VISIBILITY: Table = {
  head: ["Who", "Sees in an alignment vote", "Never sees"],
  rows: [
    ["Participant", "Their own ballot. After the vote closes, anonymous results, only if the admin allowed it.", "Other people's ballots, names or emails; groups of fewer than 5 voters."],
    ["Member (Viewer to Leadership)", "That a session exists, its state and, if allowed, the anonymous results.", "Participants, emails and ballots."],
    ["Creator", "Closed sessions. Who voted what, only through Show names after the vote closes, with a reason that is logged, and only if every participant agreed to wording that names product managers.", "The participant list, and anything while the vote is open."],
    ["Admin", "The participant list (names, emails, voted or not). Who voted what, only through the logged Show names action.", "Nothing is hidden by the system, but every look at names is logged."],
    ["Claude, working as you", "The session set-up, draft invitation wording and the anonymous results of a closed session.", "Participants, emails, ballots and names."],
  ],
};

export const ACCESS_CASES: Table = {
  head: ["I want to…", "Do this", "What happens"],
  rows: [
    ["Name a product manager who has no account yet", "In the grid or the item panel, open Product Manager, type their name (and an email if you have one) and choose Add. A Creator or an admin can do it.", "They show as not invited in pickers, filters and reports, by name. Nothing is sent to them."],
    ["Make the invitation greet someone by first name", "Give the person a first name when you add them (Members, Not invited yet). The invitation then starts “Hi Jane,”.", "With no first name it starts “Hi there,”. A name is never guessed from an email address."],
    ["Invite them when I am ready", "An admin opens Members, Not invited yet, presses Invite…, reviews and confirms.", "Nothing is sent until you confirm. When they accept, they become a member and everything that names them stays."],
    ["Someone joined with a different email than the one I typed", "An admin opens Members, Not invited yet, then Joined with another email, and chooses the member.", "Everything that named them now names that member, and the name leaves the list."],
    ["Ask customers or partners for their view", "An admin creates an alignment session and adds their emails as participants.", "They vote through a link with no account and see nothing else. Results are anonymous and groups under five are hidden."],
    ["Let an executive read the roadmap and nothing else", "Invite them as a Leadership viewer (or a Viewer).", "They can read the portfolio and cannot change or decide anything."],
    ["Let a product manager edit initiatives", "Invite them as a Creator.", "They can create, edit and request gates. They cannot decide a gate unless they also have approval rights."],
    ["Let one person decide Gate B only", "An admin adds them as approver for Gate B in Settings, Workspace. They need to be a member first.", "They may decide that gate. They still cannot manage members or settings."],
    ["Let everyone at my company look around", "An admin lists the company domain under Workspace settings (automatic joining is on by default).", "People who confirm a company email join as an active Viewer and the admins are told. Higher roles are set by an admin."],
    ["Work with two companies with one login", "Each workspace invites the same email address.", "One sign-in shows both workspaces, each with its own role."],
    ["A colleague leaves", "An admin sets them to Paused (they can come back) or Revoked in Members.", "They lose access at once. Everything they created stays, and they stay named on their initiatives and in reports (marked paused or revoked). They are no longer offered when you choose a person."],
    ["Use Claude, ChatGPT or Gemini", "Connect the assistant (Help: Connect an AI assistant).", "It works as you, with your role. It can name people already on the list. It cannot add or invite anyone, and it never approves a gate."],
  ],
};
