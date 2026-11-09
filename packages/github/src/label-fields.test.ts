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

import { descriptionFromIssueBody } from "./inbound";

describe("descriptionFromIssueBody (pull-in keeps the issue's text)", () => {
  it("takes a plain body as it is, with line endings unified", () => {
    expect(descriptionFromIssueBody("## Goal\r\nThe IO builder\r\n")).toEqual({ text: "## Goal\nThe IO builder", hadBlock: false });
    expect(descriptionFromIssueBody("  \n ")).toEqual({ text: "", hadBlock: false });
    expect(descriptionFromIssueBody(null)).toEqual({ text: "", hadBlock: false });
  });
  it("cuts a Product Velocity block out and keeps the text around it, instead of skipping the issue", () => {
    const body = "Intro text\n<!-- pv:begin item=11111111-1111-1111-1111-111111111111 -->\n## Summary\nS\n## Description\nD\n<!-- pv:end -->\nPart of #9";
    const r = descriptionFromIssueBody(body);
    expect(r.hadBlock).toBe(true);
    expect(r.text).toContain("Intro text");
    expect(r.text).toContain("Part of #9");
    expect(r.text).not.toMatch(/pv:begin|pv:end|## Summary/);
  });
  it("falls back to the block's own Description, then Summary, when nothing else is in the body", () => {
    const block = "<!-- pv:begin item=11111111-1111-1111-1111-111111111111 -->\n## Summary\nOnly a summary\n## Description\nThe description text\n## Hypothesis (IF / THEN / RESULTING IN)\nH\n\n---\nManaged by Product Velocity: edits between the markers are overwritten.\n<!-- pv:end -->";
    expect(descriptionFromIssueBody(block).text).toBe("The description text");
    expect(descriptionFromIssueBody(block.replace("The description text", "")).text).toBe("Only a summary");
  });
  it("returns no text for a block that cannot be read and nothing around it", () => {
    expect(descriptionFromIssueBody("<!-- pv:begin item=broken -->\nx\n<!-- pv:end -->")).toEqual({ text: "", hadBlock: true });
  });
});
