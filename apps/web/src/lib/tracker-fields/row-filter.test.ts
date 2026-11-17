import { describe, expect, it } from "vitest";
import { visibleRows } from "./row-filter";

const rows = [{ text: "acme/api Private", linked: true }, { text: "acme/web Private", linked: false }, { text: "acme/docs Public", linked: false }];
describe("long table filter", () => {
  it("shows all rows with no search, and counts them", () => {
    expect(visibleRows(rows, { text: "", linkedOnly: false, limit: 10 })).toEqual({ show: [true, true, true], matched: 3 });
  });
  it("needs every typed word, ignoring case", () => {
    expect(visibleRows(rows, { text: "ACME private", linkedOnly: false, limit: 10 }).show).toEqual([true, true, false]);
  });
  it("shows linked rows only when asked", () => {
    expect(visibleRows(rows, { text: "", linkedOnly: true, limit: 10 })).toEqual({ show: [true, false, false], matched: 1 });
  });
  it("pages: shows the first rows up to the limit but counts every match", () => {
    expect(visibleRows(rows, { text: "", linkedOnly: false, limit: 2 })).toEqual({ show: [true, true, false], matched: 3 });
  });
});
