// The PV skills, one spec each (issue #565, docs/31-SKILLS.md). Wording is ours. Add a skill here and it is served as a prompt and by
// get_playbook, listed by pv-help and checked by skills.test.ts.

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
    doc: { kind: "other", titlePrefix: "Pre-mortem: " },
    fields: [],
    rules: [
      "Collect the person's own failure reasons first (question 2) and put them in before yours. If they have none, say so and go on.",
      "Likelihood and impact are proposals. Never write them to Confidence or any field, and never present them as a measurement.",
      "Never invent a customer, a number, a competitor move or a partner problem. A risk about a third party is written only from the profile or a source you read, with its source and date.",
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
    doc: { kind: "other", titlePrefix: "One-pager: " },
    fields: [],
    rules: [
      "One page: about 400 words. Cut before you add. Plain sentences, the company's own terms from the profile glossary.",
      "Value and confidence are the person's own figures; if the initiative has none, write \"to define\" and do not estimate them.",
    ],
    decidedBy: "the person named in the ask, at the gate this page is for",
  },
];

export const SKILL_COMMANDS: readonly string[] = SKILLS.map((s) => s.command);
export const skillByCommand = (c: string): SkillSpec | undefined => SKILLS.find((s) => s.command === c);
export const skillHelpText = () => skillHelp(SKILLS);
export { skillPrompt };
