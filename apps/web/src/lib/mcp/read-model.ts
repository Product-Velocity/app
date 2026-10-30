/**
 * Pure shaping for the MCP read tools (docs/20-CLAUDE-MCP.md FR-2, FR-3): what a workspace looks like to Claude.
 * No database here; `reader.ts` fetches and these functions present.
 */
import { claudeAllowances, FIELD_BY_KEY, type MemoryRow, type ProfileSections, type ProfileSummary, type SearchNames, type SearchRow } from "@pv/domain";
import { OUTBOUND_READ_FIELDS } from "@pv/github";

export type Member = { id: string; name: string; role: string };
export type WorkspaceContext = {
  workspace: { id: string; name: string };
  you: { id: string; role: string; may: string[]; may_not: string[] };
  projects: { id: string; name: string; default_repo: string | null; tracker: string | null; github: { connected: boolean; repo_private: boolean | null } }[];
  groups: string[];
  /** The values in use of the open-list fields (Focus Area, Audience), so Claude reuses an existing spelling (issue #246). */
  open_lists?: Record<string, string[]>;
  teams: { id: string; name: string }[];
  members: Member[];
  cycles: { id: string; name: string }[];
  /** The company website and what is known about the company (issue #269): read get_company_profile before writing a PRD or discovery. */
  company?: { url: string | null; profile: ProfileSummary };
  /** What the assistant memory holds (counts only; use recall for the notes). */
  memory?: { total: number; by_kind: Record<string, number>; stale: number; unconfirmed: number };
  notes: string[];
};

/** Fields that may be written into a GitHub issue or board: the outbound allowlist plus the link list (docs/04, CLAUDE.md rule 2). */
const REACH = new Set<string>([...OUTBOUND_READ_FIELDS, "artifacts"]);
export const reachesGithub = (key: string) => REACH.has(key);

/** Row keys that are bookkeeping, not fields of the dictionary. */
const INTERNAL_KEYS = new Set(["_created_by"]);

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * One initiative as Claude reads it: ids in person and project fields become names (the names the filters accept),
 * bookkeeping keys are dropped, and empty values are left out unless `keepEmpty` is set.
 */
export function presentRow(row: SearchRow, names: SearchNames, opts: { keepEmpty?: boolean; only?: readonly string[] | "all" } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const only = opts.only && opts.only !== "all" ? new Set(opts.only) : null;
  for (const [k, v] of Object.entries(row)) {
    if (INTERNAL_KEYS.has(k)) continue;
    if (k !== "id" && only && !only.has(k)) continue;
    if (!opts.keepEmpty && empty(v) && k !== "id") continue;
    out[k] = k === "id" ? v : resolveName(k, v, names);
  }
  return out;
}

function resolveName(key: string, v: unknown, names: SearchNames): unknown {
  if (typeof v !== "string") return v;
  if (key === "home_project") return names.projects.find((p) => p.id === v)?.name ?? v;
  if (FIELD_BY_KEY[key]?.type === "Person") return names.members.find((m) => m.id === v)?.name ?? v;
  return v;
}

/** The text of a field value, cut for the activity list (descriptions can be 20,000 characters). */
export const clip = (v: unknown, max = 200): unknown => (typeof v === "string" && v.length > max ? `${v.slice(0, max)}… (${v.length.toLocaleString("en-US")} characters)` : v);

