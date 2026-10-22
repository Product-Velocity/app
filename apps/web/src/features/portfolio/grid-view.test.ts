import { describe, expect, it } from "vitest";
import { baseDef, baseLabel, baseParam, parseBase, sameView } from "./grid-view";

const saved = [{ id: "v1", name: "My planning", columns: ["stack_rank", "item_code", "initiative_name", "moscow"], filters: [{ field: "moscow", op: "is" as const, value: "Must" }], groupBy: "health" }];

describe("baseDef", () => {
  it("a default view starts with the core columns, then the sheet's columns, no filters, not grouped", () => {
    const d = baseDef({ kind: "builtin", name: "Prioritisation" }, [])!;
    expect(d.columns.slice(0, 3)).toEqual(["stack_rank", "item_code", "initiative_name"]);
    expect(d.columns).toContain("value_12m");
    expect(d.filters).toEqual([]);
    expect(d.groupBy).toBeNull();
  });
  it("all columns has every field", () => {
    expect(baseDef({ kind: "all" }, [])!.columns).toHaveLength(165);
  });
  it("a saved view is read from the list, and is null when it is missing", () => {
    expect(baseDef({ kind: "saved", id: "v1" }, saved)).toMatchObject({ groupBy: "health", filters: [{ field: "moscow", op: "is", value: "Must" }] });
    expect(baseDef({ kind: "saved", id: "zz" }, saved)).toBeNull();
  });
});

describe("sameView", () => {
  it("ignores unknown columns and compares order", () => {
    const a = baseDef({ kind: "builtin", name: "Planning" }, [])!;
    expect(sameView(a, { ...a, columns: [...a.columns, "nope"] })).toBe(true);
    expect(sameView(a, { ...a, columns: [...a.columns].reverse() })).toBe(false);
    expect(sameView(a, { ...a, groupBy: "health" })).toBe(false);
  });
});

describe("address parameter", () => {
  it("round-trips", () => {
    const fb = { kind: "builtin", name: "Prioritisation" } as const;
    expect(parseBase(null, fb)).toEqual(fb);
    expect(parseBase("Planning", fb)).toEqual({ kind: "builtin", name: "Planning" });
    expect(parseBase("all", fb)).toEqual({ kind: "all" });
    expect(parseBase("some-uuid", fb)).toEqual({ kind: "saved", id: "some-uuid" });
    expect(baseParam(fb)).toBeNull();
    expect(baseParam({ kind: "builtin", name: "Planning" })).toBe("Planning");
    expect(baseParam({ kind: "all" })).toBe("all");
    expect(baseParam({ kind: "saved", id: "v1" })).toBe("v1");
  });
  it("labels", () => {
    expect(baseLabel({ kind: "saved", id: "v1" }, saved)).toBe("My planning");
    expect(baseLabel({ kind: "all" }, [])).toBe("All columns");
  });
});
