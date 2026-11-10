import { describe, expect, it } from "vitest";
import { isPlaceholder, stageMissing } from "./stage-check";

describe("stage check", () => {
  it("a name-only initiative (Discover) lacks the hypothesis and the key result", () => {
    expect(stageMissing({ initiative_name: "A", home_project: "p" })).toEqual(["Hypothesis", "Primary key result"]);
  });
  it("asks for what the next gate needs", () => {
    expect(stageMissing({ initiative_name: "A", home_project: "p", hypothesis: "IF", initiative_phase: "Discover" })).toEqual(["Primary key result"]);
    expect(stageMissing({ initiative_name: "A", home_project: "p", hypothesis: "IF", initiative_phase: "Define" })).toEqual(["Effort", "MoSCoW"]);
    expect(stageMissing({ initiative_name: "A", home_project: "p", hypothesis: "IF", initiative_phase: "Build" })).toEqual([]);
  });
  it("finished or stopped initiatives are not placeholders", () => {
    expect(isPlaceholder({ initiative_name: "A", home_project: "p" })).toBe(true);
    expect(isPlaceholder({ initiative_name: "A", home_project: "p", initiative_status: "Cancelled" })).toBe(false);
    expect(isPlaceholder({ initiative_name: "A", home_project: "p", initiative_phase: "Completed" })).toBe(false);
  });
});