/** Assembles the workspace context. `repoPrivate` says, per repository (lower-case full name), whether it is private. */
export function buildContext(i: {
  tenant: { id: string; name: string }; userId: string; role: string;
  projects: { id: string; name: string; default_repo: string | null; tracker: string | null }[];
  groups: string[]; teams: { id: string; name: string }[]; members: Member[];
  openLists?: Record<string, string[]>;
  company?: { url: string | null; profile: ProfileSummary };
  memory?: WorkspaceContext["memory"];
  githubConnected: boolean; repoPrivate: ReadonlyMap<string, boolean>;
}): WorkspaceContext {
  const a = claudeAllowances(i.role);
  return {
    workspace: i.tenant,
    you: { id: i.userId, role: i.role, may: a.can, may_not: a.cannot },
    projects: i.projects.map((p) => ({
      ...p,
      github: { connected: i.githubConnected && p.tracker !== "jira" && p.tracker !== "gitlab", repo_private: p.default_repo ? i.repoPrivate.get(p.default_repo.toLowerCase()) ?? null : null },
    })),
    groups: i.groups, ...(i.openLists ? { open_lists: i.openLists } : {}), ...(i.company ? { company: i.company } : {}), ...(i.memory ? { memory: i.memory } : {}), teams: i.teams, members: i.members,
    cycles: [],
    notes: ["Planning cycles arrive in a later phase, so there are none yet.", "A person's name is the email address they signed up with; filters accept it."],
  };
}

// ---------------------------------------------------------------- what the reader returns
export type FileInfo = { id: string; item_code: string; name: string; mime: string | null; size: number | null; shared: boolean; share_url: string | null };
export type ViewInfo = {
  id: string | null; name: string; scope: "workspace" | "private" | "built-in"; columns: string[];
  filters: unknown[]; group_by: string | null; sort: unknown; customer_safe: boolean; customises?: string;
};
export type ItemDetail = {
  row: SearchRow;
  links: { label: string; url: string }[];
  tags: Record<string, string[]>;
  /** Related initiatives by code and name. */
  relations: { depends_on: { code: string; name: string }[]; depended_on_by: { code: string; name: string }[]; related_to: { code: string; name: string }[] };
  teams: string[];
  files: FileInfo[];
  github: { issue_number: number | null; url: string | null; mode: string; state: string; error: string | null; github_state: string | null; last_activity: string | null } | null;
  activity: { at: string; field: string; old: unknown; new: unknown; by: string | null; via: string }[];
};
/** A document on an initiative. `body` is only present when one document is read. */
export type DocInfo = {
  id: string; item_code: string; kind: string; title: string; status: string; version: number; ai_draft: boolean;
  characters: number; updated_at: string; approved_at: string | null; body?: string;
};
/** The company profile as stored (issue #269). `profile` is null until one exists. */
export type CompanyProfileData = {
  url: string | null;
  profile: { status: string; version: number; ai_draft: boolean; researched_at: string | null; confirmed_at: string | null; updated_at: string; sections: ProfileSections } | null;
};
/** Reading the workspace as the signed-in person. Every method runs with the person's own token, so row-level security applies. */
export type McpReader = {
  /** All initiatives in global rank order, the names behind their ids, and who "me" is. */
  searchData: () => Promise<{ rows: SearchRow[]; names: SearchNames; me: string }>;
  /** One initiative by code (R-12, any case) or id; null when it does not exist or cannot be read. */
  itemDetail: (ref: string) => Promise<ItemDetail | null>;
  groups: () => Promise<{ name: string; items: number }[]>;
  views: () => Promise<ViewInfo[]>;
  /** Files of one initiative, or null when that initiative does not exist; with no reference, files of the whole workspace (capped). */
  files: (ref?: string) => Promise<{ files: FileInfo[]; truncated: boolean } | null>;
  /** Documents of one initiative (no text), or null when that initiative does not exist. */
  documents: (ref: string) => Promise<DocInfo[] | null>;
  /** One document with its text, or null when it does not exist or cannot be read. */
  document: (id: string) => Promise<DocInfo | null>;
  /** The company website and profile of this workspace. */
  companyProfile: () => Promise<CompanyProfileData>;
  /** The saved notes of this workspace (docs/27): live ones, or every one with includeArchived. Empty before the migration is applied. */
  memories: (opts?: { includeArchived?: boolean }) => Promise<MemoryRow[]>;
  /** One note by id, or null. */
  memory: (id: string) => Promise<MemoryRow | null>;
};
