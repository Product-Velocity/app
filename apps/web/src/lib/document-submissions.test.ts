import { describe, expect, it } from "vitest";
import { docTypeLabel, documentLink, parseBefore, submissionAction, submittedBy, writtenWith } from "./document-submissions";

describe("document submission helpers", () => {
  it("names the action, the type and the author of the text", () => {
    expect(submissionAction({ version: 1 })).toBe("Created");
    expect(submissionAction({ version: 3 })).toBe("Updated (v3)");
    expect(docTypeLabel("prd")).toBe("PRD");
    expect(docTypeLabel("something_new")).toBe("something_new");
    expect(writtenWith({ ai_tool: "claude", ai_model: "Claude Opus 5.5" })).toBe("Claude (Claude Opus 5.5)");
    expect(writtenWith({ ai_tool: "chatgpt", ai_model: null })).toBe("ChatGPT");
    expect(writtenWith({ ai_tool: null, ai_model: null })).toBe("Person");
  });
  it("shows who saved it, also when the row is old or the person has left", () => {
    expect(submittedBy({ saved_by: "u", person_name: "Cora", person_email: "c@x.test" })).toBe("Cora (c@x.test)");
    expect(submittedBy({ saved_by: "u", person_name: null, person_email: null })).toBe("Former member");
    expect(submittedBy({ saved_by: null, person_name: null, person_email: null })).toBe("System");
  });
  it("links to the Spec tab of the initiative on that document, escaping what it is given", () => {
    expect(documentLink({ item_code: "R-12", document_id: "abc" })).toBe("/portfolio?item=R-12&tab=spec&doc=abc");
    expect(documentLink({ item_code: "R 1&x", document_id: "a/b" })).toBe("/portfolio?item=R%201%26x&tab=spec&doc=a%2Fb");
  });
  it("only accepts a timestamp as the page cursor", () => {
    expect(parseBefore("2026-10-30T10:00:00.123Z")).toBe("2026-10-30T10:00:00.123Z");
    for (const bad of ["", "yesterday", "2026-10-30", "x'; drop table", undefined]) expect(parseBefore(bad)).toBeUndefined();
  });
});
