import { describe, expect, it } from "vitest";
import { composeDescription } from "./atlassian/jira-sections";
import { wroteGithub, wroteJira } from "./sync-wrote";

describe("what a Sync wrote, in words", () => {
  const block = ["<!-- pv:begin item=x -->", "", "## Summary", "S", "", "## Description", "D", "", "## Links", "- [A](https://a.test)", "- [B](https://b.test)", "", "## Files", "- [F](https://f.test)", "", "## Documents", "- [PRD (PRD, Draft)](https://d.test/1)", "- [Disc (Discovery, Draft)](https://d.test/2)", "", "---", "Managed by Product Velocity", "<!-- pv:end -->"].join("\n");
  it("GitHub: the sections of the block with their counts, labels, milestone and board", () => {
    expect(wroteGithub({ title: "R-1: X", block, labels: ["a", "b", "c"], milestone: "Q1 2027", board: { title: "Roadmap", included: true, writes: [{ field: "Priority", value: "P1" }] } }))
      .toEqual(["Title", "Summary", "Description", "Links (2)", "Files (1)", "Documents (2 links)", "Labels (3)", "Milestone Q1 2027", "Project board: Priority P1"]);
    expect(wroteGithub({ title: "R-1: X", block: "<!-- pv:begin item=x -->\n\n## Hypothesis (IF / THEN / RESULTING IN)\nIF\n\n## Artifacts\n- [Old](https://o.test)\n<!-- pv:end -->", labels: [] })).toEqual(["Title", "Hypothesis", "Links (1)"]);
  });
  it("Jira: the name, the description sections with their counts, labels and dates", () => {
    const description = composeDescription({ pv: { summary: "S", description: "D", hypothesis: "H" }, artifacts: [{ label: "A", url: "https://a.test" }], documents: [{ label: "PRD", url: "https://d.test/1" }, { label: "Disc", url: "https://d.test/2" }] });
    expect(wroteJira({ summary: "X", description, labels: ["pv:a", "product-velocity"], duedate: "2027-03-31" }))
      .toEqual(["Name", "Summary", "Description", "Hypothesis", "Links (1)", "Documents (2 links)", "Labels (2)", "Due date"]);
    expect(wroteJira({ labels: [] })).toEqual(["Labels (0)"]);
  });
});
