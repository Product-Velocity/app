import { describe, expect, it } from "vitest";
import { sortListRows } from "./list-sort";

type R = { code: string; n: number | null; tier: number };
const rows: R[] = [{ code: "R-10", n: 2, tier: 1 }, { code: "R-2", n: null, tier: 0 }, { code: "R-1", n: 5, tier: 1 }];
const by = { code: (r: R) => r.code, n: (r: R) => r.n, tier: (r: R) => r.tier };

describe("sortListRows", () => {
  it("sorts text as words and numbers, either way, and keeps the rest when the model is empty", () => {
    expect(sortListRows(rows, [{ colId: "code", sort: "asc" }], by).map((r) => r.code)).toEqual(["R-1", "R-2", "R-10"]);
    expect(sortListRows(rows, [{ colId: "code", sort: "desc" }], by).map((r) => r.code)).toEqual(["R-10", "R-2", "R-1"]);
    expect(sortListRows(rows, [], by)).toEqual(rows);
    expect(sortListRows(rows, [{ colId: "unknown", sort: "asc" }], by)).toEqual(rows);
  });
  it("puts empty values last in both directions, and breaks ties with the next column, then the original order", () => {
    expect(sortListRows(rows, [{ colId: "n", sort: "asc" }], by).map((r) => r.code)).toEqual(["R-10", "R-1", "R-2"]);
    expect(sortListRows(rows, [{ colId: "n", sort: "desc" }], by).map((r) => r.code)).toEqual(["R-1", "R-10", "R-2"]);
    expect(sortListRows(rows, [{ colId: "tier", sort: "asc" }, { colId: "code", sort: "asc" }], by).map((r) => r.code)).toEqual(["R-2", "R-1", "R-10"]);
    expect(sortListRows(rows, [{ colId: "tier", sort: "desc" }], by).map((r) => r.code)).toEqual(["R-10", "R-1", "R-2"]);
  });
  it("does not change the rows it is given", () => {
    const copy = [...rows];
    sortListRows(rows, [{ colId: "code", sort: "asc" }], by);
    expect(rows).toEqual(copy);
  });
});
