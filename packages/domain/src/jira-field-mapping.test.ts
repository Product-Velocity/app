import { describe, expect, it } from "vitest";
import { FIELDS, FIELD_BY_KEY } from "./registry";
import {
  COMMERCIAL_FIELDS, JIRA_MAPPABLE_FIELDS, JIRA_TARGETS, PRIVATE_FIELDS, TRACKER_DRIVEN_FIELDS, pvFieldRefusal, suggestMapping, targetsForJira, validateJiraMapping,
  type JiraFieldRef,
} from "./jira-field-mapping";

const date: JiraFieldRef = { id: "customfield_10015", custom: true, kind: "date" };
const points: JiraFieldRef = { id: "customfield_10016", custom: true, kind: "number" };
const code = (r: ReturnType<typeof validateJiraMapping>) => (r.ok ? "ok" : r.code);

describe("the Jira mapping table", () => {
  it("only names fields of the dictionary, and every target is an editable, non-commercial, non-tracker field", () => {
    for (const t of JIRA_TARGETS) {
      const f = FIELD_BY_KEY[t.pv];
      expect(f, t.pv).toBeDefined();
      expect(f!.mode, t.pv).toBe("editable");
      expect(COMMERCIAL_FIELDS, t.pv).not.toContain(t.pv);
      expect(PRIVATE_FIELDS, t.pv).not.toContain(t.pv);
      expect(TRACKER_DRIVEN_FIELDS, t.pv).not.toContain(t.pv);
    }
    for (const k of [...COMMERCIAL_FIELDS, ...PRIVATE_FIELDS, ...TRACKER_DRIVEN_FIELDS]) expect(FIELD_BY_KEY[k], `${k} is not a dictionary field`).toBeDefined();
    expect(new Set(JIRA_MAPPABLE_FIELDS).size).toBe(JIRA_MAPPABLE_FIELDS.length);
  });

  it("refuses every commercial, private and tracker-driven field in both directions, for any Jira kind", () => {
    for (const k of [...COMMERCIAL_FIELDS, ...PRIVATE_FIELDS, ...TRACKER_DRIVEN_FIELDS, "initiative_status"]) {
      for (const kind of ["text", "number", "date", "select", "labels", "user", "other"]) {
        for (const d of ["read", "two_way"]) expect(validateJiraMapping({ id: "customfield_1", custom: true, kind }, k, d).ok, `${k} ${kind} ${d}`).toBe(false);
      }
    }
  });

  it("names the reason for each class of refusal", () => {
    expect(code(validateJiraMapping(date, "value_12m", "read"))).toBe("commercial");
    expect(code(validateJiraMapping(date, "confidence", "two_way"))).toBe("commercial");
    expect(code(validateJiraMapping(date, "customers_requesting", "read"))).toBe("commercial");
    expect(code(validateJiraMapping(date, "kr_target", "read"))).toBe("commercial");
    expect(code(validateJiraMapping(date, "stack_rank", "read"))).toBe("commercial");
    expect(code(validateJiraMapping(date, "decision", "read"))).toBe("commercial");
    expect(code(validateJiraMapping(date, "status", "read"))).toBe("tracker_driven");
    expect(code(validateJiraMapping(date, "delivery_progress_pct", "two_way"))).toBe("tracker_driven");
    expect(code(validateJiraMapping(date, "ci_status", "read"))).toBe("tracker_driven");
    expect(code(validateJiraMapping(date, "initiative_status", "read"))).toBe("status_people_only");
    expect(code(validateJiraMapping(date, "align_why", "read"))).toBe("private");
    expect(code(validateJiraMapping(date, "no_such_field", "read"))).toBe("unknown_pv_field");
    expect(code(validateJiraMapping(date, "item_code", "read"))).toBe("not_for_jira"); // system set
    expect(code(validateJiraMapping(date, "time_to_market_days", "read"))).toBe("not_for_jira"); // calculated
    expect(code(validateJiraMapping(date, "sponsor", "read"))).toBe("not_for_jira"); // editable but not offered
    expect(code(validateJiraMapping(date, "planned_start", "sideways"))).toBe("unknown_direction");
    expect(code(validateJiraMapping({ ...date, kind: "weird" }, "planned_start", "read"))).toBe("unknown_kind");
  });

  it("accepts compatible pairs and refuses incompatible ones with a clear reason", () => {
    expect(code(validateJiraMapping(date, "planned_start", "read"))).toBe("ok");
    expect(code(validateJiraMapping(date, "planned_start", "two_way"))).toBe("ok");
    expect(code(validateJiraMapping({ id: "duedate", custom: false, kind: "date" }, "g2m_date_est", "two_way"))).toBe("ok");
    expect(code(validateJiraMapping({ id: "labels", custom: false, kind: "labels" }, "tags", "read"))).toBe("ok");
    expect(code(validateJiraMapping({ id: "priority", custom: false, kind: "select" }, "moscow", "two_way"))).toBe("ok");
    expect(code(validateJiraMapping(points, "estimate_high_weeks", "read"))).toBe("ok");
    const bad = validateJiraMapping(points, "planned_start", "read");
    expect(bad.ok).toBe(false);
    if (!bad.ok) { expect(bad.code).toBe("incompatible"); expect(bad.reason).toMatch(/Planned Start takes a date/); expect(bad.reason).toMatch(/holds a number/); }
    expect(code(validateJiraMapping(points, "effort", "read"))).toBe("incompatible"); // points are not T-shirt sizes
    expect(code(validateJiraMapping(date, "tags", "read"))).toBe("incompatible");
    expect(code(validateJiraMapping({ id: "customfield_10001", custom: true, kind: "team" }, "contributing_teams", "read"))).toBe("ok");
    expect(code(validateJiraMapping({ id: "parent", custom: false, kind: "parent" }, "tags", "read"))).toBe("incompatible");
    expect(code(validateJiraMapping({ id: "customfield_10020", custom: true, kind: "sprint" }, "tags", "read"))).toBe("incompatible");
    expect(code(validateJiraMapping({ id: "customfield_10099", custom: true, kind: "other" }, "tags", "read"))).toBe("incompatible");
  });

  it("two-way needs a field PV sends and a Jira field that can be written", () => {
    expect(code(validateJiraMapping(points, "estimate_low_weeks", "two_way"))).toBe("two_way_not_allowed");
    expect(code(validateJiraMapping({ id: "labels", custom: false, kind: "labels" }, "tags", "two_way"))).toBe("two_way_not_allowed");
    expect(code(validateJiraMapping({ id: "assignee", custom: false, kind: "user" }, "assignees", "two_way"))).toBe("two_way_not_allowed");
    expect(code(validateJiraMapping({ id: "created", custom: false, kind: "datetime" }, "planned_start", "two_way"))).toBe("jira_read_only");
    expect(code(validateJiraMapping({ id: "updated", custom: false, kind: "datetime" }, "planned_start", "read"))).toBe("ok");
    expect(code(validateJiraMapping({ id: "startdate", custom: false, kind: "date" }, "planned_start", "two_way"))).toBe("jira_read_only"); // an unknown system field
  });

  it("never maps a Jira status or resolution, in any pair", () => {
    for (const id of ["status", "statuscategory", "resolution"]) for (const pv of JIRA_MAPPABLE_FIELDS) for (const d of ["read", "two_way"]) {
      for (const kind of ["select", "text", "date"]) expect(validateJiraMapping({ id, custom: false, kind }, pv, d).ok, `${id} ${pv}`).toBe(false);
    }
    expect(targetsForJira({ id: "status", custom: false, kind: "select" })).toEqual([]);
  });

  it("every dictionary field gets a verdict, and exactly the targets are allowed for some kind", () => {
    const allowedSomewhere = FIELDS.filter((f) => ["text", "number", "date", "datetime", "select", "multi-select", "user", "users", "labels", "sprint", "link", "team", "parent", "other"].some(
      (kind) => validateJiraMapping({ id: "customfield_1", custom: true, kind }, f.key, "read").ok,
    )).map((f) => f.key).sort();
    expect(allowedSomewhere).toEqual([...JIRA_MAPPABLE_FIELDS].sort());
    expect(pvFieldRefusal("moscow").ok).toBe(true);
  });

  it("lists the PV fields a Jira field can map to, with directions", () => {
    const t = targetsForJira(date);
    expect(t.map((x) => x.pv).sort()).toEqual(["g2m_date_est", "planned_start"]);
    expect(t.find((x) => x.pv === "planned_start")!.directions).toEqual(["read", "two_way"]);
    expect(targetsForJira({ id: "assignee", custom: false, kind: "user" })).toEqual([{ pv: "assignees", directions: ["read"] }]);
  });

  it("suggests from role hints, never for story points, and only pairs that validate", () => {
    expect(suggestMapping({ ...date, role: "start_date" })).toEqual({ pv: "planned_start", direction: "read" });
    expect(suggestMapping({ ...points, role: "story_points" })).toBeNull();
    expect(suggestMapping({ id: "customfield_10001", custom: true, kind: "team", role: "team" })).toEqual({ pv: "contributing_teams", direction: "read" });
    expect(suggestMapping({ ...date, role: null })).toBeNull();
    expect(suggestMapping({ ...points, role: "start_date" })).toBeNull(); // a hint on a wrong kind is dropped
  });
});

describe("fields Sync already keeps in step", () => {
  it("the summary and description are never mapped", () => {
    for (const id of ["summary", "description"]) for (const pv of JIRA_MAPPABLE_FIELDS) expect(validateJiraMapping({ id, custom: false, kind: "text" }, pv, "read").ok, `${id} ${pv}`).toBe(false);
  });
});
