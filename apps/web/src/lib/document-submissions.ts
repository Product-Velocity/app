/**
 * The document-submission log (request #230): one row per saved version of a document, for the account's admins and for platform admins.
 * Titles and names only, never the text. Pure helpers here; the database functions `document_submissions` and `platform_document_submissions` decide who may read.
 */
import { AI_TOOL_LABEL, DOC_KIND_LABEL } from "@pv/domain";

export type DocSubmission = {
  version_id: string; document_id: string; item_id: string; item_code: string; initiative_name: string; project_id: string | null; project_name: string | null;
  tenant_id: string; tenant_name: string; kind: string; title: string; version: number; saved_via: string; ai_tool: string | null; ai_model: string | null;
  saved_at: string; saved_by: string | null; person_name: string | null; person_email: string | null;
};

export const SUBMISSIONS_PAGE = 50;

/** "Created" for version 1, "Updated (v3)" after that. */
export const submissionAction = (s: Pick<DocSubmission, "version">) => (s.version === 1 ? "Created" : `Updated (v${s.version})`);

export const docTypeLabel = (kind: string) => DOC_KIND_LABEL[kind as keyof typeof DOC_KIND_LABEL] ?? kind;

/** "Claude (Claude Opus 5.5)", or "Person" when no AI tool wrote this version. */
export function writtenWith(s: Pick<DocSubmission, "ai_tool" | "ai_model">): string {
  if (!s.ai_tool) return "Person";
  return `${AI_TOOL_LABEL[s.ai_tool] ?? s.ai_tool}${s.ai_model ? ` (${s.ai_model})` : ""}`;
}

/** Who saved it: "Name (email)"; an old row from before names were kept says so. */
export function submittedBy(s: Pick<DocSubmission, "saved_by" | "person_name" | "person_email">): string {
  if (s.person_name || s.person_email) return `${s.person_name ?? ""}${s.person_email ? ` (${s.person_email})` : ""}`.trim();
  return s.saved_by ? "Former member" : "System";
}

/** Opens the initiative's Spec tab on that document. It works for people in the account, and for a platform admin who has entered it. */
export const documentLink = (s: Pick<DocSubmission, "item_code" | "document_id">) =>
  `/portfolio?item=${encodeURIComponent(s.item_code)}&tab=spec&doc=${encodeURIComponent(s.document_id)}`;

/** Parses the `before` cursor of the page address: an ISO timestamp, or nothing. */
export function parseBefore(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(s)) return undefined;
  return Number.isNaN(Date.parse(s)) ? undefined : s;
}
