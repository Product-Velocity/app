import { describe, expect, it } from "vitest";
import { bulkEditReason, canBeEmpty, canEditItems, EDITABLE_FIELDS, fieldLabel, fieldMaxLength, openListValues, optionsFor, readOnlyReason, validateEdit } from "./fields";
import { FIELDS, FIELD_BY_KEY, isOpenList } from "./registry";

const today = new Date(Date.UTC(2027, 0, 1));

describe("who can edit", () => {
  it("only creators and admins", () => {
    expect([canEditItems("creator"), canEditItems("admin")]).toEqual([true, true]);
    for (const r of ["viewer", "commenter", "leadership", "nobody", null, undefined]) expect(canEditItems(r as string)).toBe(false);
  });
});

describe("which cells can be edited follows the dictionary", () => {
  it("only fields the dictionary calls Editable, from a shipped phase, are editable in the grid", () => {
    for (const k of EDITABLE_FIELDS) {
      const f = FIELD_BY_KEY[k]!;
      expect(f.mode, k).toBe("editable");
      expect(f.phase, k).toBeLessThanOrEqual(1);
    }
    expect(EDITABLE_FIELDS).toEqual(expect.arrayContaining(["initiative_name", "home_project", "moscow", "effort", "health", "value_12m", "confidence", "start_date", "g2m_date_est", "decision"]));
  });
  it("never lets a person edit locked, computed or system fields, or fields of later phases", () => {
    for (const f of FIELDS.filter((x) => x.mode !== "editable" || x.phase > 1)) {
      expect(EDITABLE_FIELDS, f.key).not.toContain(f.key);
      if (f.key !== "stack_rank") expect(validateEdit(f.key, "x").ok, f.key).toBe(false);
    }
  });
  it("explains why a cell is read-only", () => {
    expect(readOnlyReason("status")).toMatch(/comes from GitHub/);
    expect(readOnlyReason("delivery_progress_pct")).toMatch(/comes from GitHub/);
    expect(readOnlyReason("value_weighted")).toMatch(/calculated/);
    expect(readOnlyReason("item_code")).toMatch(/set by the system/);
    expect(readOnlyReason("outcome_verdict")).toBe("Outcome Verdict arrives in phase 7.");
    expect(readOnlyReason("tags")).toMatch(/item panel/);
    expect(readOnlyReason("moscow")).toBeNull();
    expect(readOnlyReason("stack_rank")).toBeNull();
  });
  it("every editable field has a label", () => {
    for (const f of EDITABLE_FIELDS) expect(fieldLabel(f)).toBeTruthy();
  });
});

describe("bulk edit rules", () => {
  it("rejects GitHub-driven, calculated, system, later-phase and rank fields with a reason; allows editable ones", () => {
    expect(bulkEditReason("status")).toMatch(/comes from GitHub/);
    expect(bulkEditReason("delivery_progress_pct")).toMatch(/comes from GitHub/);
    expect(bulkEditReason("value_weighted")).toMatch(/calculated/);
    expect(bulkEditReason("item_code")).toMatch(/set by the system/);
    expect(bulkEditReason("outcome_verdict")).toMatch(/arrives in phase 7/);
    expect(bulkEditReason("stack_rank")).toMatch(/one item at a time/);
    expect(bulkEditReason("effort")).toBeNull();
    expect(bulkEditReason("moscow")).toBeNull();
  });
  it("every field in the dictionary is either bulk-editable or has a reason", () => {
    for (const f of FIELDS) expect(bulkEditReason(f.key) === null, f.key).toBe(EDITABLE_FIELDS.includes(f.key));
  });
});

