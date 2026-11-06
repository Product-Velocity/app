import { describe, expect, it } from "vitest";
import { checkDocumentInput, MAX_DOC_CHARS } from "./documents";

describe("checkDocumentInput", () => {
  it("accepts a normal document and trims the title", () => {
    expect(checkDocumentInput({ kind: "prd", title: "  PRD: X ", body: "# X", status: "in_review" }, { requireTitle: true })).toEqual({ ok: true, value: { kind: "prd", title: "PRD: X", body: "# X", status: "in_review" } });
  });
  it("needs a title on create, not on update", () => {
    expect(checkDocumentInput({ body: "x" }, { requireTitle: true }).ok).toBe(false);
    expect(checkDocumentInput({ body: "x" }, { requireTitle: false })).toEqual({ ok: true, value: { body: "x" } });
    expect(checkDocumentInput({ title: " " }, { requireTitle: false }).ok).toBe(false);
  });
  it("refuses a bad kind, an oversize text and any approval by Claude", () => {
    expect(checkDocumentInput({ kind: "memo", title: "x" }, { requireTitle: true })).toMatchObject({ ok: false });
    expect(checkDocumentInput({ title: "x", body: "a".repeat(MAX_DOC_CHARS + 1) }, { requireTitle: true })).toMatchObject({ ok: false, error: expect.stringContaining("limit") });
    expect(checkDocumentInput({ status: "approved" }, { requireTitle: false })).toMatchObject({ ok: false, error: expect.stringContaining("Approver") });
    expect(checkDocumentInput({ status: "done" }, { requireTitle: false }).ok).toBe(false);
  });
});

import { demoteHeadings, documentsMarkdown, documentsPreviewNote, renderDocuments } from "./documents";
describe("documents in the delivery platforms", () => {
  it("moves every heading to level 4 or below, outside code, so none can be read as one of our sections", () => {
    const out = demoteHeadings("# Title\n## Summary\n### Sub\ntext\n```\n## Description\ncode\n```\n~~~\n# x\n~~~\n## Hypothesis (IF / THEN / RESULTING IN)");
    expect(out.split("\n")).toEqual(["#### Title", "##### Summary", "###### Sub", "text", "```", "​## Description", "code", "```", "~~~", "​# x", "~~~", "##### Hypothesis (IF / THEN / RESULTING IN)"]);
    expect(out).not.toMatch(/(^|\n)#{1,3}\s/);
  });
  it("renders title, kind, status and the AI-draft note, then the text", () => {
    const md = documentsMarkdown([{ title: "PRD: Brief", kind: "prd", status: "in_review", body: "## Goal\nShip.", aiDraft: true }], 5000);
    expect(md).toBe("### PRD: Brief (PRD)\n_In review · AI draft, not yet reviewed_\n\n##### Goal\nShip.");
    expect(documentsMarkdown([], 5000)).toBe("");
  });
  it("skips a document without text and says so for the preview", () => {
    const r = renderDocuments([{ title: "PRD", kind: "prd", status: "approved", body: "  \n", aiDraft: false }, { title: "Brief", kind: "other", status: "draft", body: "Text", aiDraft: false }], 5000);
    expect(r.markdown).toBe("### Brief (Other)\n_Draft_\n\nText");
    expect(r).toMatchObject({ sent: ["Brief"], empty: ["PRD"], cut: [], omitted: [] });
    expect(documentsPreviewNote(r, "Jira description")).toBe("Documents in the Jira description: Brief. Skipped, no text yet: PRD.");
    const none = renderDocuments([{ title: "PRD", kind: "prd", status: "draft", body: "", aiDraft: false }], 5000);
    expect(none.markdown).toBe("");
    expect(documentsPreviewNote(none, "issue")).toBe("No document text goes into the issue. Skipped, no text yet: PRD.");
    expect(documentsPreviewNote(renderDocuments([], 5000), "issue")).toBeUndefined();
  });
  it("stays within the budget: cuts the document that does not fit at a line, names the ones after it", () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i} `.repeat(5)).join("\n");
    const docs = [{ title: "Short", kind: "other", status: "draft", body: "ok", aiDraft: false }, { title: "Long", kind: "prd", status: "draft", body: long, aiDraft: false }, { title: "Later", kind: "prd", status: "draft", body: "x", aiDraft: false }];
    const md = documentsMarkdown(docs, 2000);
    expect(md.length).toBeLessThanOrEqual(2000 + 200); // the closing notes are small
    expect(md).toContain("### Short (Other)");
    expect(md).toContain("Cut here to fit");
    expect(md).toContain("Not included, too long for the issue: Later");
    expect(documentsMarkdown(docs, 10)).toContain("Not included, too long for the issue: Short, Long, Later");
    expect(documentsPreviewNote(renderDocuments(docs, 2000), "issue")).toContain("Long (cut to fit)");
  });
});
