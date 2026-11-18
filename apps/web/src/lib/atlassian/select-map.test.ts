import { describe, expect, it } from "vitest";
import { FIELD_BY_KEY } from "@pv/domain";
import { SELECT_SLOTS, compareSelect, parseSelectMap, readSelectValue, selectChoices, selectsPayload, validateSelectMap, type SelectMap } from "./select-map";

// Issue #512: Health, Initiative Status and Initiative Phase mapped to custom select fields of the Jira issue that is the initiative.

const map = (over: Partial<SelectMap> = {}): SelectMap => ({
  "jira.select.health": { field: "customfield_10100", direction: "two_way", options: { "On Track": "201", "At Risk": "202", Delayed: "203", Blocked: "204" } },
  ...over,
});

describe("the closed list of select slots", () => {
  it("names only fields of the dictionary and uses their own allowed values", () => {
    expect(SELECT_SLOTS.map((s) => s.pvKey)).toEqual(["health", "initiative_status", "initiative_phase"]);
    for (const s of SELECT_SLOTS) expect(s.values).toEqual(FIELD_BY_KEY[s.pvKey]!.allowed);
  });
  it("Initiative Phase can only go to Jira: a phase move past a gate is the database's to refuse, so Jira never sets it", () => {
    const phase = SELECT_SLOTS.find((s) => s.pvKey === "initiative_phase")!;
    expect(phase.directions).toEqual(["to_jira"]);
    expect(SELECT_SLOTS.filter((s) => s.directions.includes("two_way")).map((s) => s.pvKey)).toEqual(["health", "initiative_status"]);
  });
  it("no commercial field is a select slot", () => {
    for (const s of SELECT_SLOTS) expect(["value_12m", "confidence", "decision", "cost_of_not_doing"]).not.toContain(s.pvKey);
  });
});

describe("parseSelectMap (what is stored is read defensively)", () => {
  it("keeps a well-formed mapping", () => { expect(parseSelectMap(map())).toEqual(map()); });
  it("drops a field id that is not a custom field, an option id that is not digits, and a value that is not an allowed value", () => {
    const m = parseSelectMap({ "jira.select.health": { field: "summary", direction: "to_jira", options: { "On Track": "201" } } });
    expect(m).toEqual({});
    const n = parseSelectMap({ "jira.select.health": { field: "customfield_10100", direction: "to_jira", options: { "On Track": "201", Bogus: "300", Delayed: "x1" } } });
    expect(n["jira.select.health"]!.options).toEqual({ "On Track": "201" });
  });
  it("forces Initiative Phase to to_jira whatever is stored", () => {
    const m = parseSelectMap({ "jira.select.initiative_phase": { field: "customfield_10101", direction: "two_way", options: { Build: "301" } } });
    expect(m["jira.select.initiative_phase"]!.direction).toBe("to_jira");
  });
  it("ignores a slot that is not on the list and a direction it does not know", () => {
    expect(parseSelectMap({ "jira.select.value_12m": { field: "customfield_10100", direction: "to_jira", options: {} } })).toEqual({});
    expect(parseSelectMap({ "jira.select.health": { field: "customfield_10100", direction: "sideways", options: { "On Track": "1" } } })).toEqual({});
    expect(parseSelectMap(null)).toEqual({});
    expect(parseSelectMap("x")).toEqual({});
  });
  it("two PV values on one Jira option keep the first for a two-way slot (the way back would be ambiguous)", () => {
    const m = parseSelectMap({ "jira.select.health": { field: "customfield_10100", direction: "two_way", options: { "On Track": "201", "At Risk": "201" } } });
    expect(m["jira.select.health"]!.options).toEqual({ "On Track": "201" });
  });
});

describe("validateSelectMap (the form)", () => {
  it("accepts a good mapping and says nothing", () => { expect(validateSelectMap(map(), new Map([["customfield_10100", ["201", "202", "203", "204"]]]))).toEqual([]); });
  it("refuses a Jira field the site does not have, and an option id the field does not have", () => {
    expect(validateSelectMap(map(), new Map())[0]).toMatch(/customfield_10100/);
    expect(validateSelectMap(map(), new Map([["customfield_10100", ["201"]]])).join(" ")).toMatch(/202/);
  });
  it("refuses one Jira field used by two PV fields", () => {
    const both = map({ "jira.select.initiative_status": { field: "customfield_10100", direction: "to_jira", options: { Active: "9" } } });
    expect(validateSelectMap(both, new Map([["customfield_10100", ["201", "202", "203", "204", "9"]]])).join(" ")).toMatch(/already used/i);
  });
});

