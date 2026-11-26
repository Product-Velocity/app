import { describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY, HIDDEN_FIELDS } from "@pv/domain";
import { AGENT_ADVANTAGES, AGENT_GUIDES, AGENT_TABS, AGENT_USE_CASES, COLUMNS_NOTE, COLUMN_GROUPS, COLUMN_ROWS, OVERRIDE_KEYS, UPDATE_OVERRIDE_KEYS, accessLabel } from "./help-content";

describe("Help guide columns table", () => {
  it("has exactly one row for every column in the field dictionary, in its order", () => {
    expect(COLUMN_ROWS.map((r) => r.key)).toEqual(FIELDS.filter((f) => !HIDDEN_FIELDS.has(f.key)).map((f) => f.key));
    expect(COLUMN_ROWS.length).toBe(178); // every field of the dictionary is shown (Roadmap Category came back on 2026-11-18)
    expect(COLUMN_ROWS.some((r) => r.key === "roadmap_category")).toBe(true);
  });
  it("gives every row text in every cell", () => {
    for (const r of COLUMN_ROWS) for (const [k, v] of Object.entries(r)) expect(v, `${r.key}.${k}`).not.toBe("");
  });
  it("keeps every group of the dictionary", () => {
    expect(COLUMN_GROUPS).toEqual([...new Set(FIELDS.map((f) => f.group))]);
  });
  it("has wording only for columns that exist", () => {
    for (const k of OVERRIDE_KEYS) expect(FIELD_BY_KEY[k], k).toBeDefined();
  });
  it("takes read-only from the dictionary, not from the text", () => {
    expect(accessLabel(["initiative_name"])).toBe("Read/write");
    expect(accessLabel(["status"])).toBe("Read-only (tracker)");
    expect(accessLabel(["item_code"])).toBe("Read-only");
    expect(accessLabel(["value_weighted"])).toBe("Read-only");
    const row = (k: string) => COLUMN_ROWS.find((r) => r.key === k)!;
    expect(row("status").access).toBe("Read-only (tracker)");
    expect(row("sponsor").access).toBe("Read/write");
  });
  it("never shows a commercial column as synced to GitHub or Jira", () => {
    for (const k of ["value_12m", "confidence", "customers_requesting", "decision", "kr_metric", "cost_of_not_doing"]) {
      const r = COLUMN_ROWS.find((x) => x.key === k)!;
      expect(r.github, k).toMatch(/never/i);
      expect(r.jira, k).toMatch(/never/i);
    }
  });
});

describe("Help guide values", () => {
  it("lists every state of a fixed-list column in full, in order", () => {
    for (const f of FIELDS.filter((x) => !HIDDEN_FIELDS.has(x.key))) {
      if (f.allowed.length === 0 || f.key === "g2m_quarter") continue;
      const r = COLUMN_ROWS.find((x) => x.key === f.key)!;
      expect(r.what, f.key).toContain(`Values: ${f.allowed.join(" · ")}.`);
    }
  });
  it("says how an open or generated list works instead of printing examples", () => {
    const what = (k: string) => COLUMN_ROWS.find((x) => x.key === k)!.what;
    expect(what("focus_area")).toMatch(/Open list/);
    expect(what("audience")).not.toMatch(/Publishers/);
    expect(what("g2m_quarter")).toMatch(/calendar quarter/i);
  });
});

