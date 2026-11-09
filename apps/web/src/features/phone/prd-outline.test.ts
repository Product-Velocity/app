import { describe, expect, it } from "vitest";
import { splitSections } from "./prd-outline";

describe("splitSections", () => {
  const md = "Depends on: R-2\n\n# 1 Executive Summary\nShort.\n\n**At a glance**\n- build x\n\n## 3 Problem\nText\n```\n# not a heading\n```\n## 4 Scope\nMore";
  it("splits at headings and ignores code fences", () => {
    const s = splitSections(md);
    expect(s.map((x) => x.title)).toEqual(["", "1 Executive Summary", "3 Problem", "4 Scope"]);
    expect(s[2]!.body).toContain("# not a heading");
  });
  it("opens the first sections and the At a glance block, folds the rest", () => {
    expect(splitSections(md).map((x) => x.open)).toEqual([true, true, false, false]);
  });
  it("handles an empty or heading-less document", () => {
    expect(splitSections("")).toEqual([]);
    expect(splitSections("just text")).toEqual([{ title: "", body: "just text", open: true }]);
  });
});
