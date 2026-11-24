// How the PV skills are named and how they build on each other (issue #643, docs/31-SKILLS.md section 7).
// One name style (pv-<name>), a tier for every skill, and `includes` so a guided skill runs other skills as steps. Data only: the prompt
// text for a plan is built here (planBlock) and added by skillPrompt (skills with a spec) or by the flows (pv-prd, pv-discovery, pv-company).

import type { SkillSpec, SkillStage } from "./skills";

/** guided: beginner, end to end. block: one job, runnable alone, used by guided skills. company: company knowledge, run once and kept current.
 *  advanced: stand-alone. router: picks or explains skills. */
export type SkillTier = "guided" | "block" | "company" | "advanced" | "router";
export const SKILL_TIERS: readonly SkillTier[] = ["guided", "block", "company", "advanced", "router"];
export const SKILL_TIER_LABEL: Record<SkillTier, string> = {
  guided: "Start here (guided, end to end)",
  block: "Building blocks (one job each)",
  company: "Company knowledge (run once, keep current)",
  advanced: "Advanced (stand-alone)",
  router: "Find the right skill",
};
export const SKILL_TIER_SHORT: Record<SkillTier, string> = { guided: "guided", block: "building block", company: "company knowledge", advanced: "advanced", router: "router" };

export type GateLetter = "A" | "B" | "C";
/** What a skill includes. `always` runs in quick and full; `offered` only in full and can be skipped one by one. `byGate` is for pv-gate: offered steps per gate.
 *  `notes` says how an included step differs here (for example a light pre-mortem) or when it applies. */
export type SkillIncludes = {
  always: readonly string[];
  offered: readonly string[];
  byGate?: Partial<Record<GateLetter, readonly string[]>>;
  notes?: Readonly<Record<string, string>>;
};
export type SkillPlan = { tier: SkillTier; includes?: SkillIncludes };

/** Tier and includes of every skill, by command (the catalogue test checks that no skill is missing). */
export const SKILL_PLANS: Readonly<Record<string, SkillPlan>> = {
  // guided
  "pv-company": {
    tier: "guided",
    includes: {
      always: [],
      offered: ["pv-personas", "pv-compete", "pv-market", "pv-vision", "pv-strategy", "pv-northstar", "pv-canvas"],
      notes: { "pv-compete": "a competitor claim needs a source and a date", "pv-market": "every figure needs a source and a date" },
    },
  },
  "pv-discovery": {
    tier: "guided",
    includes: {
      always: ["pv-hypothesis", "pv-metrics", "pv-premortem"],
      offered: ["pv-opportunity-tree", "pv-assumptions", "pv-personas", "pv-market", "pv-compete"],
      notes: {
        "pv-metrics": "one key result only",
        "pv-premortem": "light: the failure story and the top risks only",
        "pv-personas": "for this initiative, only when the confirmed company-level personas do not cover it",
        "pv-market": "for this initiative, only when the confirmed company-level market does not cover it",
        "pv-compete": "for this initiative, only when the confirmed company-level competitors do not cover it",
      },
    },
  },
  "pv-prd": { tier: "guided", includes: { always: ["pv-metrics", "pv-split"], offered: ["pv-stories", "pv-premortem", "pv-pr-faq", "pv-business-case"] } },
  "pv-gate": {
    tier: "guided",
    includes: {
      always: [],
      offered: [],
      byGate: { A: ["pv-one-pager", "pv-stakeholders"], B: ["pv-premortem"], C: ["pv-readiness", "pv-gtm", "pv-release-notes"] },
      notes: { "pv-premortem": "only when the initiative has no pre-mortem yet", "pv-release-notes": "its content goes into this document as a section; nothing is sent or published" },
    },
  },
  "pv-outcome": { tier: "guided", includes: { always: [], offered: ["pv-metrics"], notes: { "pv-metrics": "only when the initiative has no key result yet" } } },
  "pv-weekly": { tier: "guided" },
  "pv-prioritise": { tier: "guided" },
  // building blocks
  "pv-hypothesis": { tier: "block" }, "pv-metrics": { tier: "block" }, "pv-assumptions": { tier: "block" }, "pv-premortem": { tier: "block" }, "pv-split": { tier: "block" },
  "pv-stories": { tier: "block" }, "pv-opportunity-tree": { tier: "block" }, "pv-impact-map": { tier: "block" }, "pv-readiness": { tier: "block" }, "pv-gtm": { tier: "block" },
  "pv-release-notes": { tier: "block" }, "pv-stakeholders": { tier: "block" }, "pv-one-pager": { tier: "block" },
  // company knowledge (sub-skills of pv-company)
  "pv-personas": { tier: "company" }, "pv-compete": { tier: "company" }, "pv-market": { tier: "company" }, "pv-vision": { tier: "company" },
  "pv-strategy": { tier: "company" }, "pv-northstar": { tier: "company" }, "pv-canvas": { tier: "company" },
  // advanced
  "pv-business-case": { tier: "advanced" }, "pv-pr-faq": { tier: "advanced" }, "pv-prototype": { tier: "advanced" }, "pv-experiment": { tier: "advanced" },
  "pv-sunset": { tier: "advanced" }, "pv-quarter": { tier: "advanced" },
  // router
  "pv-which": { tier: "router" }, "pv-help": { tier: "router" },
};