describe("options carry text labels", () => {
  it("come straight from the dictionary", () => {
    expect(optionsFor("moscow").map((o) => o.label)).toEqual(["Must", "Should", "Could", "Won't"]);
    expect(optionsFor("effort").map((o) => o.value)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(optionsFor("health").map((o) => o.label)).toEqual(["On Track", "At Risk", "Delayed", "Blocked"]);
    expect(optionsFor("confidence").map((o) => o.label)).toEqual(["High", "Medium", "Low"]);
    expect(optionsFor("archived").map((o) => o.label)).toEqual(["Yes", "No"]);
    expect(optionsFor("initiative_name")).toEqual([]);
  });
});

describe("validateEdit", () => {
  it("initiative name: required, trimmed, at most 300 characters", () => {
    expect(validateEdit("initiative_name", "  Hello  ")).toEqual({ ok: true, value: "Hello" });
    expect(validateEdit("initiative_name", "   ").ok).toBe(false);
    expect(validateEdit("initiative_name", "x".repeat(301)).ok).toBe(false);
  });
  it("selects accept only their values (any capitalisation), or empty", () => {
    expect(validateEdit("moscow", "must")).toEqual({ ok: true, value: "Must" });
    expect(validateEdit("moscow", "won't")).toEqual({ ok: true, value: "Won't" });
    expect(validateEdit("moscow", "")).toEqual({ ok: true, value: null });
    expect(validateEdit("moscow", "maybe").ok).toBe(false);
    expect(validateEdit("effort", "XXL").ok).toBe(false);
    expect(validateEdit("health", "blocked")).toEqual({ ok: true, value: "Blocked" });
    expect(validateEdit("confidence", "Medium")).toEqual({ ok: true, value: "Medium" });
    expect(validateEdit("confidence", "70").ok).toBe(false);
  });
  it("a select without a fixed list (initiative group) takes free text up to 120 characters", () => {
    expect(validateEdit("theme", " Marketplace ")).toEqual({ ok: true, value: "Marketplace" });
    expect(validateEdit("theme", "x".repeat(121)).ok).toBe(false);
  });
  it("project is required, people may be empty", () => {
    expect(validateEdit("home_project", "").ok).toBe(false);
    expect(validateEdit("home_project", "p1")).toEqual({ ok: true, value: "p1" });
    expect(validateEdit("product_manager", "")).toEqual({ ok: true, value: null });
    expect(validateEdit("sponsor", "u1")).toEqual({ ok: true, value: "u1" });
  });
  it("columns that cannot be empty say so", () => {
    expect(canBeEmpty("visibility")).toBe(false);
    expect(validateEdit("visibility", "").ok).toBe(false);
    expect(canBeEmpty("moscow")).toBe(true);
  });
  it("value and dates use their own parsers", () => {
    expect(validateEdit("value_12m", "120k", { today })).toEqual({ ok: true, value: 120000 });
    expect(validateEdit("start_date", "31 mar", { today })).toEqual({ ok: true, value: "2027-03-31" });
    expect(validateEdit("g2m_date_est", "q1", { today })).toEqual({ ok: true, value: "2027-03-31" });
    expect(validateEdit("planned_start", "q1", { today })).toEqual({ ok: true, value: "2027-01-01" });
    expect(validateEdit("next_review_date", "banana", { today }).ok).toBe(false);
  });
  it("numbers: plain, non-negative where the database requires it, whole where it counts things", () => {
    expect(validateEdit("kr_target", "1,250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(validateEdit("kr_start", "-3")).toEqual({ ok: true, value: -3 });
    expect(validateEdit("estimate_high_weeks", "-1").ok).toBe(false);
    expect(validateEdit("customers_requesting", "2.5").ok).toBe(false);
    expect(validateEdit("customers_requesting", "12")).toEqual({ ok: true, value: 12 });
    expect(validateEdit("kr_target", "abc").ok).toBe(false);
  });
  it("yes/no, text and long text", () => {
    expect(validateEdit("archived", "yes")).toEqual({ ok: true, value: true });
    expect(validateEdit("archived", "No")).toEqual({ ok: true, value: false });
    expect(validateEdit("archived", "maybe").ok).toBe(false);
    expect(validateEdit("hypothesis", "We believe...")).toEqual({ ok: true, value: "We believe..." });
    expect(validateEdit("hypothesis", "x".repeat(8001)).ok).toBe(false);
    expect(validateEdit("kr_metric", "x".repeat(2001)).ok).toBe(false);
    expect(validateEdit("summary", "x".repeat(4001)).ok).toBe(false);
  });
  it("rejects an unknown or locked field", () => {
    expect(validateEdit("nope", "x").ok).toBe(false);
    expect(validateEdit("status", "closed").ok).toBe(false);
  });
});

describe("open lists: Focus Area and Audience (issue #246)", () => {
  it("are selects with no fixed values, like Initiative Group", () => {
    for (const k of ["focus_area", "audience"]) {
      expect(FIELD_BY_KEY[k]!.type).toBe("Select");
      expect(FIELD_BY_KEY[k]!.allowed).toEqual([]);
      expect(isOpenList(k)).toBe(true);
    }
    expect(isOpenList("moscow")).toBe(false);
    expect(isOpenList("theme")).toBe(false); // Initiative Group keeps its own table of names
  });

  it("accept any text, one spelling (no double spaces), up to 120 characters", () => {
    expect(validateEdit("focus_area", "  Customer   loyalty ")).toEqual({ ok: true, value: "Customer loyalty" });
    expect(validateEdit("audience", "Brands and agencies")).toEqual({ ok: true, value: "Brands and agencies" });
    expect(validateEdit("audience", "x".repeat(121))).toMatchObject({ ok: false, error: expect.stringMatching(/120/) });
    expect(validateEdit("focus_area", "")).toEqual({ ok: true, value: null });
  });

  it("offer the values in use, once each (any case), A to Z, never an empty one", () => {
    const inUse = ["Pricing", "loyalty", "Pricing", "pricing ", "", null, undefined, 4, "Loyalty"];
    expect(optionsFor("focus_area", inUse)).toEqual([{ value: "loyalty", label: "loyalty" }, { value: "Pricing", label: "Pricing" }]);
    expect(optionsFor("audience")).toEqual([]);
    expect(openListValues(["b", "A", "a"])).toEqual(["A", "b"]);
  });

  it("are written like Initiative Group is: a text with a limit, no list of allowed values", () => {
    expect(fieldMaxLength("focus_area")).toBe(120);
    expect(fieldMaxLength("audience")).toBe(120);
  });
});
