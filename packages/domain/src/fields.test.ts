import { describe, expect, it } from "vitest";
import {
  canEditItems, EDITABLE_FIELDS, FIELD_LABEL, HEALTH_OPTIONS, LOCKED_FIELDS, MOSCOW_OPTIONS, optionLabel, SIZE_OPTIONS, validateEdit,
} from "./fields";

describe("who can edit", () => {
  it("only creators and admins", () => {
    expect([canEditItems("creator"), canEditItems("admin")]).toEqual([true, true]);
    for (const r of ["viewer", "commenter", "leadership", "nobody", null, undefined]) expect(canEditItems(r as string)).toBe(false);
  });
});

describe("locked and editable fields", () => {
  it("GitHub-driven fields are locked with a reason, and are never in the editable list", () => {
    expect(Object.keys(LOCKED_FIELDS).sort()).toEqual(["delivery_progress", "status"]);
    for (const reason of Object.values(LOCKED_FIELDS)) expect(reason).toMatch(/GitHub/);
    for (const f of Object.keys(LOCKED_FIELDS)) expect(EDITABLE_FIELDS).not.toContain(f);
  });
  it("every editable field has a label", () => {
    for (const f of EDITABLE_FIELDS) expect(FIELD_LABEL[f]).toBeTruthy();
  });
});

describe("options carry text labels", () => {
  it("MoSCoW, size and health", () => {
    expect(MOSCOW_OPTIONS.map((o) => o.label)).toEqual(["Must", "Should", "Could", "Won't"]);
    expect(SIZE_OPTIONS.map((o) => o.value)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(HEALTH_OPTIONS.map((o) => o.label)).toEqual(["On track", "At risk", "Delayed"]);
    expect(optionLabel("health", "at_risk")).toBe("At risk");
    expect(optionLabel("moscow", "wont")).toBe("Won't");
    expect(optionLabel("moscow", null)).toBe("");
  });
});

describe("validateEdit", () => {
  it("title: required, trimmed, at most 300 characters", () => {
    expect(validateEdit("title", "  Hello  ")).toEqual({ ok: true, value: "Hello" });
    expect(validateEdit("title", "   ").ok).toBe(false);
    expect(validateEdit("title", "x".repeat(301)).ok).toBe(false);
  });
  it("confidence: a whole number 0 to 100, empty clears", () => {
    expect(validateEdit("confidence", "70")).toEqual({ ok: true, value: 70 });
    expect(validateEdit("confidence", "70%")).toEqual({ ok: true, value: 70 });
    expect(validateEdit("confidence", "")).toEqual({ ok: true, value: null });
    for (const bad of ["101", "-1", "7.5", "abc"]) expect(validateEdit("confidence", bad).ok).toBe(false);
  });
  it("enumerations accept only their values (or empty)", () => {
    expect(validateEdit("moscow", "must")).toEqual({ ok: true, value: "must" });
    expect(validateEdit("moscow", "")).toEqual({ ok: true, value: null });
    expect(validateEdit("moscow", "maybe").ok).toBe(false);
    expect(validateEdit("size", "XXL").ok).toBe(false);
    expect(validateEdit("health", "at_risk").ok).toBe(true);
  });
  it("project is required, owner may be empty", () => {
    expect(validateEdit("home_project_id", "").ok).toBe(false);
    expect(validateEdit("home_project_id", "p1")).toEqual({ ok: true, value: "p1" });
    expect(validateEdit("owner_user_id", "")).toEqual({ ok: true, value: null });
  });
  it("value and dates use their own parsers", () => {
    expect(validateEdit("value", "120k", { today: new Date(Date.UTC(2027, 0, 1)) })).toEqual({ ok: true, value: 120000 });
    expect(validateEdit("start_date", "31 mar", { today: new Date(Date.UTC(2027, 0, 1)) })).toEqual({ ok: true, value: "2027-03-31" });
    expect(validateEdit("end_date", "q1", { today: new Date(Date.UTC(2027, 0, 1)) })).toEqual({ ok: true, value: "2027-03-31" });
  });
  it("rejects an unknown field", () => {
    expect(validateEdit("status" as never, "closed").ok).toBe(false);
  });
});
