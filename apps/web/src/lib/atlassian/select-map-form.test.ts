import { describe, expect, it } from "vitest";
import { SEL_DIR, SEL_FIELD, SEL_OPT, selectMapFromForm, selectRows } from "./select-map-form";
import { parseCreateMeta } from "./select-map";

const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";

describe("selectMapFromForm", () => {
  it("builds one config per slot with a field; an empty field leaves the slot unmapped", () => {
    const m = selectMapFromForm(form({ [SEL_FIELD("jira.select.health")]: "customfield_10100", [SEL_DIR("jira.select.health")]: "two_way", [SEL_OPT("jira.select.health", "On Track")]: "201", [SEL_OPT("jira.select.health", "At Risk")]: "" }));
    expect(m).toEqual({ "jira.select.health": { field: "customfield_10100", direction: "two_way", options: { "On Track": "201" } } });
    expect(selectRows(m)).toEqual([{ slot: "jira.select.health", field: "customfield_10100", direction: "two_way", options: { "On Track": "201" } }]);
    expect(selectMapFromForm(form({}))).toEqual({});
  });
  it("Initiative Phase is always to Jira, even if the form says two_way", () => {
    const m = selectMapFromForm(form({ [SEL_FIELD("jira.select.initiative_phase")]: "customfield_10102", [SEL_DIR("jira.select.initiative_phase")]: "two_way", [SEL_OPT("jira.select.initiative_phase", "Build")]: "221" }));
    expect(m["jira.select.initiative_phase"]!.direction).toBe("to_jira");
  });
  it("a hostile field name or option id is dropped", () => {
    expect(selectMapFromForm(form({ [SEL_FIELD("jira.select.health")]: "summary", [SEL_DIR("jira.select.health")]: "to_jira" }))).toEqual({});
    const m = selectMapFromForm(form({ [SEL_FIELD("jira.select.health")]: "customfield_1", [SEL_OPT("jira.select.health", "On Track")]: "1; drop" }));
    expect(m["jira.select.health"]!.options).toEqual({});
  });
});

describe("parseCreateMeta", () => {
  const sel = { fieldId: "customfield_10100", name: "Health", schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" }, allowedValues: [{ id: "201", value: "On Track" }, { id: "202", value: "Old", disabled: true }, { id: "x", value: "Bad" }] };
  it("returns the single-select custom fields of the create screen with their enabled options", () => {
    const r = parseCreateMeta({ fields: [sel, { fieldId: "summary", name: "Summary", schema: { type: "string" } }, { fieldId: "customfield_10101", name: "Notes", schema: { type: "string", custom: "x:textfield" } }, { fieldId: "customfield_10102", name: "Radio", schema: { type: "option", custom: "x:radiobuttons" }, allowedValues: [] }] });
    expect(r).toEqual([{ id: "customfield_10100", name: "Health", options: [{ id: "201", value: "On Track" }] }]);
  });
  it("also reads the paged shape (values) and survives rubbish", () => {
    expect(parseCreateMeta({ values: [sel] })[0]!.id).toBe("customfield_10100");
    expect(parseCreateMeta(null)).toEqual([]);
    expect(parseCreateMeta({ fields: "x" })).toEqual([]);
  });
});