/** The three guided flows that are not a SkillSpec: they have their own prompt builders (PRD, discovery, company profile) and are the renamed
 *  write_prd, write_discovery and research_company. */
export const GUIDED_ONLY: readonly { command: string; title: string; summary: string; stage: SkillStage }[] = [
  { command: "pv-company", title: "Company profile", stage: "direction", summary: "research the company's public website, draft its profile with sources, save it as an AI draft an admin confirms, and offer the company-knowledge skills" },
  { command: "pv-discovery", title: "Discovery", stage: "discover", summary: "write a discovery document and register its initiative, with the hypothesis, one key result and a light pre-mortem" },
  { command: "pv-prd", title: "PRD", stage: "define", summary: "write a PRD and create the initiative, with success metrics and a split into steps" },
];

/** The names the flows had before issue #643. They still work, are not listed in any menu and are served the same text as the pv- name. */
export const FLOW_ALIASES: Readonly<Record<string, string>> = { write_prd: "pv-prd", write_discovery: "pv-discovery", research_company: "pv-company" };
export const canonicalFlow = (name: string): string => FLOW_ALIASES[name] ?? name;

/** Every command an `includes` names, in order, once. */
export function includedCommands(inc: SkillIncludes | undefined): string[] {
  if (!inc) return [];
  return [...new Set([...inc.always, ...inc.offered, ...Object.values(inc.byGate ?? {}).flatMap((l) => l ?? [])])];
}

/** Problems with the plans, for the catalogue test: every skill has a tier, every included skill exists, no skill includes itself or a cycle, depth at most 2. */
export function skillPlanProblems(commands: readonly string[], plans: Readonly<Record<string, SkillPlan>> = SKILL_PLANS): string[] {
  const p: string[] = [];
  const known = new Set([...commands, ...GUIDED_ONLY.map((g) => g.command), "pv-help"]);
  for (const c of known) if (!plans[c]) p.push(`${c}: no tier`);
  for (const c of Object.keys(plans)) if (!known.has(c)) p.push(`${c}: a plan for a skill that does not exist`);
  const depth = (c: string, seen: readonly string[]): number => {
    if (seen.includes(c)) { p.push(`${[...seen, c].join(" -> ")}: a cycle`); return 0; }
    const kids = includedCommands(plans[c]?.includes);
    return kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => depth(k, [...seen, c])));
  };
  for (const c of known) {
    const inc = plans[c]?.includes;
    for (const k of includedCommands(inc)) {
      if (!known.has(k)) p.push(`${c}: includes ${k}, which does not exist`);
      if (k === c) p.push(`${c}: includes itself`);
    }
    for (const k of Object.keys(inc?.notes ?? {})) if (!includedCommands(inc).includes(k)) p.push(`${c}: a note for ${k}, which it does not include`);
    if (inc && inc.always.some((k) => inc.offered.includes(k))) p.push(`${c}: a skill is both always and offered`);
    if (depth(c, []) > 2) p.push(`${c}: includes are nested deeper than 2`);
  }
  return p;
}

