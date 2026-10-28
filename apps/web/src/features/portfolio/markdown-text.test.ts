import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./markdown-text";

describe("markdownToPlainText", () => {
  it("drops headings, emphasis, code marks and link syntax but keeps the words", () => {
    expect(markdownToPlainText("## Story As a user I want **fast** `docs` and [a link](https://x.test)")).toBe("Story As a user I want fast docs and a link");
  });
  it("flattens lists, line breaks and tables to one line", () => {
    expect(markdownToPlainText("# PRD\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |")).toBe("PRD one two a b 1 2");
  });
  it("shows raw HTML tags as nothing and images as their alt text", () => {
    expect(markdownToPlainText("<b>hi</b> ![logo](https://x.test/a.png)")).toBe("hi logo");
  });
  it("is empty for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
  });
});
