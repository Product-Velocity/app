import { describe, expect, it } from "vitest";
import type { ChangeRowView, StaticRowView } from "./view";
import { changeFlags, filterCounts, flagMatches, isSyncedNow, staticFlags, textMatches } from "./workbench";

const change = (control: ChangeRowView["control"], direction: ChangeRowView["direction"] = "to_tracker"): ChangeRowView => ({ id: "x", key: "k", label: "L", direction, target: "t", control, isDefault: true });
const fixed = (direction: StaticRowView["direction"]): StaticRowView => ({ key: "k", label: "L", direction, target: "t", reason: "r" });

describe("field table filters", () => {
  it("counts a switched-off toggle and an unmapped select as not synced, a default due date as synced", () => {
    expect(isSyncedNow(change({ type: "toggle", on: true }))).toBe(true);
    expect(isSyncedNow(change({ type: "toggle", on: false }))).toBe(false);
    expect(isSyncedNow(change({ type: "select", value: "", blank: "Not mapped (not sent)", options: [] }))).toBe(false);
    expect(isSyncedNow(change({ type: "select", value: "customfield_1", blank: "Not mapped (not sent)", options: [] }))).toBe(true);
    expect(isSyncedNow(change({ type: "select", value: "", blank: "Default: Due date", options: [] }))).toBe(true);
    expect(isSyncedNow(change({ type: "select", value: "__off", blank: "Default: Due date", options: [] }))).toBe(false);
    expect(isSyncedNow(change({ type: "priority", values: {}, options: [], proposal: {} }))).toBe(false);
    expect(isSyncedNow(change({ type: "priority", values: { Must: "1" }, options: [], proposal: {} }))).toBe(true);
  });
  it("a changeable row is in 'can change' and either 'synced' or 'not synced', never both", () => {
    const on = changeFlags(change({ type: "toggle", on: true }));
    const off = changeFlags(change({ type: "toggle", on: false }));
    expect(on).toMatchObject({ changeable: true, synced: true, notsynced: false });
    expect(off).toMatchObject({ changeable: true, synced: false, notsynced: true });
  });
  it("fixed rows are read-only, never or not synced by their direction; a tracker-driven field is synced and read-only", () => {
    expect(staticFlags(fixed("from_tracker"))).toMatchObject({ synced: true, readonly: true, changeable: false });
    expect(staticFlags(fixed("never"))).toMatchObject({ never: true, synced: false });
    expect(staticFlags(fixed("not_synced"))).toMatchObject({ notsynced: true, synced: false });
    expect(staticFlags(fixed("two_way"))).toMatchObject({ synced: true, readonly: false });
  });
  it("'all' shows every row, 'unlinked' none of the Product Velocity rows", () => {
    const f = staticFlags(fixed("never"));
    expect(flagMatches(f, "all")).toBe(true);
    expect(flagMatches(f, "unlinked")).toBe(false);
    expect(flagMatches(f, "never")).toBe(true);
    expect(flagMatches(f, "synced")).toBe(false);
  });
  it("searches every typed word, ignoring case", () => {
    expect(textMatches("Business Value Type labels pv:value", "value label")).toBe(true);
    expect(textMatches("Stack Rank", "rank due")).toBe(false);
    expect(textMatches("anything", "  ")).toBe(true);
  });
  it("counts each filter", () => {
    const flags = [staticFlags(fixed("two_way")), staticFlags(fixed("never")), changeFlags(change({ type: "toggle", on: false }))];
    expect(filterCounts(flags, 5)).toEqual({ synced: 1, changeable: 1, readonly: 0, notsynced: 1, never: 1, unlinked: 5, all: 8 });
  });
});

import { unlinkedFields } from "./workbench";
import { buildMappingView } from "./view";
import type { TrackerCatalog } from "./catalog";

describe("the tracker's own fields that nothing uses", () => {
  const entry = (id: string, name: string) => ({ id, name, custom: false, kind: "text" as const, typeLabel: "Text", options: [], filled: null, sampled: null });
  const catalog: TrackerCatalog = { tracker: "jira", scope: "PLAT", readAt: "2026-11-16T10:00:00Z", groups: [{ id: "fields", title: "Fields", error: null, entries: [entry("summary", "Summary"), entry("duedate", "Due date"), entry("customfield_9", "Go-live")] }] };
  const view = buildMappingView({ tracker: "jira", rows: [] });
  it("lists the fields that no field of the project is linked to, and none that are", () => {
    const { fields, error } = unlinkedFields(catalog, [{ name: "Platform", view }]);
    expect(error).toBeNull();
    expect(fields.map((f) => f.id)).toEqual(["customfield_9"]);
  });
  it("says so when the catalog could not be read", () => {
    expect(unlinkedFields(null, []).error).toMatch(/could not be read/);
    expect(unlinkedFields({ ...catalog, groups: [{ ...catalog.groups[0]!, error: "Jira said no" }] }, [{ name: "P", view }]).error).toContain("Jira said no");
  });
});
