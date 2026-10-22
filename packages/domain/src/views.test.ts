import { describe, expect, it } from "vitest";
import { buildGroupedRows, filterSummary, groupableFields, matchesFilters, matchesSearch, opsFor, sanitizeView, type Filter } from "./views";
import { FIELD_BY_KEY } from "./registry";

const row = (o: Record<string, unknown> = {}) => ({ id: "i1", item_code: "R-01", initiative_name: "Faster search results", stack_rank: 1, home_project: "p1", ...o });
const ctx = { me: "u1", today: new Date(Date.UTC(2027, 3, 14)) };
const f = (field: string, op: Filter["op"], value?: string): Filter => ({ field, op, ...(value !== undefined ? { value } : {}) });

describe("matchesFilters", () => {
  it("no filters keeps everything", () => {
    expect(matchesFilters(row(), [], ctx)).toBe(true);
  });
  it("select and project: is / is not", () => {
    expect(matchesFilters(row({ moscow: "Must" }), [f("moscow", "is", "Must")], ctx)).toBe(true);
    expect(matchesFilters(row({ moscow: "Should" }), [f("moscow", "is", "Must")], ctx)).toBe(false);
    expect(matchesFilters(row({ moscow: "Should" }), [f("moscow", "is_not", "Must")], ctx)).toBe(true);
    expect(matchesFilters(row({ moscow: null }), [f("moscow", "is_not", "Must")], ctx)).toBe(true);
    expect(matchesFilters(row(), [f("home_project", "is", "p1")], ctx)).toBe(true);
    expect(matchesFilters(row(), [f("home_project", "is", "p2")], ctx)).toBe(false);
  });
  it('"me" means the signed-in person, for any person field', () => {
    expect(matchesFilters(row({ product_manager: "u1" }), [f("product_manager", "is", "me")], ctx)).toBe(true);
    expect(matchesFilters(row({ product_manager: "u2" }), [f("product_manager", "is", "me")], ctx)).toBe(false);
    expect(matchesFilters(row({ product_manager: "u2" }), [f("product_manager", "is", "u2")], ctx)).toBe(true);
    expect(matchesFilters(row({ product_manager: "u1" }), [f("product_manager", "is", "me")], { today: ctx.today })).toBe(false);
  });
  it("text: contains, ignoring case", () => {
    expect(matchesFilters(row(), [f("initiative_name", "contains", "SEARCH")], ctx)).toBe(true);
    expect(matchesFilters(row(), [f("initiative_name", "contains", "billing")], ctx)).toBe(false);
    expect(matchesFilters(row({ hypothesis: null }), [f("hypothesis", "contains", "x")], ctx)).toBe(false);
  });
  it("numbers and amounts: is, greater than, less than; empty never matches a comparison", () => {
    const r = row({ value_12m: 5000 });
    expect(matchesFilters(r, [f("value_12m", "gt", "1000")], ctx)).toBe(true);
    expect(matchesFilters(r, [f("value_12m", "lt", "1000")], ctx)).toBe(false);
    expect(matchesFilters(r, [f("value_12m", "is", "5000")], ctx)).toBe(true);
    expect(matchesFilters(row({ value_12m: null }), [f("value_12m", "gt", "0")], ctx)).toBe(false);
    expect(matchesFilters(r, [f("value_12m", "gt", "abc")], ctx)).toBe(true); // an unreadable value filters nothing
  });
  it("dates: before, after, is (ISO)", () => {
    const r = row({ start_date: "2027-03-31" });
    expect(matchesFilters(r, [f("start_date", "before", "2027-04-01")], ctx)).toBe(true);
    expect(matchesFilters(r, [f("start_date", "after", "2027-03-31")], ctx)).toBe(false);
    expect(matchesFilters(r, [f("start_date", "is", "2027-03-31")], ctx)).toBe(true);
    expect(matchesFilters(row({ start_date: null }), [f("start_date", "before", "2030-01-01")], ctx)).toBe(false);
  });
  it("yes/no fields and empty / not empty", () => {
    expect(matchesFilters(row({ archived: true }), [f("archived", "is", "Yes")], ctx)).toBe(true);
    expect(matchesFilters(row({ archived: false }), [f("archived", "is", "Yes")], ctx)).toBe(false);
    expect(matchesFilters(row({ archived: false }), [f("archived", "is", "No")], ctx)).toBe(true);
    expect(matchesFilters(row({ moscow: null }), [f("moscow", "empty")], ctx)).toBe(true);
    expect(matchesFilters(row({ moscow: "" }), [f("moscow", "empty")], ctx)).toBe(true);
    expect(matchesFilters(row({ moscow: "Must" }), [f("moscow", "not_empty")], ctx)).toBe(true);
    expect(matchesFilters(row({ moscow: "Must" }), [f("moscow", "empty")], ctx)).toBe(false);
  });
  it("all filters must match", () => {
    const r = row({ moscow: "Must", effort: "M" });
    expect(matchesFilters(r, [f("moscow", "is", "Must"), f("effort", "is", "M")], ctx)).toBe(true);
    expect(matchesFilters(r, [f("moscow", "is", "Must"), f("effort", "is", "L")], ctx)).toBe(false);
  });
  it("ignores a filter on an unknown field instead of hiding everything", () => {
    expect(matchesFilters(row(), [f("nope", "is", "x")], ctx)).toBe(true);
  });
});

