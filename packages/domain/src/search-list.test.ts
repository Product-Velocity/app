import { describe, expect, it } from "vitest";
import { fieldOptions, filterOptions, LONG_LIST, needsSearch } from "./search-list";
import { FIELDS } from "./registry";

const opts = [
  { value: "a", label: "Home Project" },
  { value: "b", label: "Product Manager", keywords: "owner pm" },
  { value: "c", label: "Planned Start" },
  { value: "d", label: "G2M Date (est)", keywords: "g2m_date_est end" },
];

describe("filterOptions", () => {
  it("shows everything for an empty or blank query, in the given order", () => {
    expect(filterOptions(opts, "").map((o) => o.value)).toEqual(["a", "b", "c", "d"]);
    expect(filterOptions(opts, "   ").map((o) => o.value)).toEqual(["a", "b", "c", "d"]);
  });
  it("is case-insensitive and matches anywhere in the name", () => {
    expect(filterOptions(opts, "MANA").map((o) => o.value)).toEqual(["b"]);
    expect(filterOptions(opts, "start").map((o) => o.value)).toEqual(["c"]);
    expect(filterOptions(opts, "ject").map((o) => o.value)).toEqual(["a"]);
  });
  it("matches aliases and keys as well as names", () => {
    expect(filterOptions(opts, "owner").map((o) => o.value)).toEqual(["b"]);
    expect(filterOptions(opts, "g2m_date").map((o) => o.value)).toEqual(["d"]);
    expect(filterOptions(opts, "end").map((o) => o.value)).toEqual(["d"]);
  });
  it("every word of the query must match, in any order", () => {
    expect(filterOptions(opts, "manager product").map((o) => o.value)).toEqual(["b"]);
    expect(filterOptions(opts, "project manager")).toEqual([]);
  });
  it("ignores accents and punctuation differences like dashes and brackets", () => {
    expect(filterOptions([{ value: "x", label: "Estimate (weeks)" }], "estimate weeks").map((o) => o.value)).toEqual(["x"]);
    expect(filterOptions([{ value: "x", label: "Café" }], "cafe").map((o) => o.value)).toEqual(["x"]);
  });
  it("a name that starts with the query comes before one that only contains it", () => {
    const r = filterOptions([{ value: "1", label: "Project rank" }, { value: "2", label: "Home Project" }, { value: "3", label: "Projected" }], "proj");
    expect(r.map((o) => o.value)).toEqual(["1", "3", "2"]);
  });
});

describe("needsSearch", () => {
  it("is true for more than 8 options only", () => {
    expect(LONG_LIST).toBe(8);
    expect(needsSearch(8)).toBe(false);
    expect(needsSearch(9)).toBe(true);
  });
});

describe("field lists", () => {
  it("the 166 fields can be searched by name, key and import alias", () => {
    const o = fieldOptions(FIELDS);
    expect(o).toHaveLength(166);
    expect(filterOptions(o, "owner").some((x) => x.value === "product_manager")).toBe(true);
    expect(filterOptions(o, "tshirt").some((x) => x.value === "effort")).toBe(true);
    expect(filterOptions(o, "g2m_date_est").some((x) => x.value === "g2m_date_est")).toBe(true);
    expect(filterOptions(o, "value_weighted").length).toBeGreaterThan(0);
    expect(filterOptions(o, "zzzz")).toEqual([]);
  });
  it("carries the field's group so lists can show headings", () => {
    const o = fieldOptions(FIELDS);
    expect(o.find((x) => x.value === "initiative_name")!.group).toBe(FIELDS.find((f) => f.key === "initiative_name")!.group);
  });
});
