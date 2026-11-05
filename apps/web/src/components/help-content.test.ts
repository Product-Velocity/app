import { describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY } from "@pv/domain";
import { AGENT_ADVANTAGES, AGENT_GUIDES, AGENT_TABS, AGENT_USE_CASES, COLUMNS_NOTE, COLUMN_GROUPS, COLUMN_ROWS, OVERRIDE_KEYS, UPDATE_OVERRIDE_KEYS, accessLabel } from "./help-content";

describe("Help guide columns table", () => {
  it("has exactly one row for every column in the field dictionary, in its order", () => {
    expect(COLUMN_ROWS.map((r) => r.key)).toEqual(FIELDS.map((f) => f.key));
    expect(COLUMN_ROWS.length).toBe(170);
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
    for (const f of FIELDS) {
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
    expect(row("moscow").github).toMatch(/pv:moscow\//);
    expect(row("moscow").github).toMatch(/Priority/);
    expect(row("stack_rank").github).toMatch(/pv:rank\//);
    expect(row("effort").github).toMatch(/Size/);
    expect(row("g2m_date_est").github).toMatch(/milestone/);
    expect(row("theme").github).toMatch(/pv:group\//);
    expect(row("theme").jira).toMatch(/pv:group\/.*Theme/);
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
    // issue #321: the three optional labels are built, off by default, and the Help says where to switch them on
    for (const k of ["roadmap_category", "focus_area", "tags"]) {
      expect(row(k).github, k).toMatch(/^Sent to label pv:|^Sent to one label pv:/i);
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
    expect(sent("moscow")).toMatch(/Label pv:moscow/);
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
    expect(AGENT_USE_CASES.rows.map((r) => r[0])).toEqual(["Brainstorm", "Create", "Review", "Update"]);
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
    expect(text(AGENT_GUIDES.claude)).toMatch(/\/mcp__product-velocity__write_discovery/);
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
    expect(COLUMNS_NOTE).toMatch(/pv:removed/);
    expect(COLUMNS_NOTE).toMatch(/you confirm each one/);
    expect(COLUMNS_NOTE).toMatch(/came from Jira is never touched/);
    expect(AGENT_ADVANTAGES.find((a) => a.title === "Safe by design")!.text).toMatch(/cannot close a Jira issue/);
  });
});