describe("opsFor", () => {
  it("offers operators that fit the field type", () => {
    const names = (k: string) => opsFor(FIELD_BY_KEY[k]!).map((o) => o.op);
    expect(names("moscow")).toEqual(["is", "is_not", "empty", "not_empty"]);
    expect(names("initiative_name")).toEqual(["contains", "is", "empty", "not_empty"]);
    expect(names("value_12m")).toEqual(["gt", "lt", "is", "empty", "not_empty"]);
    expect(names("start_date")).toEqual(["before", "after", "is", "empty", "not_empty"]);
    expect(names("archived")).toEqual(["is"]);
    expect(names("product_manager")).toEqual(["is", "is_not", "empty", "not_empty"]);
  });
});

describe("matchesSearch", () => {
  it("looks at the code and the name, ignoring case and extra spaces; all words must be found", () => {
    expect(matchesSearch(row(), "faster  SEARCH")).toBe(true);
    expect(matchesSearch(row(), "r-01")).toBe(true);
    expect(matchesSearch(row(), "faster billing")).toBe(false);
    expect(matchesSearch(row(), "   ")).toBe(true);
  });
});

describe("filterSummary", () => {
  it("describes a filter in words", () => {
    const labels = { person: (id: string) => (id === "me" ? "me" : `person ${id}`), project: (id: string) => `Project ${id}` };
    expect(filterSummary(f("moscow", "is", "Must"), labels)).toBe("MoSCoW is Must");
    expect(filterSummary(f("product_manager", "is", "me"), labels)).toBe("Product Manager is me");
    expect(filterSummary(f("home_project", "is_not", "p1"), labels)).toBe("Home Project is not Project p1");
    expect(filterSummary(f("start_date", "before", "2027-04-01"), labels)).toBe("Start Date is before 2027-04-01");
    expect(filterSummary(f("moscow", "empty"), labels)).toBe("MoSCoW is empty");
    expect(filterSummary(f("value_12m", "gt", "1000"), labels)).toBe("Value (EUR, 12-month run-rate) is greater than 1000");
  });
});

describe("grouping", () => {
  const rows = [
    row({ id: "a", moscow: "Must" }), row({ id: "b", moscow: "Should" }), row({ id: "c", moscow: "Must" }), row({ id: "d", moscow: null }), row({ id: "e", moscow: "Should" }),
  ].map((r, i) => ({ ...r, stack_rank: i + 1 }));
  const label = (_f: string, v: unknown) => (v === null || v === undefined || v === "" ? "No value" : String(v));

  it("is off by default: the rows come back unchanged", () => {
    expect(buildGroupedRows(rows, null, new Set(), label)).toEqual(rows);
  });
  it("puts a header before each group, keeps rank order inside a group, orders groups by the field's list, empty last", () => {
    const out = buildGroupedRows(rows, "moscow", new Set(), label);
    const shape = out.map((x) => ("__group" in x ? `# ${x.label} (${x.count})` : x.id));
    expect(shape).toEqual(["# Must (2)", "a", "c", "# Should (2)", "b", "e", "# No value (1)", "d"]);
  });
  it("collapsed groups keep their header and hide their rows", () => {
    const out = buildGroupedRows(rows, "moscow", new Set(["moscow:Must"]), label);
    expect(out.map((x) => ("__group" in x ? `# ${x.label}${x.collapsed ? " (collapsed)" : ""}` : x.id))).toEqual(["# Must (collapsed)", "# Should", "b", "e", "# No value", "d"]);
  });
  it("gives group headers stable ids", () => {
    const out = buildGroupedRows(rows, "moscow", new Set(), label);
    expect(out.filter((x) => "__group" in x).map((x) => x.id)).toEqual(["group:moscow:Must", "group:moscow:Should", "group:moscow:"]);
  });
  it("offers select, person, yes/no and project fields for grouping", () => {
    const keys = groupableFields().map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["moscow", "health", "effort", "home_project", "product_manager", "archived", "roadmap_category"]));
    expect(keys).not.toContain("initiative_name");
    expect(keys).toContain("status"); // a read-only field can still be grouped by
  });
});

describe("sanitizeView", () => {
  it("keeps known columns in order, always keeps the core columns first, drops unknown keys and duplicates", () => {
    const v = sanitizeView({ columns: ["moscow", "nope", "moscow", "effort"], filters: [], groupBy: null });
    expect(v.columns).toEqual(["stack_rank", "item_code", "initiative_name", "moscow", "effort"]);
  });
  it("drops filters with unknown fields or operators, and an unknown group field", () => {
    const v = sanitizeView({ columns: ["moscow"], filters: [{ field: "moscow", op: "is", value: "Must" }, { field: "nope", op: "is", value: "x" }, { field: "moscow", op: "weird" }, "junk"], groupBy: "nope" });
    expect(v.filters).toEqual([{ field: "moscow", op: "is", value: "Must" }]);
    expect(v.groupBy).toBeNull();
  });
  it("copes with garbage", () => {
    expect(sanitizeView(null).columns).toEqual(["stack_rank", "item_code", "initiative_name"]);
    expect(sanitizeView({ columns: "x", filters: 5, groupBy: 3 })).toEqual({ columns: ["stack_rank", "item_code", "initiative_name"], filters: [], groupBy: null });
  });
});
