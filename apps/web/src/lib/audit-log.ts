/**
 * Audit log display and export (R-111 FR-6). Pure functions, so the rules are tested without a database.
 * An entry always shows who (name AND email, as they were at the time), role at the time, when, where, what and how.
 */
export type AuditRow = {
  id: number;
  tenant_id: string;
  entity: string;
  entity_id: string | null;
  field: string;
  old: unknown;
  new: unknown;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_platform_admin: boolean;
  project_id: string | null;
  screen: string | null;
  batch_id: string | null;
  via: string;
  at: string;
};

export type AuditFilters = { actor?: string; action?: string; project?: string; from?: string; to?: string; before?: string };

const ROLE_AT_TIME: Record<string, string> = {
  admin: "Account Admin", creator: "Creator", commenter: "Commenter", viewer: "Viewer", leadership: "Leadership viewer", platform_admin: "Platform admin",
};
export const roleAtTime = (r: string | null) => (r ? ROLE_AT_TIME[r] ?? r : "—");

const ENTITY_LABEL: Record<string, string> = {
  items: "Initiative", projects: "Project", tenants: "Account", tenant_members: "Member", invitations: "Invitation", platform_access: "Platform access",
  saved_views: "View", saved_scopes: "Scope", teams: "Team", item_groups: "Group", item_links: "Link", item_files: "File", mcp_connections: "Claude connection",
  github_connections: "GitHub connection", github_repositories: "GitHub repository",
};
export const entityLabel = (e: string) => ENTITY_LABEL[e] ?? e.replace(/_/g, " ");

const VIA_LABEL: Record<string, string> = { UI: "UI", API: "API", "Claude MCP": "Claude", "GitHub webhook": "GitHub webhook", import: "Import", system: "System" };
export const viaLabel = (v: string) => VIA_LABEL[v] ?? v;

/** Who, for one line: "Name (email)"; system entries say so, and old entries from before snapshots say that too. */
export function whoLabel(r: Pick<AuditRow, "actor_id" | "actor_name" | "actor_email" | "via">): string {
  if (r.actor_email || r.actor_name) return `${r.actor_name ?? ""}${r.actor_email ? ` (${r.actor_email})` : ""}`.trim();
  if (r.actor_id) return "Unknown person (before names were recorded)";
  return r.via === "GitHub webhook" ? "GitHub (automatic)" : "System (automatic)";
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** The change as one phrase: what happened to which field. Entering and leaving an account are events, not field changes. */
export function actionLabel(r: Pick<AuditRow, "entity" | "field" | "old" | "new">): string {
  if (r.entity === "platform_access") {
    if (r.field === "entered") return "Entered the account";
    if (r.field === "left") return "Left the account";
    if (r.field === "account_access_level") return "Changed platform access level for this account";
  }
  return `${entityLabel(r.entity)} · ${r.field.replace(/_/g, " ")}`;
}

/** Filters from the address bar, cleaned. Dates are yyyy-mm-dd; `to` is inclusive, so the query uses the next day. */
export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim().slice(0, 120) : undefined;
  };
  const date = (k: string) => { const s = one(k); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; };
  const uuid = (k: string) => { const s = one(k); return s && /^[0-9a-f-]{36}$/i.test(s) ? s : undefined; };
  const before = one("before");
  return { actor: one("actor"), action: one("action"), project: uuid("project"), from: date("from"), to: date("to"), before: before && /^\d{1,18}$/.test(before) ? before : undefined };
}

export function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Cells that start with = + - @ would run as formulas in a spreadsheet; a leading apostrophe makes them text. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type AuditLookup = { accounts?: Record<string, string>; projects?: Record<string, string>; objects?: Record<string, string> };

const CSV_HEADER = ["When (UTC)", "Person", "Email", "Role at the time", "Platform admin", "Account", "Project", "Object", "Screen", "Action", "Field", "Old value", "New value", "How", "Batch", "Entry id"];

export function auditCsv(rows: AuditRow[], lookup: AuditLookup = {}): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.at, r.actor_name ?? (r.actor_id ? "" : "System"), r.actor_email ?? "", roleAtTime(r.actor_role), r.actor_platform_admin ? "yes" : "no",
      lookup.accounts?.[r.tenant_id] ?? r.tenant_id, r.project_id ? lookup.projects?.[r.project_id] ?? r.project_id : "",
      r.entity_id ? lookup.objects?.[r.entity_id] ?? `${entityLabel(r.entity)} ${r.entity_id}` : entityLabel(r.entity), r.screen ?? "",
      actionLabel(r), r.field, formatValue(r.old) === "—" ? "" : formatValue(r.old), formatValue(r.new) === "—" ? "" : formatValue(r.new),
      viaLabel(r.via), r.batch_id ?? "", r.id,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** "28 Oct 2026, 14:03:22 UTC": a timestamp with its time zone (FR-6.2). Falls back to UTC for a zone the runtime does not know. */
export function formatWhen(iso: string | null, timeZone = "UTC", seconds = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(d);
  }
}
