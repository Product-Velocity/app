import { describe, expect, it } from "vitest";
import { CUSTOMER_SAFE_KEYS, buildGroupedRows, effectiveSort, sortDirectionLabels, sortSummary, healthBreakdown, filterSummary, groupableFields, matchesFilters, matchesSearch, opsFor, sanitizeView, type Filter } from "./views";
import { QUICK_FILTERS, customFilters, quickFilterOn, toggleQuickFilter } from "./quick-filters";
import { FIELDS, FIELD_BY_KEY } from "./registry";
import { setDateFormat } from "./dates";

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
    expect(names("moscow")).toEqual(["is", "any_of", "is_not", "empty", "not_empty"]);
    expect(names("initiative_name")).toEqual(["contains", "is", "empty", "not_empty"]);
    expect(names("value_12m")).toEqual(["gt", "lt", "is", "empty", "not_empty"]);
    expect(names("start_date")).toEqual(["before", "after", "between", "is", "today", "this_week", "this_month", "in_last", "in_next", "empty", "not_empty"]);
    expect(names("archived")).toEqual(["is"]);
    expect(names("product_manager")).toEqual(["is", "any_of", "is_not", "empty", "not_empty"]);
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
    setDateFormat("yyyy-mm-dd");
    expect(filterSummary(f("start_date", "before", "2027-04-01"), labels)).toBe("Start Date is before 2027-04-01");
    setDateFormat("dd/mm/yyyy");
    expect(filterSummary(f("start_date", "before", "2027-04-01"), labels)).toBe("Start Date is before 01/04/2027");
    expect(filterSummary({ field: "start_date", op: "between", value: "2027-04-01", value2: "2027-06-30" }, labels)).toBe("Start Date is between 01/04/2027 and 30/06/2027");
    expect(filterSummary(f("start_date", "in_last", "30"), labels)).toBe("Start Date is in the last 30 days");
    setDateFormat("d MMM yyyy");
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

describe("customer-safe views", () => {
  it("keep only the fields the sheet marks customer-safe, in columns, filters and grouping", () => {
    const v = sanitizeView({
      customerSafe: true,
      columns: ["stack_rank", "item_code", "initiative_name", "roadmap_category", "value_12m", "confidence", "summary"],
      filters: [{ field: "value_12m", op: "empty" }, { field: "roadmap_category", op: "is", value: "Revenue" }],
      groupBy: "confidence",
    });
    expect(v.customerSafe).toBe(true);
    expect(v.columns).toEqual(["item_code", "initiative_name", "roadmap_category", "summary"]);
    expect(v.filters.map((f) => f.field)).toEqual(["roadmap_category"]);
    expect(v.groupBy).toBeNull();
  });
  it("never lets a commercial field through", () => {
    const commercial = FIELDS.filter((f) => /^(value_(?!proposition)|confidence|customers_|customer|target_customers|decision|kr_|realized|outcome|adoption|time_to_first_revenue)/.test(f.key));
    expect(commercial.length).toBeGreaterThan(20);
    for (const f of commercial) expect(CUSTOMER_SAFE_KEYS, f.key).not.toContain(f.key);
  });
  it("are exactly the sheet's customer-safe flag, markets included", () => {
    expect([...CUSTOMER_SAFE_KEYS]).toEqual(FIELDS.filter((f) => f.customerSafe).map((f) => f.key));
    expect(CUSTOMER_SAFE_KEYS).toContain("target_scope");
    expect(CUSTOMER_SAFE_KEYS).toContain("live_scope");
  });
  it("leave ordinary views alone", () => {
    expect(sanitizeView({ columns: ["value_12m"], filters: [], groupBy: null }).columns).toContain("value_12m");
    expect(sanitizeView({ columns: ["value_12m"], filters: [], groupBy: null }).customerSafe).toBeUndefined();
  });
});

describe("health breakdown of a group", () => {
  it("counts health in words, in dictionary order, and leaves rows without health out", () => {
    expect(healthBreakdown([{ health: "At Risk" }, { health: "On Track" }, { health: "On Track" }, { health: null }, {}])).toBe("2 On Track · 1 At Risk");
    expect(healthBreakdown([])).toBe("");
  });
  it("is on every group row and follows the rows given (so the filter applies)", () => {
    const rows = [{ id: "a", moscow: "Must", health: "Blocked" }, { id: "b", moscow: "Must", health: "On Track" }, { id: "c", moscow: "Should" }];
    const out = buildGroupedRows(rows, "moscow", new Set(), (_f, v) => String(v));
    expect(out.filter((x) => "__group" in x).map((x) => (x as { healthSummary: string }).healthSummary)).toEqual(["1 On Track · 1 Blocked", ""]);
  });
});

