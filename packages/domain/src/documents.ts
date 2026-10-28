// Documents on an initiative (R-113, docs/22-CLAUDE-PRD-FLOW.md). What may be stored and how input is checked.
// A document is Markdown kept in Product Velocity. It is never read for a GitHub payload.

export const DOC_KINDS = ["prd", "business_req", "tech_req", "acceptance", "prototype", "research", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
/** Statuses Claude may set. "approved" is a person with the Approver permission, never Claude (CLAUDE.md rule 3). */
export const DOC_STATUSES = ["draft", "in_review", "approved"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const CLAUDE_DOC_STATUSES = ["draft", "in_review"] as const;

export const MAX_DOC_CHARS = 200_000;
export const MAX_DOC_TITLE = 200;
export const MAX_DOCS_PER_ITEM = 20;

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  prd: "PRD", business_req: "Business requirements", tech_req: "Technical requirements", acceptance: "Acceptance criteria",
  prototype: "Prototype", research: "Research", other: "Other",
};

export type DocInput = { kind?: unknown; title?: unknown; body?: unknown; status?: unknown };
export type DocCheck =
  | { ok: true; value: { kind?: DocKind; title?: string; body?: string; status?: "draft" | "in_review" } }
  | { ok: false; error: string };

/** Checks what Claude (or the panel) sends. Messages are written for Claude and shown as they are. */
export function checkDocumentInput(input: DocInput, opts: { requireTitle: boolean }): DocCheck {
  const value: { kind?: DocKind; title?: string; body?: string; status?: "draft" | "in_review" } = {};
  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !(DOC_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: `kind must be one of: ${DOC_KINDS.join(", ")}.` };
    value.kind = input.kind as DocKind;
  }
  if (input.title !== undefined || opts.requireTitle) {
    const t = typeof input.title === "string" ? input.title.trim() : "";
    if (!t) return { ok: false, error: "Give the document a title, such as \"PRD: Account switcher\"." };
    if (t.length > MAX_DOC_TITLE) return { ok: false, error: `The title is longer than ${MAX_DOC_TITLE} characters.` };
    value.title = t;
  }
  if (input.body !== undefined) {
    if (typeof input.body !== "string") return { ok: false, error: "body must be Markdown text." };
    if (input.body.length > MAX_DOC_CHARS) return { ok: false, error: `The document is ${input.body.length.toLocaleString("en")} characters; the limit is ${MAX_DOC_CHARS.toLocaleString("en")}. Split it into two documents.` };
    value.body = input.body;
  }
  if (input.status !== undefined) {
    if (input.status === "approved") return { ok: false, error: "Only a person with the Approver permission can approve a document, in Product Velocity. Leave the status as draft or in_review." };
    if (!(CLAUDE_DOC_STATUSES as readonly string[]).includes(String(input.status))) return { ok: false, error: `status must be one of: ${CLAUDE_DOC_STATUSES.join(", ")}.` };
    value.status = input.status as "draft" | "in_review";
  }
  return { ok: true, value };
}
