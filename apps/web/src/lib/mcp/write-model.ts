/**
 * Types for the MCP write tools (docs/20-CLAUDE-MCP.md FR-4). No database here; `reader.ts` implements the writer with the
 * caller's own token, and the tests use a stand-in.
 */
import type { FileRepo, ProfileSections, UpdateCurrent, WriteCtx } from "@pv/domain";
import type { CompanyProfileData, DocInfo, FileInfo } from "./read-model";

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

/** Jira epic keys asked for under an initiative, as the signed-in person (the database function of the Jira tab: role, ownership and audit apply). Records only; nothing is sent to Jira. */
export type McpEpics = {
  /** Records the keys; `added` are the ones that were new (or asked for again after a failure). Throws ToolInputError with the database's reason (read-only initiative, no Jira project, key taken by another initiative). */
  request: (itemId: string, keys: string[]) => Promise<{ added: string[]; current: { key: string; state: string; last_error: string | null }[] }>;
};

/** Outcome metrics a person stated, recorded as the signed-in person (the database function of the Claude route: role, "never overwrite a recorded checkpoint" and the audit apply). Never requests metrics. */
export type McpOutcomes = {
  /** Records one checkpoint with the person's words. Throws ToolInputError with the database's reason (already recorded, no Start Roll-Out, role). */
  record: (itemId: string, days: 30 | 60 | 90, v: { value: number | null; adoption: number | null; note: string | null; words: string }) => Promise<void>;
};

/** Documents, as the signed-in person: rows are written with the person's token, so the role check, row-level security, the version log and the audit apply. */
export type McpDocuments = {
  /** Adds a document to an initiative, or to the workspace itself when item is null. Throws ToolInputError when the role or the database refuses. */
  create: (item: { id: string; code: string } | null, doc: { kind: string; title: string; body: string; status?: string; ai_model?: string | null }) => Promise<DocInfo>;
  /** Changes a document that is still at `expectedVersion`. Returns `conflict` (with the current version) when somebody saved in between; nothing is written then. */
  update: (id: string, expectedVersion: number, patch: { kind?: string; title?: string; body?: string; status?: string; ai_model?: string | null }) => Promise<{ ok: true; doc: DocInfo } | { ok: false; reason: "missing" } | { ok: false; reason: "conflict"; current: DocInfo }>;
};

/** Asking for a document to be published to Confluence (issue #693 slice C). It records a request only: nothing is sent, and a person confirms in the app (CLAUDE.md rule 3). */
export type McpPublishRequests = {
  /** Records (or replaces) the open request of a document. Throws ToolInputError when the role or the database refuses. */
  set: (doc: { id: string; itemId: string }, request: { mode: "once" | "sync"; spaceKey: string | null; parentUrl: string | null; title: string | null; note: string | null; aiModel: string | null }) => Promise<void>;
  /** Removes the open request of a document; false when there was none. */
  withdraw: (documentId: string) => Promise<boolean>;
};

/** Asking for a Confluence page to be read in, or a document to be updated from its page (issue #721). It records a request only: nothing is read or changed, and a person confirms in the app. */
export type McpReadRequests = {
  /** Records (or replaces) the open import request of a page on an initiative. Throws ToolInputError when the role or the database refuses. */
  setImport: (itemId: string, request: { pageUrl: string; docKind: string | null; mode: "once" | "sync"; direction: "from_confluence" | "both"; note: string | null; aiModel: string | null }) => Promise<void>;
  /** Records (or replaces) the open refresh request of a document. */
  setRefresh: (doc: { id: string; itemId: string }, request: { note: string | null; aiModel: string | null }) => Promise<void>;
  /** Removes an open request (an import by initiative and page address, a refresh by document); false when there was none. */
  withdraw: (target: { itemId: string; pageUrl: string } | { documentId: string }) => Promise<boolean>;
};

/** The company profile, as the signed-in person. Confirming it is never offered here: only a workspace admin does, in the app. */
export type McpProfile = {
  /** Saves the first profile as a draft. Throws ToolInputError when it already exists or the role refuses. */
  create: (sections: ProfileSections, researched: boolean) => Promise<NonNullable<CompanyProfileData["profile"]>>;
  /** Replaces the sections of the profile still at `expectedVersion`; `conflict` (with the current profile) when somebody saved in between. */
  update: (expectedVersion: number, sections: ProfileSections, researched: boolean) => Promise<{ ok: true; profile: NonNullable<CompanyProfileData["profile"]> } | { ok: false; reason: "conflict"; current: NonNullable<CompanyProfileData["profile"]> | null }>;
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
  publishRequests: McpPublishRequests;
  readRequests: McpReadRequests;
  profile: McpProfile;
  epics: McpEpics;
  outcomes: McpOutcomes;
};
