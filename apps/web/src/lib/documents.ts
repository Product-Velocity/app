// What the document routes return. Plain data, safe to import from routes and tests.
export const DOC_COLS = "id, item_id, kind, title, status, version, ai_draft, updated_at, approved_at, ai_tool, ai_model, shared, share_token, body";
export type DocRow = { id: string; item_id: string; kind: string; title: string; status: string; version: number; ai_draft: boolean; updated_at: string; approved_at: string | null; ai_tool: string | null; ai_model: string | null; shared: boolean; share_token: string | null; body: string };
export type DocView = { id: string; kind: string; title: string; status: string; version: number; aiDraft: boolean; characters: number; updatedAt: string; approvedAt: string | null; aiTool: string | null; aiModel: string | null; /** Goes into the GitHub issue / Jira description (default); false = "Do not share". */ shared: boolean; /** The public address (no login) of a shared document; null when it is not shared or is an AI draft nobody has accepted. */ shareUrl: string | null; body?: string };

import { documentUrl } from "@/lib/files/serve";
export const toDoc = (r: DocRow, withBody = false, appUrl = ""): DocView => ({
  id: r.id, kind: r.kind, title: r.title, status: r.status, version: r.version, aiDraft: r.ai_draft,
  characters: r.body.length, updatedAt: r.updated_at, approvedAt: r.approved_at, aiTool: r.ai_tool, aiModel: r.ai_model, shared: r.shared !== false, shareUrl: r.share_token && appUrl ? documentUrl(appUrl, r.share_token, r.title) : null, ...(withBody ? { body: r.body } : {}),
});