/** The rules for composing skills (issue #643, section 4). Rules 4 and 5 (depth, runnable alone) are checked by the catalogue test, not repeated to the assistant. */
export const COMPOSITION_RULES: readonly string[] = [
  "Reuse, do not redo. Read what exists first: the confirmed company-level personas, competitors and market (company profile and workspace documents), and what the initiative already has (hypothesis, key result, persona or competitor entries). If something is there, say so, use it and offer to refine it; never overwrite it silently.",
  "One document. Write every step you run as its own labelled section of this one document (\"## n. <step title> (pv-name)\"), after the sections of this skill, saved as an AI draft. When the person asked for a draft only, save nothing.",
  "A step you run follows its own sections and rules below, with the same wording and the same limits; its own questions are folded into your one message (at most the three most important in all), never asked later.",
  "Initiative fields: a step may fill fields only through the normal path of this flow (a dry run, then a confirmation). Do not use apply_skill_extract here; it belongs to a skill run on its own.",
  "People-only fields and approvals stay with people, exactly as in the rules above. You never approve, request or move a gate or a phase, set Stack Rank, Decision or Value, or send anything.",
];

/** The plan section of a guided skill's prompt: what runs always, what is offered, how the steps are run and what each step covers. Empty for a skill with no includes. */
export function planBlock(command: string, catalogue: readonly Pick<SkillSpec, "command" | "title" | "summary" | "sections" | "rules">[]): string[] {
  const inc = SKILL_PLANS[command]?.includes;
  if (!inc) return [];
  const spec = (c: string) => catalogue.find((s) => s.command === c);
  const label = (c: string) => `${c} (${spec(c)?.title ?? c})`;
  const note = (c: string) => (inc.notes?.[c] ? `; ${inc.notes[c]}` : "");
  const line = (c: string) => `- ${label(c)}: ${spec(c)?.summary ?? ""}${note(c)}`;
  const gates = (["A", "B", "C"] as const).filter((g) => (inc.byGate?.[g] ?? []).length > 0);
  const all = includedCommands(inc);
  const hasSteps = all.length > 0;
  return [
    "",
    "PLAN: THIS SKILL CAN RUN OTHER SKILLS AS STEPS",
    "Show the plan first, in your one message right after the read-back, as: \"This will run: <the steps>. Skip any.\" Then ask once, in the same message: quick (only the steps that always run) or full (adds the offered steps). If the person already said which, do not ask. Skipping is free and never asked twice.",
    ...(inc.always.length ? ["Steps that always run:", ...inc.always.map(line)] : ["No step always runs: this skill does its own work and only offers the steps below."]),
    ...(inc.offered.length ? ["Steps offered, each skippable (full only):", ...inc.offered.map(line)] : []),
    ...(gates.length ? ["Steps offered by gate, each skippable (use the gate the gate pack says is next; if it is not clear, ask in your one message):", ...gates.flatMap((g) => [`Gate ${g}:`, ...(inc.byGate?.[g] ?? []).map(line)])] : []),
    "",
    "HOW THE STEPS RUN",
    ...COMPOSITION_RULES.map((r, i) => `${i + 1}. ${r}`),
    ...(command === "pv-company" ? [`${COMPOSITION_RULES.length + 1}. Company knowledge you write here stays an AI draft until a workspace admin confirms it, as the company profile does. A competitor or market claim carries its source and date; never invent one.`] : []),
    ...(hasSteps ? ["", "WHAT EACH STEP COVERS (write the steps you run; leave the others out)"] : []),
    ...all.flatMap((c) => {
      const s = spec(c);
      if (!s) return [];
      return [`### ${c} (${s.title})`, ...s.sections.map((x) => `- ${x.title}: ${x.covers}`), ...(s.rules.length ? ["Rules of this step:", ...s.rules.map((r) => `- ${r}`)] : [])];
    }),
  ];
}
