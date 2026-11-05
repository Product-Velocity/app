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
// Documents in the delivery platforms (issue #325, Ashu 2026-11-05: CLAUDE.md rule 2). A document is shared with the GitHub issue and the Jira
// description unless the person chose "Do not share". The text goes in as a last section, "Documents". Both trackers are read back by their
// headings, so nothing a document says may look like one of those headings: its own headings are moved down to level 4 and below.
// ---------------------------------------------------------------------------------------------------------------------------------------

export type SharedDoc = { title: string; kind: string; status: string; body: string; aiDraft: boolean };
const STATUS_WORD: Record<string, string> = { draft: "Draft", in_review: "In review", approved: "Approved" };
const ZWSP = "\u200b";

/** Markdown with every heading at level 4 to 6, so it can never be read as a section of ours (level 2 in Jira, "## " lines in GitHub). Code blocks keep their text. */
export function demoteHeadings(md: string): string {
  let fence: string | null = null;
  return md.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { if (fence === null) fence = f[1]![0]!; else if (f[1]![0] === fence) fence = null; return line; }
    if (fence !== null) return /^#{1,6}\s/.test(line) ? ZWSP + line : line; // inside code: not a heading, and not mistaken for one either
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    return h ? `${"#".repeat(Math.min(6, h[1]!.length + 3))} ${h[2]}` : line;
  }).join("\n");
}

/**
 * The Markdown that goes under "Documents": one block per shared document (title, kind, status, text), in the order given, cut so that the whole
 * stays within `budget` characters. A document that does not fit is cut at a line with a note that the full text is in Product Velocity; those that
 * come after it are named. Returns "" when there is nothing to send.
 */
export function documentsMarkdown(docs: readonly SharedDoc[], budget: number): string {
  const out: string[] = [];
  const omitted: string[] = [];
  let left = Math.max(0, budget);
  const CUT = "_Cut here to fit. The full document is in Product Velocity._";
  for (const d of docs) {
    const title = d.title.replace(/\s+/g, " ").replace(/^#+\s*/, "").trim() || "Untitled";
    const kind = DOC_KIND_LABEL[d.kind as DocKind] ?? d.kind;
    const meta = `_${STATUS_WORD[d.status] ?? d.status}${d.aiDraft ? " · AI draft, not yet reviewed" : ""}_`;
    const head = `### ${title} (${kind})\n${meta}`;
    const body = demoteHeadings(d.body).trim();
    const whole = body ? `${head}\n\n${body}` : head;
    if (omitted.length === 0 && whole.length + 2 <= left) { out.push(whole); left -= whole.length + 2; continue; }
    if (omitted.length === 0 && body && left > head.length + CUT.length + 400) {
      const room = left - head.length - CUT.length - 6;
      const cut = body.slice(0, room);
      const at = cut.lastIndexOf("\n");
      out.push(`${head}\n\n${(at > room / 2 ? cut.slice(0, at) : cut).trimEnd()}\n\n${CUT}`);
      left = 0;
      continue;
    }
    omitted.push(title);
  }
  if (omitted.length > 0) out.push(`_Not included, too long for the issue: ${omitted.join(", ")}. They are in Product Velocity._`);
  return out.join("\n\n");
}