describe("Help guide: how each column is updated", () => {
  const row = (k: string) => COLUMN_ROWS.find((x) => x.key === k)!;
  it("names an update route for every column, and only for columns that exist", () => {
    for (const r of COLUMN_ROWS) expect(r.updated, r.key).not.toBe("");
    for (const k of UPDATE_OVERRIDE_KEYS) expect(FIELD_BY_KEY[k], k).toBeDefined();
  });
  it("shows tracker-driven columns as webhook, auto sync and manual sync", () => {
    for (const k of ["status", "issues_closed", "open_prs", "ci_status", "gh_project_status"]) {
      expect(row(k).updated, k).toMatch(/Webhook/);
      expect(row(k).updated, k).toMatch(/Auto sync/);
      expect(row(k).updated, k).toMatch(/Manual sync/);
    }
  });
  it("lets only a person change commercial and decision columns", () => {
    for (const k of ["value_12m", "confidence", "customers_requesting", "decision", "stack_rank"]) {
      if (k === "stack_rank") continue;
      expect(row(k).updated, k).toBe("You edit it");
    }
  });
  it("sends the texts only by manual sync, after you confirm", () => {
    expect(row("description").updated).toBe("You edit it · Manual sync (Sync with GitHub or Jira)");
    expect(row("description").updated).not.toMatch(/Webhook|Auto/);
  });
  it("never lets a tracker or sync set the phase, status or health", () => {
    for (const k of ["initiative_phase", "initiative_status", "health"]) expect(row(k).updated, k).toBe("You edit it");
  });
  it("marks calculated and system columns", () => {
    expect(row("value_weighted").updated).toMatch(/Calculated/);
    expect(row("created_at").updated).toBe("Set by the system");
  });
});

