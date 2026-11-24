import { describe, expect, it } from "vitest";
import { FLOW_ALIASES, GUIDED_ONLY, SKILL_PLANS, SKILL_TIERS, canonicalFlow, includedCommands, planBlock, skillPlanProblems, type SkillPlan } from "./skill-plan";
import { skillHelpText, skillByCommand, skillPrompt, SKILLS } from "./skills-catalog";

const commands = SKILLS.map((s) => s.command);
const prompt = (c: string, a: Parameters<typeof skillPrompt>[1] = {}) => skillPrompt(skillByCommand(c)!, a, { catalogue: SKILLS }).text;
const inTier = (t: string) => Object.entries(SKILL_PLANS).filter(([, p]) => p.tier === t).map(([c]) => c).sort();

describe("skill tiers and plans (issue #643)", () => {
  it("every skill has a tier, every included skill exists, nothing is nested deeper than two and nothing loops", () => {
    expect(skillPlanProblems(commands)).toEqual([]);
    for (const s of SKILLS) expect(s.tier, s.command).toBeDefined();
  });

  it("the tiers are the ones in the issue", () => {
    expect(inTier("guided")).toEqual(["pv-company", "pv-discovery", "pv-gate", "pv-outcome", "pv-prd", "pv-prioritise", "pv-weekly"]);
    expect(inTier("block")).toEqual(["pv-assumptions", "pv-gtm", "pv-hypothesis", "pv-impact-map", "pv-metrics", "pv-one-pager", "pv-opportunity-tree", "pv-premortem", "pv-readiness", "pv-release-notes", "pv-split", "pv-stakeholders", "pv-stories"]);
    expect(inTier("company")).toEqual(["pv-canvas", "pv-compete", "pv-market", "pv-northstar", "pv-personas", "pv-strategy", "pv-vision"]);
    expect(inTier("advanced")).toEqual(["pv-business-case", "pv-experiment", "pv-pr-faq", "pv-prototype", "pv-quarter", "pv-sunset"]);
    expect(inTier("router")).toEqual(["pv-help", "pv-which"]);
    expect(SKILL_TIERS).toHaveLength(5);
  });

  it("the guided skills include what the issue's table says", () => {
    const inc = (c: string) => SKILL_PLANS[c]!.includes!;
    expect(inc("pv-company").always).toEqual([]);
    expect(inc("pv-company").offered).toEqual(["pv-personas", "pv-compete", "pv-market", "pv-vision", "pv-strategy", "pv-northstar", "pv-canvas"]);
    expect(inc("pv-discovery").always).toEqual(["pv-hypothesis", "pv-metrics", "pv-premortem"]);
    expect(inc("pv-discovery").offered).toEqual(["pv-opportunity-tree", "pv-assumptions", "pv-personas", "pv-market", "pv-compete"]);
    expect(inc("pv-prd").always).toEqual(["pv-metrics", "pv-split"]);
    expect(inc("pv-prd").offered).toEqual(["pv-stories", "pv-premortem", "pv-pr-faq", "pv-business-case"]);
    expect(inc("pv-gate").byGate).toEqual({ A: ["pv-one-pager", "pv-stakeholders"], B: ["pv-premortem"], C: ["pv-readiness", "pv-gtm", "pv-release-notes"] });
    expect(inc("pv-outcome").offered).toEqual(["pv-metrics"]);
    expect(SKILL_PLANS["pv-weekly"]!.includes).toBeUndefined();
    expect(SKILL_PLANS["pv-prioritise"]!.includes).toBeUndefined();
  });

  it("the check catches a missing skill, a cycle, a self-include, a note for a skill that is not included and too much depth", () => {
    const plans: Record<string, SkillPlan> = {
      "pv-a": { tier: "guided", includes: { always: ["pv-b"], offered: [] } },
      "pv-b": { tier: "block", includes: { always: ["pv-a"], offered: [] } },
      "pv-c": { tier: "block", includes: { always: ["pv-c", "pv-zzz"], offered: [], notes: { "pv-a": "x" } } },
      "pv-d": { tier: "guided", includes: { always: ["pv-e"], offered: [] } },
      "pv-e": { tier: "block", includes: { always: ["pv-f"], offered: [] } },
      "pv-f": { tier: "block", includes: { always: ["pv-g"], offered: [] } },
      "pv-g": { tier: "block" },
    };
    const p = skillPlanProblems(["pv-a", "pv-b", "pv-c", "pv-d", "pv-e", "pv-f", "pv-g", "pv-nothing"], plans).join("\n");
    expect(p).toMatch(/pv-a -> pv-b -> pv-a: a cycle/);
    expect(p).toMatch(/pv-c: includes itself/);
    expect(p).toMatch(/pv-c: includes pv-zzz, which does not exist/);
    expect(p).toMatch(/pv-c: a note for pv-a/);
    expect(p).toMatch(/pv-d: includes are nested deeper than 2/);
    expect(p).toMatch(/pv-nothing: no tier/);
  });

  it("the old names are aliases of the pv- names, and an unknown name is left alone", () => {
    expect(FLOW_ALIASES).toEqual({ write_prd: "pv-prd", write_discovery: "pv-discovery", research_company: "pv-company" });
    expect(canonicalFlow("write_prd")).toBe("pv-prd");
    expect(canonicalFlow("pv-prd")).toBe("pv-prd");
    expect(canonicalFlow("pv-premortem")).toBe("pv-premortem");
    for (const g of GUIDED_ONLY) expect(g.command).toMatch(/^pv-[a-z]+$/);
    expect(Object.values(FLOW_ALIASES).sort()).toEqual(GUIDED_ONLY.map((g) => g.command).sort());
  });
});

