import { describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY } from "@pv/domain";
import { AGENT_ADVANTAGES, AGENT_GUIDES, AGENT_TABS, AGENT_USE_CASES, COLUMN_GROUPS, COLUMN_ROWS, OVERRIDE_KEYS, UPDATE_OVERRIDE_KEYS, accessLabel } from "./help-content";

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
    expect(row("description").updated).toBe("You edit it · Manual sync (Sync with GitHub)");
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
  });
  it("names the exact GitHub source of what the app reads", () => {
    expect(row("status").github).toMatch(/^Read from issue state/);
    expect(row("ci_status").github).toMatch(/default branch/);
    expect(row("gh_project_status").github).toMatch(/field Status/);
  });
  it("does not claim a send that is not built", () => {
    for (const k of ["roadmap_category", "focus_area", "tags", "planned_start"]) {
      expect(row(k).github, k).toMatch(/Not sent yet/);
      expect(row(k).updated, k).toBe("You edit it");
    }
  });
  it("gives a Jira target for every column the app sends", () => {
    for (const r of COLUMN_ROWS.filter((x) => x.github.startsWith("Sent to"))) expect(r.jira, r.key).toMatch(/^Sent to /);
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
