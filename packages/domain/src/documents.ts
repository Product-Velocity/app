// Documents on an initiative (R-113, docs/22-CLAUDE-PRD-FLOW.md). What may be stored and how input is checked.
// A document is Markdown kept in Product Velocity. It is never read for a GitHub payload.

export const DOC_KINDS = ["prd", "discovery", "business_req", "tech_req", "acceptance", "prototype", "research", "design", "customer_evidence", "meeting_notes", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
/** Statuses Claude may set. "approved" is a person with the Approver permission, never Claude (CLAUDE.md rule 3). */
export const DOC_STATUSES = ["draft", "in_review", "approved"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const CLAUDE_DOC_STATUSES = ["draft", "in_review"] as const;

export const MAX_DOC_CHARS = 200_000;
export const MAX_DOC_TITLE = 200;
export const MAX_DOCS_PER_ITEM = 20;
/** The AI model an assistant says it is (free text, advisory: it is what the assistant reports about itself). */
export const MAX_AI_MODEL = 80;

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  prd: "PRD", discovery: "Discovery", business_req: "Business requirements", tech_req: "Technical requirements", acceptance: "Acceptance criteria",
  prototype: "Prototype", research: "Research", design: "Design", customer_evidence: "Customer evidence", meeting_notes: "Meeting notes", other: "Other",
};

export type DocInput = { kind?: unknown; title?: unknown; body?: unknown; status?: unknown; ai_model?: unknown };
export type DocCheck =
  | { ok: true; value: { kind?: DocKind; title?: string; body?: string; status?: "draft" | "in_review"; ai_model?: string | null } }
  | { ok: false; error: string };

/** Checks what Claude (or the panel) sends. Messages are written for Claude and shown as they are. */
export function checkDocumentInput(input: DocInput, opts: { requireTitle: boolean }): DocCheck {
  const value: { kind?: DocKind; title?: string; body?: string; status?: "draft" | "in_review"; ai_model?: string | null } = {};
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
  if (input.ai_model !== undefined && input.ai_model !== null) {
    if (typeof input.ai_model !== "string") return { ok: false, error: "ai_model must be text, such as \"Claude Opus 5.5\"." };
    const m = input.ai_model.replace(/\s+/g, " ").trim();
    // control characters and markup have no place in a model name that is later shown in lists and exports
    if (m.length > MAX_AI_MODEL || /[\u0000-\u001f<>]/.test(m)) return { ok: false, error: `ai_model is the name of the model you are, at most ${MAX_AI_MODEL} characters, plain text.` };
    value.ai_model = m === "" ? null : m;
  }
  return { ok: true, value };
}

export const AI_TOOL_LABEL: Record<string, string> = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", other: "Other AI tool" };

// ---------------------------------------------------------------------------------------------------------------------------------------
// Documents in the delivery platforms (issue #325, Ashu 2026-11-06: CLAUDE.md rule 2). A document is shared with the GitHub issue and the Jira
// description as its name plus a public link (no login), like a file, unless the person chose "Do not share". The text itself never goes into the
// tracker: the link opens a read-only page of the current text in Product Velocity.
// ---------------------------------------------------------------------------------------------------------------------------------------

const STATUS_WORD: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };

export type DocLinkInput = { title: string; kind: string; status: string; /** Whether there is any text: a document without text is not worth a link. */ hasText: boolean; url: string };
export type DocumentLinks = {
  /** For the section "Documents": the label ("PRD: Brief (PRD, Approved)") and the public address. */
  links: { label: string; url: string }[];
  sent: string[];
  /** Skipped: no text yet. */
  empty: string[];
};

export function documentLinks(docs: readonly DocLinkInput[]): DocumentLinks {
  const r: DocumentLinks = { links: [], sent: [], empty: [] };
  for (const d of docs) {
    const title = d.title.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").trim() || "Untitled";
    if (!d.hasText) { r.empty.push(title); continue; }
    const kind = DOC_KIND_LABEL[d.kind as DocKind] ?? d.kind;
    r.links.push({ label: `${title} (${kind}, ${STATUS_WORD[d.status] ?? d.status})`, url: d.url });
    r.sent.push(title);
  }
  return r;
}

/** One sentence for the Sync preview: which document links go, which do not. Undefined when the initiative has no shared document. */
export function documentsPreviewNote(r: DocumentLinks, where: string): string | undefined {
  if (r.sent.length + r.empty.length === 0) return undefined;
  const parts: string[] = [r.sent.length > 0 ? `Document links in the ${where}: ${r.sent.join(", ")}.` : `No document link goes into the ${where}.`];
  if (r.empty.length > 0) parts.push(`Skipped, no text yet: ${r.empty.join(", ")}.`);
  return parts.join(" ");
}