describe("date filters: older and younger than, ranges and rolling windows", () => {
  const today = new Date(Date.UTC(2027, 3, 14)); // 14 April 2027
  const rows = [{ start_date: "2027-03-01" }, { start_date: "2027-04-10" }, { start_date: "2027-04-20" }, { start_date: "2027-09-01" }, { start_date: null }];
  const run = (filter: Filter) => rows.filter((r) => matchesFilters(r, [filter], { today })).map((r) => r.start_date);
  it("before and after leave out empty dates", () => {
    expect(run({ field: "start_date", op: "before", value: "2027-04-10" })).toEqual(["2027-03-01"]);
    expect(run({ field: "start_date", op: "after", value: "2027-04-10" })).toEqual(["2027-04-20", "2027-09-01"]);
  });
  it("between includes both ends, in either order, and filters nothing until both dates are valid", () => {
    expect(run({ field: "start_date", op: "between", value: "2027-04-10", value2: "2027-04-20" })).toEqual(["2027-04-10", "2027-04-20"]);
    expect(run({ field: "start_date", op: "between", value: "2027-04-20", value2: "2027-04-10" })).toEqual(["2027-04-10", "2027-04-20"]);
    expect(run({ field: "start_date", op: "between", value: "2027-04-10" })).toHaveLength(5);
  });
  it("in the last N days reaches back from today and in the next N days forward", () => {
    expect(run({ field: "start_date", op: "in_last", value: "7" })).toEqual(["2027-04-10"]);
    expect(run({ field: "start_date", op: "in_next", value: "10" })).toEqual(["2027-04-20"]);
    expect(run({ field: "start_date", op: "in_next", value: "abc" })).toHaveLength(5);
  });
  it("survives a saved view round trip, including the second date", () => {
    const v = sanitizeView({ columns: ["start_date"], filters: [{ field: "start_date", op: "between", value: "2027-04-01", value2: "2027-04-30" }] });
    expect(v.filters).toEqual([{ field: "start_date", op: "between", value: "2027-04-01", value2: "2027-04-30" }]);
  });
});

describe("filters of the new filter panel", () => {
  const rows = [
    { id: "a", health: "At Risk", moscow: "Must", product_manager: "u1", created_at: "2026-10-26T09:00:00Z", initiative_status: "In Progress" },
    { id: "b", health: "Blocked", moscow: "Should", product_manager: "u2", created_at: "2026-10-21T09:00:00Z", initiative_status: "Backlog" },
    { id: "c", health: "On Track", moscow: "Must", product_manager: "u1", created_at: "2026-09-02T09:00:00Z", initiative_status: "In Progress" },
    { id: "d", health: null, moscow: null, product_manager: null, created_at: null, initiative_status: null },
  ];
  const today = new Date(Date.UTC(2026, 9, 26)); // Monday 26 October 2026
  const ids = (f: Filter[]) => rows.filter((r) => matchesFilters(r, f, { me: "u1", today })).map((r) => r.id);

  it("is any of: any of the values; no value filters nothing", () => {
    expect(ids([{ field: "health", op: "any_of", values: ["At Risk", "Blocked"] }])).toEqual(["a", "b"]);
    expect(ids([{ field: "health", op: "any_of", values: [] }])).toEqual(["a", "b", "c", "d"]);
    expect(ids([{ field: "product_manager", op: "any_of", values: ["me", "u2"] }])).toEqual(["a", "b", "c"]);
  });
  it("today, this week (Monday to Sunday) and this month work on a date and on a timestamp", () => {
    expect(ids([{ field: "created_at", op: "today" }])).toEqual(["a"]);
    expect(ids([{ field: "created_at", op: "this_week" }])).toEqual(["a"]);
    expect(ids([{ field: "created_at", op: "this_month" }])).toEqual(["a", "b"]);
    // on a Sunday the week still began on Monday
    const sunday = new Date(Date.UTC(2026, 10, 1));
    expect(matchesFilters({ created_at: "2026-10-26T12:00:00Z" }, [{ field: "created_at", op: "this_week" }], { today: sunday })).toBe(true);
    expect(matchesFilters({ created_at: "2026-10-25T12:00:00Z" }, [{ field: "created_at", op: "this_week" }], { today: sunday })).toBe(false);
  });
  it("date operators also work on the app's own dates (created, last changed)", () => {
    expect(opsFor(FIELD_BY_KEY.created_at!).map((o) => o.op)).toContain("this_week");
    expect(ids([{ field: "created_at", op: "before", value: "2026-10-22" }])).toEqual(["b", "c"]);
    expect(ids([{ field: "created_at", op: "between", value: "2026-10-01", value2: "2026-10-31" }])).toEqual(["a", "b"]);
  });
  it("a saved view keeps the values and drops what does not belong", () => {
    const v = sanitizeView({ columns: [], filters: [{ field: "health", op: "any_of", values: ["At Risk", "At Risk", "", 7] }, { field: "moscow", op: "today" }] });
    expect(v.filters).toEqual([{ field: "health", op: "any_of", values: ["At Risk"] }]);
  });
  it("pinned columns: only inside the first four places, after the core columns", () => {
    const cols = ["stack_rank", "item_code", "initiative_name", "moscow", "health"];
    expect(sanitizeView({ columns: cols, pinned: ["moscow", "health"] }).pinned).toEqual(["moscow"]);
    expect(sanitizeView({ columns: cols, pinned: ["stack_rank", "nope"] }).pinned).toBeUndefined();
    expect(sanitizeView({ columns: cols }).pinned).toBeUndefined();
  });
  it("says it in words", () => {
    const labels = { person: (id: string) => `person ${id}`, project: (id: string) => id };
    expect(filterSummary({ field: "health", op: "any_of", values: ["At Risk", "Blocked"] }, labels)).toBe("Health is any of At Risk, Blocked");
    expect(filterSummary({ field: "created_at", op: "this_week" }, labels)).toBe("Created At is this week");
  });
});

