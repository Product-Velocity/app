// The PV skills, one spec each (issue #565, docs/31-SKILLS.md). Wording is ours. Add a skill here and it is served as a prompt and by
// get_playbook, listed by pv-help and checked by skills.test.ts.

import { PROFILE_SECTION_KEYS } from "./company-profile";
import { skillHelp, skillPrompt, type SkillSpec } from "./skills";

export const SKILLS: readonly SkillSpec[] = [
  {
    command: "pv-premortem",
    title: "Pre-mortem",
    summary: "imagine the initiative has failed, merge the reasons, and turn them into ranked risks with early signals and a plan change list",
    stage: "define",
    target: "item",
    profile: ["industry", "position", "competitors", "partners", "glossary"],
    reads: [
      "get_item for the initiative: hypothesis, key result fields, dependencies, dates, estimate, health, tags and the ten latest changes.",
      "list_documents and get_document for its PRD and discovery (and the risks they already name); at most five documents.",
      "get_gate_pack for the gate it has to pass next, so the risks matter for the decision that is coming.",
      "search_items for what it depends on and what depends on it (status and health of those), and for earlier initiatives in the same group that were stopped or slipped.",
    ],
    questions: [
      { id: "date", ask: "Which date or milestone is the plan judged against? (Default: the initiative's target or release date, if it has one.)" },
      { id: "own", ask: "Before you add your own: what are the two or three ways YOU think this could fail? Those go in first, as the person's own." },
      { id: "caller", ask: "Who calls go, adjust or stop when the top risks are known?" },
    ],
    sections: [
      { id: "1", title: "The failure story", covers: "Five to eight sentences written as if the date has passed and the initiative failed: what happened, in order, in plain words. It is a story, not a list. Use only facts from the initiative and its documents, and mark invented colour as illustration." },
      { id: "2", title: "Reasons it failed", covers: "The reasons in the story, merged (the same reason once), grouped under customer, build, market, people and capacity, dependencies, compliance and trust, other. Each carries its source: \"person's own\", \"from the PRD\", \"from a field or dependency\" or \"proposed by Claude\". Reasons are never attributed to individuals." },
      { id: "3", title: "Top risks", covers: "A table of the most serious risks (ten at most): risk, why it matters, likelihood and impact as High, Medium or Low (marked proposed), the earliest signal that it is happening, the mitigation, and where in Product Velocity the signal would show (a field, a dependency, a report). Owner is left \"to name\" unless the person named one." },
      { id: "4", title: "Plan changes to consider", covers: "Concrete changes that would remove or shrink the top risks: scope, order, an experiment first, a dependency to settle, a guardrail metric. Suggestions only; nothing is changed in the initiative." },
      { id: "5", title: "Bets we are making", covers: "The assumptions the plan rests on that no one has tested, each with the cheapest way to test it." },
    ],
    doc: { kind: "premortem", titlePrefix: "Pre-mortem: " },
    fields: ["dependencies_blockers"],
    rules: [
      "Collect the person's own failure reasons first (question 2) and put them in before yours. If they have none, say so and go on.",
      "Likelihood and impact are proposals. Never write them to Confidence or any field, and never present them as a measurement.",
      "Never invent a customer, a number, a competitor move or a partner problem. A risk about a third party is written only from the profile or a source you read, with its source and date.",
      "Values for Product Velocity: only dependencies_blockers, and only the dependencies and blockers the person confirmed or the initiative's own fields show, in one or two plain lines.",
    ],
    decidedBy: "the person who owns the plan (go, adjust or stop), at the next gate",
  },
  {
    command: "pv-one-pager",
    title: "One-pager",
    summary: "one page that asks for one decision: the problem, the bet, how we will know, what we will not do",
    stage: "define",
    target: "item",
    profile: ["industry", "position", "products", "personas", "glossary", "voice"],
    reads: [
      "get_item for the initiative: hypothesis, value proposition, key result fields, target segments, dependencies, dates and description.",
      "list_documents and get_document for its discovery or PRD, and search_items for related initiatives in the same group; at most five documents. Reuse their wording, key results and evidence; do not contradict them.",
      "get_gate_pack to see which gate the page is for and what is still missing for it.",
    ],
    questions: [
      { id: "ask", ask: "Who reads this and who decides? What exactly is the decision you want, and by when?" },
      { id: "evidence", ask: "What evidence do you have (data, customer words, a link)? Say where it lives; I will not invent any." },
      { id: "wont", ask: "What are we explicitly not doing in this bet?" },
    ],
    team: true,
    sections: [
      { id: "1", title: "The ask", covers: "The decision wanted, from whom, by when, in one or two sentences. First on the page." },
      { id: "2", title: "Problem", covers: "Who has the problem and what it costs them, in the customers' and the company's words, with evidence by source." },
      { id: "3", title: "Who and why now", covers: "The segment from the profile or the initiative and what makes this the moment." },
      { id: "4", title: "The bet", covers: "What we would build or change, as the hypothesis lines IF, THEN and RESULTING IN copied from the initiative when it has them, and the customer-safe value proposition when it has one. No money amounts." },
      { id: "5", title: "How we will know", covers: "The key result (metric, start, target, direction) from the initiative's fields, or \"to define\"; one guardrail when the person named it." },
      { id: "6", title: "What we will not do", covers: "The explicit exclusions." },
      { id: "7", title: "Risks and open questions", covers: "The three that matter most, and what would change the answer." },
    ],
    doc: { kind: "one_pager", titlePrefix: "One-pager: " },
    fields: [],
    rules: [
      "One page: about 400 words. Cut before you add. Plain sentences, the company's own terms from the profile glossary.",
      "Value and confidence are the person's own figures; if the initiative has none, write \"to define\" and do not estimate them.",
    ],
    decidedBy: "the person named in the ask, at the gate this page is for",
  },
  {
    command: "pv-metrics",
    title: "Success metrics",
    summary: "define how we will know it worked: one key result, the signals around it, guardrails, gaps and when we read it out",
    stage: "prove",
    target: "item",
    profile: ["products", "personas", "glossary", "strategy", "metrics"].filter((k) => PROFILE_SECTION_KEYS.includes(k)),
    reads: [
      "get_item for the initiative: hypothesis, the key result fields (metric, unit, direction, start, target), objective, target segments and dates.",
      "get_outcome_reviews for any 30, 60 and 90 day reviews (and what they already measured); list_documents and get_document for its PRD or discovery and the success measures they name.",
      "search_items for earlier initiatives in the same group with a key result, to reuse metric names and units so results can be compared.",
    ],
    questions: [
      { id: "different", ask: "What should be different for customers, or for the company, if this works? One or two sentences in your words." },
      { id: "data", ask: "Which numbers can you measure today, and where do they come from? Give me a baseline if you have one; I will not make one up." },
      { id: "worked", ask: "Who decides that it \"worked\", and what result would make them say so?" },
    ],
    sections: [
      { id: "1", title: "What should be different", covers: "The change for customers or the company in plain words, tied to the hypothesis." },
      { id: "2", title: "The key result", covers: "One primary metric: what it counts, unit, direction (increase or decrease), start value, target value, where and how it is measured, and the period. Start and target are the person's numbers or \"to define\"." },
      { id: "3", title: "Signals around it", covers: "A table over what matters here: adoption (who starts using it), usage (how much), task success (can they do the job), satisfaction or trust, and retention. Only the rows that apply. Per row: signal, metric, baseline, target, source. Everything not given is \"to define\"." },
      { id: "4", title: "Guardrails", covers: "Metrics that must not get worse, with the limit and why each one matters." },
      { id: "5", title: "What we cannot measure yet", covers: "Missing instrumentation or data, and the smallest step to get it." },
      { id: "6", title: "When we read it out", covers: "The checkpoints (aligned with the 30, 60 and 90 day outcome reviews in Product Velocity), who reads each, and what happens to the initiative for each result. Suggestions only." },
    ],
    doc: { kind: "success_metrics", titlePrefix: "Success metrics: " },
    fields: ["kr_metric", "kr_start", "kr_target", "kr_unit", "kr_direction"],
    rules: [
      "Baselines, targets and thresholds come from the person or a source you read, with its source. Never estimate a target to make the table look complete.",
      "Values for Product Velocity: the primary key result only (kr_metric, kr_unit, kr_direction, kr_start, kr_target). Numbers are plain numbers; kr_unit and kr_direction use the allowed values from describe_fields.",
      "Do not write Business Value, Confidence or any money figure anywhere; those are the person's.",
    ],
    decidedBy: "the person who decides that it worked, when the key result is read out",
  },
  {
    command: "pv-gtm",
    title: "Go-to-market plan",
    summary: "who it is for, what we tell them, whether each team is ready, what enablement is needed, and a go or hold checkpoint",
    stage: "launch",
    target: "item",
    profile: ["products", "personas", "competitors", "partners", "glossary", "voice"],
    reads: [
      "get_item for the initiative: audience, target and live scope, target segments, roll-out percentage, value proposition (customer-safe), dates, the build status fields and enablement notes.",
      "list_documents and get_document for its PRD (roll-out plan, customer value proposition) and any research; at most five documents.",
      "get_gate_pack for the roll-out gate, so the readiness table matches what the gate will check.",
      "search_items for what it depends on and for earlier launches in the same group, to reuse how they were announced.",
    ],
    questions: [
      { id: "date", ask: "What is the launch date and can it move? Who makes the go call?" },
      { id: "size", ask: "How big a launch is this: quiet (in-product only), standard (customers told) or major (campaign)? Say which; I will propose one with reasons if you do not." },
      { id: "teams", ask: "Which teams need to be ready (support, sales or customer success, marketing, legal, partners) and who speaks for each?" },
    ],
    team: true,
    sections: [
      { id: "1", title: "The launch", covers: "Date, whether it can move, launch size (quiet, standard or major) with the reason, and who makes the go call." },
      { id: "2", title: "Audiences and positioning", covers: "Per audience: who they are (profile personas and the initiative's target segments), what they get in their words, the customer-safe value proposition, and what we do not claim. Competitor mentions only from the profile, sourced and dated." },
      { id: "3", title: "Readiness by team", covers: "A table: team, what must be true, status (ready, at risk, not started, as the person said), named owner (the person's own), date. Unknown is \"to define\"." },
      { id: "4", title: "Enablement brief", covers: "What support, sales and partners need to know: what changed, who is affected, what to say, what to avoid, where to send questions. Plain language, no internal-only figures." },
      { id: "5", title: "Roll-out steps", covers: "The steps from first exposure to everyone (scope, percentage, who is added when), taken from the PRD's roll-out plan, and what pauses the roll-out." },
      { id: "6", title: "Go or hold checkpoint", covers: "The conditions checked before the date, who checks them, and what happens on hold." },
    ],
    doc: { kind: "go_to_market", titlePrefix: "Go-to-market: " },
    fields: ["audience", "target_scope", "target_segments", "gtm_enablement_notes"],
    rules: [
      "Values for Product Velocity: audience and the lists target_scope and target_segments (comma-separated, customer-safe wording) use the allowed values or the person's own words; gtm_enablement_notes is a short plain summary of section 4 (it can hold internal detail and never reaches GitHub).",
      "No claim about a competitor, a partner or a customer that you did not read in the profile or from the person. No customer names in customer-facing wording.",
    ],
    decidedBy: "the person who makes the go call, at the go or hold checkpoint",
  },
  {
    command: "pv-experiment",
    title: "Experiment design",
    summary: "a hypothesis, variants, one primary metric, a sample check and a decision rule written before the test starts",
    stage: "prove",
    target: "item",
    profile: ["products", "personas", "glossary", "metrics"].filter((k) => PROFILE_SECTION_KEYS.includes(k)),
    reads: [
      "get_item for the initiative: hypothesis, key result fields, target segments and phase.",
      "list_documents and get_document for its PRD, especially the roll-out plan (the experiment ladder) and any success metrics document; at most five documents. Build on them, do not contradict them.",
      "search_items for earlier experiments in the same group and their outcome reviews, to reuse metric definitions.",
    ],
    questions: [
      { id: "belief", ask: "What does each side believe will happen, and why? Name the one metric that would settle it." },
      { id: "traffic", ask: "Roughly how many people reach the changed experience per week, and what is the metric's current level? I will not invent either." },
      { id: "stop", ask: "What result would make you ship, iterate and stop? Give thresholds if you have them." },
    ],
    sections: [
      { id: "1", title: "Hypothesis", covers: "IF we do X, THEN Y happens, RESULTING IN metric Z, copied from the initiative when it has them, and the reason (BECAUSE) with its evidence." },
      { id: "2", title: "Variants", covers: "Control and each treatment: what is different, in plain words, and what is held the same." },
      { id: "3", title: "Metrics", covers: "One primary metric (definition, unit, where measured) and the guardrails with limits. Nothing else is a success metric." },
      { id: "4", title: "Who, how many and how long", covers: "The eligible people, how they are split, and a sample size check. Show the formula and the inputs the person gave (baseline, smallest change worth detecting, weekly reach); with an input missing, say \"to define\" and what is needed." },
      { id: "5", title: "Decision rule", covers: "Written before the test: for each result (clear win, no difference, harm to a guardrail) what is done. Thresholds are the person's." },
      { id: "6", title: "Risks and limits", covers: "Novelty effects, overlap with other tests, privacy and consent questions, and what the test cannot show." },
    ],
    doc: { kind: "experiment", titlePrefix: "Experiment: " },
    fields: ["hypothesis"],
    rules: [
      "Never state a sample size, duration or effect that is not computed from numbers the person gave you; show the inputs next to it.",
      "Values for Product Velocity: hypothesis only, as the three lines IF, THEN and RESULTING IN written exactly as in section 1.",
      "The decision rule is the person's. Write what they said; mark any option you suggest as proposed.",
    ],
    decidedBy: "the person who owns the experiment, before it starts and when it ends",
  },
  {
    command: "pv-stories",
    title: "Story map and user stories",
    summary: "the user's journey as a backbone, the thinnest end-to-end slice first, then stories with acceptance scenarios",
    stage: "deliver",
    target: "item",
    profile: ["personas", "glossary", "products"],
    reads: [
      "get_item for the initiative: description, hypothesis, target segments, dependencies and how it is linked to the tracker (GitHub or Jira epics).",
      "list_documents and get_document for its PRD (requirements and non-goals) and acceptance criteria; at most five documents. Every story traces to a requirement or says it does not.",
      "search_items for related initiatives, so shared parts are named once.",
    ],
    questions: [
      { id: "who", ask: "Who is the user and what is their goal? (The profile's personas are the default; tell me which.)" },
      { id: "done", ask: "What does done mean for your team (tests, review, release), if it is not already written down?" },
      { id: "slice", ask: "Is there a first release you already have in mind, or a date the first slice must meet?" },
    ],
    sections: [
      { id: "1", title: "Backbone", covers: "The user's activities left to right, in the order they happen, each in a few words." },
      { id: "2", title: "Walking skeleton", covers: "The thinnest path through the backbone that works end to end and could be released, and why it is first." },
      { id: "3", title: "Release slices", covers: "The slices after it, each a coherent improvement, with what each one adds." },
      { id: "4", title: "Stories", covers: "Per story: \"As a <user>, I want <goal> so that <benefit>\", the requirement it traces to, and scenarios in Given / When / Then. No estimates and no assignee." },
      { id: "5", title: "Check", covers: "Which stories are too large, not testable or depend on another, and how to split or reorder them." },
      { id: "6", title: "Questions for refinement", covers: "What the team must answer before building, and who can." },
    ],
    doc: { kind: "user_stories", titlePrefix: "Stories: " },
    fields: [],
    rules: [
      "Stories are written in the document only. This skill does not create issues; the existing tracker preview and confirmation does that.",
      "Do not add features the PRD does not name; put them in the refinement questions instead.",
    ],
    decidedBy: "the product manager and the engineering lead, before the first slice is planned",
  },
];

export const SKILL_COMMANDS: readonly string[] = SKILLS.map((s) => s.command);
export const skillByCommand = (c: string): SkillSpec | undefined => SKILLS.find((s) => s.command === c);
export const skillHelpText = () => skillHelp(SKILLS);
export { skillPrompt };
