import { describe, expect, it } from "vitest";
import { cleanRelated, cleanSkills, RELATED_FIELDS } from "./related";

const ctx = { itemId: "i1", itemIds: ["i1", "i2", "i3"], teamIds: ["t1", "t2"] };

describe("cleanRelated: tags", () => {
  it("trims, collapses spaces, drops blanks and duplicates (ignoring case), keeps the first spelling", () => {
    expect(cleanRelated("tags", ["  Urgent ", "urgent", "", "Q3   plan"], ctx)).toEqual({ ok: true, value: ["Urgent", "Q3 plan"] });
  });
  it("refuses a tag over 80 characters and more than 50 tags", () => {
    expect(cleanRelated("tags", ["x".repeat(81)], ctx)).toEqual({ ok: false, error: "Keep each tag under 80 characters." });
    expect(cleanRelated("tags", Array.from({ length: 51 }, (_, i) => `t${i}`), ctx)).toEqual({ ok: false, error: "At most 50 entries." });
  });
  it("applies to target segments and markets too", () => {
    for (const k of ["target_scope", "live_scope", "target_segments"] as const) expect(cleanRelated(k, [" EU "], ctx)).toEqual({ ok: true, value: ["EU"] });
  });
});

describe("cleanRelated: links", () => {
  it("needs an http(s) address, keeps an optional label, drops duplicates", () => {
    expect(cleanRelated("artifacts", [{ label: " PRD ", url: " https://x.test/prd " }, { label: "", url: "https://x.test/prd" }, { label: " PRD ", url: "https://x.test/prd" }], ctx))
      .toEqual({ ok: true, value: [{ label: "PRD", url: "https://x.test/prd" }, { label: "", url: "https://x.test/prd" }] });
    expect(cleanRelated("artifacts", [{ label: "x", url: "javascript:alert(1)" }], ctx)).toEqual({ ok: false, error: "A link must start with http:// or https://." });
    expect(cleanRelated("artifacts", [{ label: "x".repeat(201), url: "https://x.test" }], ctx)).toEqual({ ok: false, error: "Keep a link label under 200 characters." });
  });
});

describe("cleanRelated: relations and teams", () => {
  it("only other initiatives of the workspace, no self-reference, no duplicates", () => {
    expect(cleanRelated("depends_on", ["i2", "i2", "i3"], ctx)).toEqual({ ok: true, value: ["i2", "i3"] });
    expect(cleanRelated("related_to", ["i1"], ctx)).toEqual({ ok: false, error: "An initiative cannot refer to itself." });
    expect(cleanRelated("depends_on", ["zz"], ctx)).toEqual({ ok: false, error: "That initiative does not exist." });
  });
  it("only teams of the workspace", () => {
    expect(cleanRelated("contributing_teams", ["t1", "t1"], ctx)).toEqual({ ok: true, value: ["t1"] });
    expect(cleanRelated("contributing_teams", ["t9"], ctx)).toEqual({ ok: false, error: "That team does not exist." });
  });
  it("knows its fields", () => {
    expect([...RELATED_FIELDS].sort()).toEqual(["artifacts", "contributing_teams", "depends_on", "live_scope", "related_to", "tags", "target_scope", "target_segments"]);
  });
});

describe("cleanSkills", () => {
  it("person-weeks per skill: names trimmed, numbers 0 to 999, empty skills dropped", () => {
    expect(cleanSkills({ " backend ": 4, frontend: "2.5", data: 0, "": 3 })).toEqual({ ok: true, value: { backend: 4, frontend: 2.5 } });
    expect(cleanSkills({})).toEqual({ ok: true, value: null });
    expect(cleanSkills(null)).toEqual({ ok: true, value: null });
  });
  it("explains a bad number or name", () => {
    expect(cleanSkills({ backend: "lots" })).toEqual({ ok: false, error: "Person-weeks for backend must be a number." });
    expect(cleanSkills({ backend: -1 })).toEqual({ ok: false, error: "Person-weeks for backend must be between 0 and 999." });
    expect(cleanSkills({ ["x".repeat(41)]: 1 })).toEqual({ ok: false, error: "Keep a skill name under 40 characters." });
  });
});
