import { describe, expect, it } from "vitest";
import { markdownToAdf } from "./adf";
import { descriptionFromJiraAdf } from "./jira-pull-text";
import { composeDescription } from "./jira-sections";

describe("descriptionFromJiraAdf (a Jira description kept once at pull-in)", () => {
  it("converts a description typed in Jira, whole", () => {
    const r = descriptionFromJiraAdf(markdownToAdf("## Goal\n\nThe IO builder\n\n- one\n- two"));
    expect(r).toEqual({ text: "## Goal\n\nThe IO builder\n\n- one\n- two", hadSections: false });
  });
  it("uses the Description section of a description Product Velocity wrote, not the whole thing", () => {
    const adf = composeDescription({ pv: { summary: "A summary", description: "The real description", hypothesis: "If x then y" } });
    const r = descriptionFromJiraAdf(adf);
    expect(r.hadSections).toBe(true);
    expect(r.text).toBe("The real description");
  });
  it("falls back to the Summary, then to nothing, and survives an empty or missing description", () => {
    const onlySummary = composeDescription({ pv: { summary: "Only a summary", description: "", hypothesis: "" } });
    expect(descriptionFromJiraAdf(onlySummary).text).toBe("Only a summary");
    expect(descriptionFromJiraAdf(null)).toEqual({ text: "", hadSections: false });
    expect(descriptionFromJiraAdf({ type: "doc", version: 1, content: [] })).toEqual({ text: "", hadSections: false });
  });
});