describe("quick filters", () => {
  it("toggle on and off without touching other filters, and are recognised in the list", () => {
    const other: Filter = { field: "horizon", op: "is", value: "Now" };
    const attention = QUICK_FILTERS.find((q) => q.id === "attention")!;
    const on = toggleQuickFilter([other], attention);
    expect(on).toHaveLength(2);
    expect(quickFilterOn(on, attention)).toBe(true);
    expect(customFilters(on)).toEqual([other]);
    expect(toggleQuickFilter(on, attention)).toEqual([other]);
  });
  it("every quick filter is a filter the engine accepts", () => {
    for (const q of QUICK_FILTERS) {
      expect(sanitizeView({ columns: [], filters: q.filters }).filters, q.id).toHaveLength(q.filters.length);
    }
  });
  it("a rule the person added by hand that equals a quick filter shows as that quick filter", () => {
    const rule: Filter = { field: "moscow", op: "is", value: "Must" };
    expect(quickFilterOn([rule], QUICK_FILTERS.find((q) => q.id === "high-impact")!)).toBe(true);
  });
});

describe("sort labels and fallback (issue #207)", () => {
  it("words the directions to fit the data", () => {
    expect(sortDirectionLabels("initiative_name")).toEqual({ asc: "A-Z", desc: "Z-A" });
    expect(sortDirectionLabels("effort")).toEqual({ asc: "A-Z", desc: "Z-A" }); // a T-shirt select is text
    expect(sortDirectionLabels("stack_rank")).toEqual({ asc: "Low to high", desc: "High to low" });
    const date = FIELDS.find((f) => f.type === "Date")!;
    expect(sortDirectionLabels(date.key)).toEqual({ asc: "Oldest first", desc: "Newest first" });
    const num = FIELDS.find((f) => f.type === "Number")!;
    expect(sortDirectionLabels(num.key).asc).toBe("Low to high");
  });
  it("summarises the sort, or the default order", () => {
    expect(sortSummary({ field: "initiative_name", dir: "desc" })).toBe("Sorted by Initiative Name, Z-A");
    expect(sortSummary(null)).toBe("Sorted by global Stack Rank");
  });
  it("ignores a saved sort whose column the view does not show", () => {
    expect(effectiveSort({ columns: ["initiative_name"], sort: { field: "moscow", dir: "asc" } })).toBeNull();
    expect(effectiveSort({ columns: ["initiative_name", "moscow"], sort: { field: "moscow", dir: "asc" } })).toEqual({ field: "moscow", dir: "asc" });
    expect(effectiveSort({ columns: ["moscow"] })).toBeNull();
  });
});
