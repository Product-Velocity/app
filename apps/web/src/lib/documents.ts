// What the document routes return. Plain data, safe to import from routes and tests.
export const DOC_COLS = "id, item_id, kind, title, status, version, ai_draft, updated_at, approved_at, body";
export type DocRow = { id: string; item_id: string; kind: string; title: string; status: string; version: number; ai_draft: boolean; updated_at: string; approved_at: string | null; body: string };
export type DocView = { id: string; kind: string; title: string; status: string; version: number; aiDraft: boolean; characters: number; updatedAt: string; approvedAt: string | null; body?: string };

export const toDoc = (r: DocRow, withBody = false): DocView => ({
  id: r.id, kind: r.kind, title: r.title, status: r.status, version: r.version, aiDraft: r.ai_draft,
  characters: r.body.length, updatedAt: r.updated_at, approvedAt: r.approved_at, ...(withBody ? { body: r.body } : {}),
});
