import { describe, expect, it } from "vitest";
import { labelFields } from "./inbound";

describe("labelFields (type: is Change Type, area: is Focus Area)", () => {
  it("maps the labels of the EARO issue", () => {
    expect(labelFields(["area:admin", "type:feature"])).toEqual({ changeType: "New feature", focusArea: "admin", notes: [] });
  });
  it("reads the words for the two Change Types, ignoring case and spacing around the colon", () => {
    expect(labelFields(["Type: Enhancement"]).changeType).toBe("Improvement to existing feature");
    expect(labelFields(["type:improvement"]).changeType).toBe("Improvement to existing feature");
    expect(labelFields(["TYPE:New Feature"]).changeType).toBe("New feature");
  });
  it("maps bug to the Bug Change Type, also written bug fix or defect", () => {
    expect(labelFields(["type:bug"]).changeType).toBe("Bug");
    expect(labelFields(["Type: Bug Fix"]).changeType).toBe("Bug");
    expect(labelFields(["type:defect"]).changeType).toBe("Bug");
    expect(labelFields(["type:bug", "type:feature"]).changeType).toBeUndefined(); // two different types: nothing is guessed
  });
  it("leaves out what has no Change Type, and anything ambiguous", () => {
    expect(labelFields(["type:chore"])).toEqual({ notes: ["type:chore has no Change Type"] });
    expect(labelFields(["type:docs", "area:admin"])).toEqual({ focusArea: "admin", notes: ["type:docs has no Change Type"] });
    expect(labelFields(["type:feature", "type:improvement"]).changeType).toBeUndefined();
    expect(labelFields(["area:admin", "area:billing"]).focusArea).toBeUndefined();
    expect(labelFields(["area:admin", "AREA:Admin"]).focusArea).toBe("admin"); // the same word twice is one value
  });
  it("ignores other labels, empty values and non-strings", () => {
    expect(labelFields(["bug", "good first issue", "type:", "area:  ", "typed:feature", 5 as never])).toEqual({ notes: [] });
    expect(labelFields(null)).toEqual({ notes: [] });
  });
  it("cleans and cuts the focus area", () => {
    expect(labelFields([`area:  Host\tRead   Ads\u0000`]).focusArea).toBe("Host Read Ads");
    expect(labelFields([`area:${"x".repeat(300)}`]).focusArea).toHaveLength(120);
  });
});