describe("selectsPayload (Product Velocity to Jira)", () => {
  it("writes the mapped option id of the current value", () => {
    const r = selectsPayload({ health: "At Risk", initiative_status: "Active", initiative_phase: "Build" }, map());
    expect(r.fields).toEqual({ customfield_10100: { id: "202" } });
    expect(r.notes).toEqual([]);
  });
  it("leaves a value that has no option out and says so", () => {
    const r = selectsPayload({ health: "At Risk" }, map({ "jira.select.health": { field: "customfield_10100", direction: "to_jira", options: { "On Track": "201" } } }));
    expect(r.fields).toEqual({});
    expect(r.notes.join(" ")).toMatch(/Health not sent.*At Risk/);
  });
  it("sends nothing for an empty value (Jira's option is not cleared by an empty Product Velocity field)", () => {
    expect(selectsPayload({ health: null }, map()).fields).toEqual({});
  });
  it("sends nothing for a slot that is not mapped, and never a field that is not custom", () => {
    expect(selectsPayload({ health: "At Risk" }, {}).fields).toEqual({});
  });
  it("sends the phase when mapped", () => {
    const r = selectsPayload({ initiative_phase: "Test" }, { "jira.select.initiative_phase": { field: "customfield_10101", direction: "to_jira", options: { Test: "304" } } });
    expect(r.fields).toEqual({ customfield_10101: { id: "304" } });
  });
});

describe("readSelectValue (Jira to Product Velocity, only ever a proposal)", () => {
  const s = map()["jira.select.health"]!;
  it("finds the PV value by option id, then by option name", () => {
    expect(readSelectValue(s, { id: "203", value: "Late" })).toEqual({ kind: "value", value: "Delayed" });
    expect(readSelectValue(s, { id: "999", value: "Late" })).toEqual({ kind: "unmapped", name: "Late" });
  });
  it("an empty Jira field is empty, not a change to a value", () => { expect(readSelectValue(s, null)).toEqual({ kind: "empty" }); });
});

describe("compareSelect (three-way against what both sides agreed last)", () => {
  it("is none when nothing changed", () => { expect(compareSelect({ base: "On Track", pv: "On Track", jira: "On Track" })).toBe("none"); });
  it("is send when only Product Velocity changed", () => { expect(compareSelect({ base: "On Track", pv: "At Risk", jira: "On Track" })).toBe("send"); });
  it("is jira when only Jira changed: a proposal for a person, never applied silently", () => { expect(compareSelect({ base: "On Track", pv: "On Track", jira: "Blocked" })).toBe("jira"); });
  it("is both when both changed to different values, and none when they changed to the same value", () => {
    expect(compareSelect({ base: "On Track", pv: "At Risk", jira: "Blocked" })).toBe("both");
    expect(compareSelect({ base: "On Track", pv: "At Risk", jira: "At Risk" })).toBe("none");
  });
  it("with no base yet, equal values are none and different values are both (nothing is overwritten unseen)", () => {
    expect(compareSelect({ base: undefined, pv: "At Risk", jira: "At Risk" })).toBe("none");
    expect(compareSelect({ base: undefined, pv: "At Risk", jira: "Blocked" })).toBe("both");
  });
  it("a Jira value that maps to no PV value never counts as a change", () => { expect(compareSelect({ base: "On Track", pv: "On Track", jira: null })).toBe("none"); });
});

describe("selectChoices (the fields a person can pick)", () => {
  it("offers custom single-select fields only", () => {
    const fields = [
      { id: "customfield_10100", name: "Health", custom: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" } },
      { id: "customfield_10101", name: "Notes", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield" } },
      { id: "customfield_10102", name: "Teams", custom: true, schema: { type: "array", items: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:multiselect" } },
      { id: "status", name: "Status", custom: false, schema: { type: "status" } },
    ];
    expect(selectChoices(fields)).toEqual([{ id: "customfield_10100", name: "Health" }]);
  });
});
