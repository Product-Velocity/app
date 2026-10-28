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