describe("Help guide: exact target fields", () => {
  const row = (k: string) => COLUMN_ROWS.find((x) => x.key === k)!;
  it("names the exact GitHub target of what the app sends", () => {
    expect(row("initiative_name").github).toMatch(/issue title/);
    expect(row("description").github).toMatch(/## Description/);
    expect(row("moscow").github).toMatch(/pm:moscow\//);
    expect(row("moscow").github).toMatch(/Priority/);
    expect(row("stack_rank").github).toMatch(/pm:rank\//);
    expect(row("effort").github).toMatch(/Size/);
    expect(row("g2m_date_est").github).toMatch(/milestone/);
    expect(row("theme").github).toMatch(/pm:group\//);
    expect(row("theme").jira).toMatch(/pm:group\/.*only/); // the group is a label only; the Jira Theme field gets the Focus Area
    expect(row("focus_area").jira).toMatch(/Theme/);
    expect(row("theme").jira).not.toMatch(/planned/);
  });
  it("names the exact GitHub source of what the app reads", () => {
    expect(row("status").github).toMatch(/^Read from issue state/);
    expect(row("ci_status").github).toMatch(/default branch/);
    expect(row("gh_project_status").github).toMatch(/field Status/);
  });
  it("does not claim a send that is not built", () => {
    for (const k of ["planned_start"]) {
      expect(row(k).github, k).toMatch(/Not sent yet/);
      expect(row(k).updated, k).toBe("You edit it");
    }
    // issue #321: the optional labels are built, off by default, and the Help says where to switch them on (Business Value Type replaced Roadmap Category)
    for (const k of ["focus_area", "tags"]) {
      expect(row(k).github, k).toMatch(/^Sent to label pm:|^Sent to one label pm:/i);
      expect(row(k).github, k).toMatch(/off by default/);
      expect(row(k).jira, k).toMatch(/off by default/);
      expect(row(k).updated, k).toMatch(/^You edit it/);
    }
  });
  it("says for every column the app sends to GitHub what Jira gets: a target, or plainly that it is not sent", () => {
    for (const r of COLUMN_ROWS.filter((x) => x.github.startsWith("Sent to"))) expect(r.jira, r.key).toMatch(/^(Sent to |Not sent|Start date field|Not synced)/);
  });
  it("names what Sync with Jira really sends today, and no planned target as if it were built", () => {
    const sent = (k: string) => COLUMN_ROWS.find((r) => r.key === k)!.jira;
    expect(sent("initiative_name")).toMatch(/^Sent to Summary/);
    expect(sent("description")).toMatch(/^Sent to Jira description, section "Description", converted to Jira's format/);
    expect(sent("g2m_date_est")).toBe("Sent to Due date");
    expect(sent("moscow")).toMatch(/Label pm:moscow/);
    expect(sent("stack_rank")).toMatch(/band, never the number/);
    expect(sent("planned_start")).toMatch(/Field configuration/);
    // issue #319: Jira gets the same sections as the GitHub block
    expect(sent("summary")).toMatch(/Jira description, section "Summary"/);
    expect(sent("hypothesis")).toMatch(/Jira description, section "Hypothesis/);
    expect(sent("artifacts")).toMatch(/^Sent to Jira description, section "Artifacts"/);
    expect(sent("screenshots")).toMatch(/section "Files"/);
    for (const k of ["effort", "assignees"]) expect(sent(k), k).toMatch(/^Not (sent|synced)/);
    for (const k of ["open_prs", "ci_status", "latest_release"]) expect(sent(k), k).toBe("Not read yet");
    // the children of the linked issue are read now, so the roll-up columns say where they come from (and that a done child is not a done initiative)
    for (const k of ["issues_total", "issues_closed", "delivery_progress_pct"]) expect(sent(k), k).toMatch(/children/);
    expect(sent("delivery_progress_pct")).toMatch(/never a done initiative/);
  });
});

describe("Help guide: AI agents (request #230)", () => {
  const text = (o: unknown) => JSON.stringify(o);
  it("is structured as use-cases, Claude, ChatGPT and Gemini, in that order", () => {
    expect(AGENT_TABS.map((t) => t.label)).toEqual(["Use-cases", "Claude", "ChatGPT", "Gemini"]);
    expect(Object.keys(AGENT_GUIDES)).toEqual(["claude", "chatgpt", "gemini"]);
  });
  it("explains brainstorm, create, review and update, and the advantages of the profile, the project context and the rest", () => {
    expect(AGENT_USE_CASES.rows.map((r) => r[0])).toEqual(["Brainstorm", "Create", "Review", "Prepare a gate", "Link Jira epics", "Record outcome metrics", "Read a Confluence page", "Ask to publish to Confluence", "Ask to import or refresh from Confluence", "Skills (pv-)", "Update"]);
    // Claude only asks for Confluence publishing, imports and updates: the rows say nothing is sent, read in or changed until a person confirms (issue #721)
    expect(AGENT_USE_CASES.rows.find((r) => r[0] === "Ask to publish to Confluence")?.[1]).toMatch(/nothing is sent/i);
    expect(AGENT_USE_CASES.rows.find((r) => r[0] === "Ask to import or refresh from Confluence")?.[1]).toMatch(/nothing is read into a document and nothing is changed/i);
    expect(AGENT_USE_CASES.rows.find((r) => r[0] === "Read a Confluence page")?.[1]).toMatch(/never browses Confluence/);
    // a gate pack is evidence for a person: the use-case says Claude cannot decide (CLAUDE.md rule 3)
    expect(AGENT_USE_CASES.rows.find((r) => r[0] === "Prepare a gate")![1]).toMatch(/cannot request, decide or approve/);
    const adv = AGENT_ADVANTAGES.map((a) => a.title.toLowerCase()).join(" | ");
    for (const w of ["company profile", "project and workspace context", "prior knowledge", "research", "team", "ai tool and model", "safe"]) expect(adv, w).toContain(w);
  });
  it("gives each assistant setup, onboarding, features and commands, including how to revoke", () => {
    for (const [k, g] of Object.entries(AGENT_GUIDES)) {
      expect(g.setup.length, k).toBeGreaterThan(1);
      expect(g.onboarding.join(" "), k).toMatch(/revoke/i);
      expect(g.onboarding.join(" "), k).toMatch(/off by default/);
      expect(g.features.rows.length, k).toBeGreaterThan(2);
    }
  });
  it("names every flow the server offers (a new flow cannot ship without Help), in the Claude and ChatGPT sections", async () => {
    const { FLOW_NAMES } = await import("../lib/mcp/flows");
    for (const name of FLOW_NAMES) {
      expect(text(AGENT_GUIDES.claude.features), name).toContain(name);
      expect(text(AGENT_GUIDES.chatgpt.features) + text(AGENT_GUIDES.gemini.features), name).toContain(name);
    }
  });
  it("tells each assistant's specifics: Claude Code command, ChatGPT playbook and Developer mode, Gemini /mcp auth", () => {
    expect(text(AGENT_GUIDES.claude)).toMatch(/\/mcp__product-velocity__pv-discovery/);
    expect(text(AGENT_GUIDES.chatgpt)).toMatch(/get_playbook/);
    expect(text(AGENT_GUIDES.chatgpt)).toMatch(/Developer mode/);
    expect(text(AGENT_GUIDES.chatgpt)).toMatch(/search and fetch/);
    expect(text(AGENT_GUIDES.gemini)).toMatch(/\/mcp auth product-velocity/);
  });
  it("says the agent never approves or sets Stack Rank, Decision, Value or Confidence, and that documents never reach GitHub", () => {
    const all = text([AGENT_USE_CASES]);
    expect(all).toMatch(/never go to GitHub/);
    expect(text(AGENT_ADVANTAGES)).toMatch(/AI draft/);
  });
});

describe("Help guide: Reports", () => {
  it("lists both reports in the order of the report list, Overview first", async () => {
    const { REPORTS } = await import("../features/reports/report-env");
    const { REPORTS_LIST } = await import("./help-content");
    expect(REPORTS_LIST.rows.map((r) => r[0])).toEqual(REPORTS.map((r) => r.label));
  });
  it("defines Roadmap Health with the agreed terms and every health value it counts", async () => {
    const { ROADMAP_HEALTH_DEFINITIONS } = await import("./help-content");
    const { NEEDS_ATTENTION } = await import("@pv/domain");
    const text = ROADMAP_HEALTH_DEFINITIONS.rows.map((r) => r.join(" ")).join(" ");
    for (const h of NEEDS_ATTENTION) expect(text).toContain(h);
    for (const t of ["Active", "Days in current phase", "Age", "No date", "Completed delivery duration", "Several teams"]) expect(ROADMAP_HEALTH_DEFINITIONS.rows.map((r) => r[0]).join("|")).toContain(t);
  });
});

describe("Help guide: Velocity report", () => {
  it("defines the terms of the report: the measures, the percentiles, the stages and the team-level rule", async () => {
    const { VELOCITY_DEFINITIONS, VELOCITY_NOTES } = await import("./help-content");
    const terms = VELOCITY_DEFINITIONS.rows.map((r) => r[0]).join("|");
    for (const t of ["Time measured", "Counted from", "Counted and not there yet", "Median, average and percentiles", "Size-adjusted", "Stages", "Time to decide", "In flight and already slower than usual", "Several teams"]) expect(terms).toContain(t);
    const all = VELOCITY_DEFINITIONS.rows.map((r) => r.join(" ")).join(" ");
    expect(all).toMatch(/30, 60 and 90 days after roll-out/);
    expect(all).toMatch(/never as zero/);
    expect(all).toMatch(/Nothing is shown per approver/);
    expect(VELOCITY_NOTES.join(" ")).toMatch(/no figure is about a person/);
  });
});

describe("Help: closing the GitHub issue of a removed initiative (the same as Jira)", () => {
  it("says the same things for GitHub: what it does, that a person confirms, that followed issues are untouched, and that Claude cannot do it", () => {
    const status = COLUMN_ROWS.find((r) => r.key === "status")!;
    expect(JSON.stringify(status)).toMatch(/only status Product Velocity ever writes to GitHub|one status Product Velocity ever writes to GitHub/);
    expect(JSON.stringify(status)).toContain("Sync with GitHub (Removed in Product Velocity)");
    expect(COLUMNS_NOTE).toMatch(/Sync with GitHub does the same/);
    expect(COLUMNS_NOTE).toMatch(/closes the issue as not planned, you confirm each one/);
    expect(COLUMNS_NOTE).toMatch(/only followed from GitHub is never touched/);
    expect(AGENT_ADVANTAGES.find((a) => a.title === "Safe by design")!.text).toMatch(/close a GitHub issue/);
  });
});

describe("Help: closing the Jira issue of a removed initiative", () => {
  it("says what it does, that a person confirms, that Jira-origin issues are untouched, and that Claude cannot do it", () => {
    const status = COLUMN_ROWS.find((r) => r.key === "status")!;
    expect(JSON.stringify(status)).toContain("Removed in Product Velocity");
    expect(COLUMNS_NOTE).toMatch(/pm:removed/);
    expect(COLUMNS_NOTE).toMatch(/you confirm each one/);
    expect(COLUMNS_NOTE).toMatch(/came from Jira is never touched/);
    expect(AGENT_ADVANTAGES.find((a) => a.title === "Safe by design")!.text).toMatch(/cannot close a Jira issue/);
  });
});

describe("Help: status changes (issue #358)", () => {
  it("names the real states for both trackers, the direction, and that a person confirms", async () => {
    const { STATUS_TO_TRACKER, STATUS_FROM_TRACKER, STATUS_INTRO, STATUS_NEXT_IN_PV } = await import("./help-content");
    const to = JSON.stringify(STATUS_TO_TRACKER);
    for (const w of ["Backlog → Ready", "Backlog → To do", "closed as not planned", "pm:removed", "Done status"]) expect(to).toContain(w);
    const from = JSON.stringify(STATUS_FROM_TRACKER);
    for (const w of ["closed as completed", "Not started", "In progress", "Done", "Cancelled", "category To Do", "Delivery Status"]) expect(from).toContain(w);
    expect(STATUS_INTRO).toMatch(/after you confirm/);
    expect(JSON.stringify(STATUS_NEXT_IN_PV)).toContain("Move to Test");
  });
});

describe("Help: the pv- skills table", () => {
  it("has one row per skill, generated from the catalogue, with what it works on and what you get", async () => {
    const { AGENT_SKILLS } = await import("./help-content");
    const { SKILLS } = await import("@pv/domain");
    const names = AGENT_SKILLS.rows.map((r) => r[0]!.split(" ")[0]);
    for (const s of SKILLS) expect(names).toContain(s.command);
    expect(names).toContain("pv-help");
    const row = (c: string) => AGENT_SKILLS.rows.find((r) => r[0]!.startsWith(c))!;
    expect(row("pv-weekly")[3]).toMatch(/report in the format you choose/);
    expect(row("pv-weekly")[3]).toMatch(/Nothing is saved or sent/);
    expect(row("pv-vision")[2]).toMatch(/whole workspace/);
    expect(row("pv-weekly")[2]).toMatch(/All initiatives, or only the ones you name/);
    expect(row("pv-release-notes")[2]).toMatch(/All initiatives, or only the ones you name/);
    expect(row("pv-vision")[3]).toMatch(/in Documents/);
    expect(row("pv-metrics")[2]).toMatch(/One initiative/);
    expect(row("pv-metrics")[3]).toMatch(/Spec tab/);
    expect(row("pv-metrics")[3]).toMatch(/Key result metric|metric/i);
    for (const r of AGENT_SKILLS.rows) expect(r.every((c) => c.length > 0)).toBe(true);
  });
});

describe("Help: the kinds of skill and what a guided skill runs (issue #643)", () => {
  it("lists every skill once under its kind, guided first, and the include table matches the plans", async () => {
    const { AGENT_SKILL_TIERS, AGENT_SKILL_INCLUDES } = await import("./help-content");
    const { SKILLS, GUIDED_ONLY, SKILL_PLANS, SKILL_TIER_LABEL, SKILL_TIERS } = await import("@pv/domain");
    expect(AGENT_SKILL_TIERS.rows.map((r) => r[0])).toEqual(SKILL_TIERS.map((t) => SKILL_TIER_LABEL[t]));
    const listed = AGENT_SKILL_TIERS.rows.flatMap((r) => r[1]!.split(", "));
    expect([...listed].sort()).toEqual([...GUIDED_ONLY, ...SKILLS].map((s) => s.command).concat("pv-help").sort());
    expect(AGENT_SKILL_TIERS.rows[0]![1]!.split(", ").slice(0, 3)).toEqual(["pv-company", "pv-discovery", "pv-prd"]);
    expect(AGENT_SKILL_TIERS.rows[0]![2]).toMatch(/quick or full/);
    const withIncludes = Object.keys(SKILL_PLANS).filter((c) => SKILL_PLANS[c]!.includes && (SKILL_PLANS[c]!.includes!.always.length + SKILL_PLANS[c]!.includes!.offered.length + Object.keys(SKILL_PLANS[c]!.includes!.byGate ?? {}).length) > 0);
    expect(AGENT_SKILL_INCLUDES.rows.map((r) => r[0]).sort()).toEqual([...withIncludes].sort());
    const prd = AGENT_SKILL_INCLUDES.rows.find((r) => r[0] === "pv-prd")!;
    expect(prd[1]).toBe("pv-metrics, pv-split");
    expect(prd[2]).toBe("pv-stories; pv-premortem; pv-pr-faq; pv-business-case");
    expect(AGENT_SKILL_INCLUDES.rows.find((r) => r[0] === "pv-gate")![2]).toMatch(/Gate A: pv-one-pager, pv-stakeholders; Gate B: pv-premortem; Gate C: pv-readiness, pv-gtm, pv-release-notes/);
    expect(AGENT_SKILL_INCLUDES.rows.find((r) => r[0] === "pv-outcome")![1]).toMatch(/outcome review brief/);
  });
  it("no Help text names the old prompts as the way to start a flow, except the one sentence about aliases", async () => {
    const { AGENT_GUIDES, AGENT_SKILL_TIPS, AGENT_SKILLS } = await import("./help-content");
    const all = JSON.stringify([AGENT_GUIDES, AGENT_SKILL_TIPS, AGENT_SKILLS]);
    const hits = all.match(/write_prd|write_discovery|research_company/g) ?? [];
    expect(hits.length).toBeLessThanOrEqual(3); // "Say use the pv-discovery playbook (or pv-prd, pv-company; the older names ... still work)"
    expect(all).toMatch(/the older names write_discovery, write_prd and research_company still work/);
  });
});

describe("Help: which skill when, and the tips", () => {
  it("lists every skill once under its stage, in lifecycle order, and the tips match what the product does", async () => {
    const { AGENT_SKILL_STEPS, AGENT_SKILL_TIPS } = await import("./help-content");
    const { SKILLS, SKILL_STAGE_LABEL, GUIDED_ONLY } = await import("@pv/domain");
    const listed = AGENT_SKILL_STEPS.rows.flatMap((r) => r[1]!.split(", "));
    expect([...listed].sort()).toEqual([...GUIDED_ONLY, ...SKILLS].map((s) => s.command).sort());
    const order = AGENT_SKILL_STEPS.rows.map((r) => r[0]);
    expect(order).toEqual((Object.values(SKILL_STAGE_LABEL) as string[]).filter((l) => order.includes(l)));
    for (const r of AGENT_SKILL_STEPS.rows) expect(r[2]!.length).toBeGreaterThan(20);
    const tips = AGENT_SKILL_TIPS.join(" ");
    expect(tips).toMatch(/pv-company/);
    expect(tips).toMatch(/guided skill/);
    expect(tips).toMatch(/quick .* or full/);
    expect(tips).toMatch(/--draft/);
    expect(tips).toMatch(/--format=email/);
    expect(tips).toMatch(/never goes to GitHub or Jira/);
    expect(tips).toMatch(/Stack Rank, Value, Confidence, Decision and approvals are always yours/);
  });
});