describe("the plan in a guided prompt", () => {
  it("pv-gate shows the steps for each gate and says the plan comes first", () => {
    const t = prompt("pv-gate", { target: "R-12" });
    expect(t).toMatch(/PLAN: THIS SKILL CAN RUN OTHER SKILLS AS STEPS/);
    expect(t).toMatch(/This will run: <the steps>\. Skip any\./);
    expect(t).toMatch(/quick \(only the steps that always run\) or full/);
    expect(t).toMatch(/Gate A:\n- pv-one-pager[^\n]*\n- pv-stakeholders/);
    expect(t).toMatch(/Gate B:\n- pv-premortem[^\n]*only when the initiative has no pre-mortem yet/);
    expect(t).toMatch(/Gate C:\n- pv-readiness[^\n]*\n- pv-gtm[^\n]*\n- pv-release-notes/);
    expect(t).toMatch(/the plan of steps \(see PLAN\) with the quick-or-full question/);
  });

  it("an included step's sections and rules are in the prompt, so an assistant without get_playbook can run it", () => {
    const t = prompt("pv-outcome", { target: "R-12" });
    expect(t).toMatch(/### pv-metrics \(/);
    const metrics = skillByCommand("pv-metrics")!;
    expect(t).toContain(metrics.sections[0]!.title);
    expect(t).toMatch(/only when the initiative has no key result yet/);
  });

  it("the composition rules are there: reuse, one document, fields only through the normal path, guardrails unchanged", () => {
    const t = prompt("pv-gate", { target: "R-12" });
    expect(t).toMatch(/Reuse, do not redo/);
    expect(t).toMatch(/One document\. Write every step you run as its own labelled section/);
    expect(t).toMatch(/Do not use apply_skill_extract here/);
    expect(t).toMatch(/never approve, request or move a gate or a phase, set Stack Rank, Decision or Value, or send anything/);
  });

  it("a skill with no includes has no plan, and no building block has one", () => {
    expect(prompt("pv-weekly")).not.toMatch(/PLAN: THIS SKILL CAN RUN/);
    expect(prompt("pv-prioritise", { target: "R-1" })).not.toMatch(/PLAN: THIS SKILL CAN RUN/);
    for (const s of SKILLS.filter((x) => x.tier === "block")) expect(prompt(s.command, { target: "R-1" }), s.command).not.toMatch(/PLAN: THIS SKILL CAN RUN/);
  });

  it("pv-prd, pv-discovery and pv-company get their plan from the same data", () => {
    const prd = planBlock("pv-prd", SKILLS).join("\n");
    expect(prd).toMatch(/Steps that always run:\n- pv-metrics[^\n]*\n- pv-split/);
    expect(prd).toMatch(/Steps offered, each skippable \(full only\):\n- pv-stories[^\n]*\n- pv-premortem[^\n]*\n- pv-pr-faq[^\n]*\n- pv-business-case/);
    const disc = planBlock("pv-discovery", SKILLS).join("\n");
    expect(disc).toMatch(/pv-metrics[^\n]*one key result only/);
    expect(disc).toMatch(/pv-premortem[^\n]*light: the failure story and the top risks only/);
    expect(disc).toMatch(/pv-personas[^\n]*only when the confirmed company-level personas do not cover it/);
    const co = planBlock("pv-company", SKILLS).join("\n");
    expect(co).toMatch(/No step always runs/);
    expect(co).toMatch(/Company knowledge you write here stays an AI draft until a workspace admin confirms it/);
    expect(co).toMatch(/a competitor claim needs a source and a date/);
    expect(planBlock("pv-weekly", SKILLS)).toEqual([]);
  });

  it("includedCommands lists each skill once, per-gate ones included", () => {
    expect(includedCommands(SKILL_PLANS["pv-gate"]!.includes)).toEqual(["pv-one-pager", "pv-stakeholders", "pv-premortem", "pv-readiness", "pv-gtm", "pv-release-notes"]);
    expect(includedCommands(undefined)).toEqual([]);
  });
});

describe("pv-help and pv-which know the tiers and the three guided flows", () => {
  it("pv-help groups the skills by kind, lists pv-prd, pv-discovery and pv-company and names the old aliases", () => {
    const { text } = skillHelpText();
    expect(text).toMatch(/Start here \(guided, end to end\):\n- pv-company[^\n]*\n- pv-discovery[^\n]*\n- pv-prd/);
    for (const label of ["Building blocks (one job each):", "Company knowledge (run once, keep current):", "Advanced (stand-alone):", "Find the right skill:"]) expect(text).toContain(label);
    expect(text).toMatch(/write_prd, write_discovery and research_company still work; they are pv-prd, pv-discovery and pv-company/);
    for (const s of SKILLS) expect(text).toContain(s.command);
  });

  it("pv-which can recommend the guided flows, marked as guided", () => {
    const t = prompt("pv-which");
    expect(t).toMatch(/- pv-prd \(Define; guided;/);
    expect(t).toMatch(/- pv-discovery \(Discover; guided;/);
    expect(t).toMatch(/- pv-company \(Set direction; guided;/);
    expect(t).toMatch(/the lightest one that does the job/);
  });
});
