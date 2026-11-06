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

import { documentLinks, documentsPreviewNote } from "./documents";
describe("documents in the delivery platforms: a name and a public link", () => {
  const url = (n: string) => `https://app.example/d/${"T".repeat(43)}/${n}`;
  it("one label and one address per document; the kind and the status are in the label", () => {
    const r = documentLinks([{ title: "PRD: Brief", kind: "prd", status: "approved", hasText: true, url: url("a") }, { title: " ## Discovery ", kind: "discovery", status: "draft", hasText: true, url: url("b") }]);
    expect(r.links).toEqual([{ label: "PRD: Brief (PRD, Approved)", url: url("a") }, { label: "Discovery (Discovery, Draft)", url: url("b") }]);
    expect(documentsPreviewNote(r, "Jira description")).toBe("Document links in the Jira description: PRD: Brief, Discovery.");
  });
  it("skips a document without text and says so for the preview", () => {
    const r = documentLinks([{ title: "PRD", kind: "prd", status: "approved", hasText: false, url: url("c") }, { title: "Brief", kind: "other", status: "draft", hasText: true, url: url("d") }]);
    expect(r).toMatchObject({ sent: ["Brief"], empty: ["PRD"] });
    expect(documentsPreviewNote(r, "issue")).toBe("Document links in the issue: Brief. Skipped, no text yet: PRD.");
    const none = documentLinks([{ title: "PRD", kind: "prd", status: "draft", hasText: false, url: url("e") }]);
    expect(none.links).toEqual([]);
    expect(documentsPreviewNote(none, "issue")).toBe("No document link goes into the issue. Skipped, no text yet: PRD.");
    expect(documentsPreviewNote(documentLinks([]), "issue")).toBeUndefined();
  });
});
