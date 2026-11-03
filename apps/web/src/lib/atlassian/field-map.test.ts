import { describe, expect, it } from "vitest";
import { fieldMapFromForm, parseFieldMap, priorityChoices, proposePriorities, startDateChoices, themeChoices } from "./field-map";

describe("field map", () => {
  it("parses a stored mapping and drops anything malformed", () => {
    expect(parseFieldMap({ startDate: "customfield_10015", priorityByMoscow: { Must: "1", Could: "x", Maybe: "2" }, summary: "x" })).toEqual({ startDate: "customfield_10015", priorityByMoscow: { Must: "1" } });
    expect(parseFieldMap({ startDate: "duedate" })).toEqual({});
    expect(parseFieldMap(null)).toEqual({});
    expect(parseFieldMap("x")).toEqual({});
  });
  it("builds the map from the form; empty choices stay unmapped", () => {
    const form: Record<string, string> = { startDate: "customfield_10015", priority_Must: "1", priority_Should: "", "priority_Won't": "5" };
    expect(fieldMapFromForm((k) => form[k] ?? "")).toEqual({ startDate: "customfield_10015", priorityByMoscow: { Must: "1", "Won't": "5" } });
    expect(fieldMapFromForm(() => "")).toEqual({});
  });
  it("offers custom date fields for the start date, the one named Start date first", () => {
    const fields = [
      { id: "customfield_10020", name: "Go-live", custom: true, schema: { type: "date", custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker" } },
      { id: "customfield_10015", name: "Start date", custom: true, schema: { type: "date", custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker" } },
      { id: "duedate", name: "Due date", custom: false, schema: { type: "date", system: "duedate" } },
      { id: "customfield_10030", name: "Notes", custom: true, schema: { type: "string", custom: "x:textfield" } },
    ];
    expect(startDateChoices(fields).map((f) => f.id)).toEqual(["customfield_10015", "customfield_10020"]);
  });
  it("parses and reads the theme field, dropping a malformed id", () => {
    expect(parseFieldMap({ theme: "customfield_10030" })).toEqual({ theme: "customfield_10030" });
    expect(parseFieldMap({ theme: "summary" })).toEqual({});
    expect(fieldMapFromForm((k) => (k === "theme" ? "customfield_10030" : ""))).toEqual({ theme: "customfield_10030" });
  });
  it("offers only custom single-line text fields for the Theme, the one named Theme first; no selects, paragraphs, dates or system fields", () => {
    const t = (id: string, name: string, custom: string, type = "string", isCustom = true) => ({ id, name, custom: isCustom, schema: { type, custom } });
    const fields = [
      t("customfield_10031", "Release note", "com.atlassian.jira.plugin.system.customfieldtypes:textfield"),
      t("customfield_10030", "Theme", "com.atlassian.jira.plugin.system.customfieldtypes:textfield"),
      t("customfield_10032", "Theme (list)", "com.atlassian.jira.plugin.system.customfieldtypes:select", "option"),
      t("customfield_10033", "Details", "com.atlassian.jira.plugin.system.customfieldtypes:textarea"),
      t("customfield_10034", "Start", "com.atlassian.jira.plugin.system.customfieldtypes:datepicker", "date"),
      { id: "summary", name: "Summary", custom: false, schema: { type: "string", system: "summary" } },
    ];
    expect(themeChoices(fields).map((f) => f.id)).toEqual(["customfield_10030", "customfield_10031"]);
  });
  it("reads the site's priorities and proposes highest to Must and lowest to Won't only when there are at least four", () => {
    const c = priorityChoices([{ id: "1", name: "Highest" }, { id: "2", name: "High" }, { id: "3", name: "Medium" }, { id: "4", name: "Low" }, { id: "5", name: "Lowest" }, { id: "x", name: "Bad" }, 7]);
    expect(c.map((p) => p.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(proposePriorities(c)).toEqual({ Must: "1", Should: "2", Could: "3", "Won't": "5" });
    expect(proposePriorities(c.slice(0, 3))).toEqual({});
  });
});
