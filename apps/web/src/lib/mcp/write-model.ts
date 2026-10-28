/**
 * Types for the MCP write tools (docs/20-CLAUDE-MCP.md FR-4). No database here; `reader.ts` implements the writer with the
 * caller's own token, and the tests use a stand-in.
 */
import type { FileRepo, UpdateCurrent, WriteCtx } from "@pv/domain";
import type { DocInfo, FileInfo } from "./read-model";

/** One all-or-nothing group of writes handed to `mcp_apply` (migration 0045). */
export type ApplyUnit = { ops: Record<string, unknown>[] };
export type UnitResult = { ok: true; ops: { id?: string; code?: string }[] } | { ok: false; error: string };
export type ApplyResult = { change_set: string; units: UnitResult[] };

/** One field of a held update, as stored with the pending diff: what to compare with on confirmation and the writes to make. */
export type PendingChange = { item_id: string; code: string; field: string; label: string; before: unknown; ops: Record<string, unknown>[] };
export type PendingRow = { id: string; changes: PendingChange[]; expires_at: string; applied_at: string | null };
export type UndoResult = { undone: boolean; message?: string; tool?: string; reverted?: number; skipped?: string[]; at?: string };

export type CurrentItem = UpdateCurrent & { id: string; code: string };

/** A stored file as the file tools need it. */
export type StoredFile = { id: string; item_id: string; item_code: string; name: string; share_token: string | null };

/** Files, as the signed-in person: rows are written with the person's token (so the role check, row-level security and the audit log apply); bytes go to the private store. */
export type McpFiles = {
  /** One file by id, or null when it does not exist in this workspace or cannot be read. */
  get: (id: string) => Promise<StoredFile | null>;
  /** Stores the bytes and the row. Throws ToolInputError when the role or the database refuses. */
  add: (item: { id: string; code: string }, name: string, bytes: Uint8Array, mime: string) => Promise<FileInfo>;
  /** Switches the share link on (new token) or off; returns the new address or null. */
  setSharing: (file: StoredFile, on: boolean) => Promise<string | null>;
  remove: (file: StoredFile) => Promise<void>;
  /** The repository the item would be pushed to and whether it is private. */
  repoFor: (itemId: string) => Promise<FileRepo>;
};

/** Documents, as the signed-in person: rows are written with the person's token, so the role check, row-level security, the version log and the audit apply. */
export type McpDocuments = {
  /** Adds a document to an initiative. Throws ToolInputError when the role or the database refuses. */
  create: (item: { id: string; code: string }, doc: { kind: string; title: string; body: string; status?: string }) => Promise<DocInfo>;
  /** Changes a document that is still at `expectedVersion`. Returns `conflict` (with the current version) when somebody saved in between; nothing is written then. */
  update: (id: string, expectedVersion: number, patch: { kind?: string; title?: string; body?: string; status?: string }) => Promise<{ ok: true; doc: DocInfo } | { ok: false; reason: "missing" } | { ok: false; reason: "conflict"; current: DocInfo }>;
};

/** Writing the workspace as the signed-in person. Every method runs with the person's own token (no service role). */
export type McpWriter = {
  /** What validation needs to know about the workspace. */
  context: (role: string) => Promise<WriteCtx>;
  /** The stored values of one initiative (by code or id), or null when it does not exist or cannot be read. */
  current: (ref: string) => Promise<CurrentItem | null>;
  /** Applies units as one change set. `pending` takes a held diff in the same transaction. Throws ToolInputError for refusals worth showing. */
  apply: (tool: string, units: ApplyUnit[], opts?: { allOrNothing?: boolean; pending?: string }) => Promise<ApplyResult>;
  /** Holds a diff for confirmation for ten minutes. */
  savePending: (diff: unknown, changes: PendingChange[]) => Promise<{ id: string; expires_at: string }>;
  loadPending: (id: string) => Promise<PendingRow | null>;
  /** Reverses the last change set made through this connection. */
  undo: () => Promise<UndoResult>;
  files: McpFiles;
  documents: McpDocuments;
};
