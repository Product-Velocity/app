import { describe, expect, it } from "vitest";
import { completeness, looksLikeBuiltIn, suggestOptions, createListText } from "./helpers";

const opts = [{ value: "201", label: "On track" }, { value: "202", label: "At Risk" }, { value: "203", label: "Done" }];

describe("suggestOptions", () => {
  it("matches a Product Velocity value to the option with the same name, ignoring case and extra spaces", () => {
    expect(suggestOptions(["On Track", "At Risk", "Delayed"], opts)).toEqual({ "On Track": "201", "At Risk": "202" });
  });
  it("never uses one option for two values, and suggests nothing when nothing matches", () => {
    expect(suggestOptions(["On Track", "on  track"], opts)).toEqual({ "On Track": "201" });
    expect(suggestOptions(["Blocked"], opts)).toEqual({});
    expect(suggestOptions([], opts)).toEqual({});
  });
});

describe("completeness", () => {
  it("counts the mapped values and names the missing ones", () => {
    expect(completeness(["A", "B", "C"], { A: "1", B: "", C: "3" })).toEqual({ mapped: 2, total: 3, missing: ["B"], text: "2 of 3 values mapped. B is not mapped, so it won't be sent." });
    expect(completeness(["A", "B"], { A: "1", B: "2" })).toMatchObject({ mapped: 2, total: 2, missing: [], text: "All 2 values mapped." });
    expect(completeness(["A", "B", "C", "D"], {}).text).toBe("0 of 4 values mapped. A, B, C and D are not mapped, so they won't be sent.");
  });
});

describe("looksLikeBuiltIn", () => {
  it("warns about a custom field named like a built-in, not about an ordinary name", () => {
    for (const n of ["Priority", "status", " Resolution ", "Assignee"]) expect(looksLikeBuiltIn(n), n).toBe(true);
    for (const n of ["Health", "Initiative Phase", "Priority band"]) expect(looksLikeBuiltIn(n), n).toBe(false);
  });
});

describe("createListText", () => {
  it("is one line per field with its values, for pasting into the tracker", () => {
    expect(createListText([{ label: "Health", values: ["On Track", "At Risk"] }, { label: "Initiative Phase", values: ["Build"] }])).toBe("Health: On Track, At Risk\nInitiative Phase: Build");
  });
});
