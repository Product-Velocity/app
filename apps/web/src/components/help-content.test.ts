import { describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY } from "@pv/domain";
import { COLUMN_GROUPS, COLUMN_ROWS, OVERRIDE_KEYS, UPDATE_OVERRIDE_KEYS, accessLabel } from "./help-content";

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
