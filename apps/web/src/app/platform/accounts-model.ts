// The All accounts console, as plain data and rules (no React, so it is unit-tested). Platform admins only; see docs/15 section 5c.

export type AiAgent = { name: string; connections: number; last_used_at: string | null; calls: number };

export type AccountRow = {
  tenant_id: string;
  name: string;
  plan: string;
  owner_email: string | null;
  owner_name: string | null;
  member_count: number;
  requested_count: number;
  invited_count: number;
  project_count: number;
  item_count: number;
  last_activity: string | null;
  last_login_at: string | null;
  access_override: string | null;
  created_at: string;
  company_url: string | null;
  country: string | null;
  claude_enabled: boolean;
  ai_agents: AiAgent[];
  github_state: string | null;
  jira_state: string | null;
  suspended_at: string | null;
};

export type MemberRow = {
  kind: "member" | "invitation";
  member_id: string | null;
  invitation_id: string | null;
  email: string;
  name: string | null;
  role: string;
  is_approver: boolean;
  is_service_account: boolean;
  status: "requested" | "invited" | "active" | "paused" | "revoked";
  created_at: string;
  last_login_at: string | null;
  expires_at: string | null;
  email_status: string | null;
  ai_agents: string[];
};

export const CHIPS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "agents", label: "AI agents connected" },
  { id: "requests", label: "Access requests waiting" },
  { id: "quiet", label: "No activity in 30 days" },
] as const;
export type ChipId = (typeof CHIPS)[number]["id"];

const DAY = 86_400_000;

export const isPaused = (r: Pick<AccountRow, "suspended_at">) => r.suspended_at !== null;
export const statusLabel = (r: Pick<AccountRow, "suspended_at">) => (isPaused(r) ? "Paused" : "Active");

export function chipMatches(r: AccountRow, chip: ChipId, now = Date.now()): boolean {
  switch (chip) {
    case "all": return true;
    case "active": return !isPaused(r);
    case "paused": return isPaused(r);
    case "agents": return r.ai_agents.length > 0;
    case "requests": return r.requested_count > 0;
    case "quiet": return !r.last_activity || now - Date.parse(r.last_activity) > 30 * DAY;
  }
}

export function chipCounts(rows: readonly AccountRow[], now = Date.now()): Record<ChipId, number> {
  const out = { all: 0, active: 0, paused: 0, agents: 0, requests: 0, quiet: 0 } as Record<ChipId, number>;
  for (const r of rows) for (const c of CHIPS) if (chipMatches(r, c.id, now)) out[c.id] += 1;
  return out;
}

/** Counts for the strip above the grid. Items and members are summed over the accounts given, so a filter narrows them. */
export function totals(rows: readonly AccountRow[]) {
  return rows.reduce(
    (t, r) => ({
      accounts: t.accounts + 1,
      paused: t.paused + (isPaused(r) ? 1 : 0),
      members: t.members + r.member_count,
      items: t.items + r.item_count,
      withAgents: t.withAgents + (r.ai_agents.length > 0 ? 1 : 0),
    }),
    { accounts: 0, paused: 0, members: 0, items: 0, withAgents: 0 },
  );
}

/** "Claude Desktop, Cursor"; with none, says whether the workspace has switched Claude on at all. */
export function agentsText(r: Pick<AccountRow, "ai_agents" | "claude_enabled">): string {
  if (r.ai_agents.length > 0) return r.ai_agents.map((a) => (a.connections > 1 ? `${a.name} ×${a.connections}` : a.name)).join(", ");
  return r.claude_enabled ? "Claude on, none connected" : "None";
}

/** The words of a tracker connection state (GitHub: connected, requested, waiting_approval, installing, suspended, disconnected; Jira: connected, reconnect_needed, disconnected). */
export function trackerText(state: string | null): string {
  switch (state) {
    case null: return "Not connected";
    case "connected": return "Connected";
    case "reconnect_needed": return "Reconnect needed";
    case "waiting_approval": return "Waiting for approval";
    case "requested": return "Requested";
    case "installing": return "Installing";
    case "suspended": return "Suspended";
    case "disconnected": return "Disconnected";
    default: return state;
  }
}

/** The host of a company URL for display (no scheme, no leading www, no path), or null when it is not a URL. */
export function companyHost(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return null; }
}

/** Only http(s) addresses are ever linked. */
export const safeUrl = (url: string | null): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/** A cell that a spreadsheet would run as a formula gets a leading apostrophe in the CSV export. */
export const csvSafe = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** What the drawer offers for a person or invitation: the status moves the database allows (same table as the Members grid; Approver and roles stay untouched). */
export function memberMoves(m: Pick<MemberRow, "kind" | "status" | "is_service_account">): { status: "active" | "paused" | "revoked"; label: string }[] {
  if (m.kind === "invitation" || m.is_service_account) return [];
  switch (m.status) {
    case "requested": return [{ status: "active", label: "Approve" }, { status: "revoked", label: "Decline" }];
    case "active": return [{ status: "paused", label: "Pause" }, { status: "revoked", label: "Revoke" }];
    case "paused": return [{ status: "active", label: "Resume" }, { status: "revoked", label: "Revoke" }];
    case "revoked": return [{ status: "active", label: "Restore" }];
    default: return [];
  }
}

/** The message for a database refusal of a member action. */
export function memberErrorText(code: string | undefined): string {
  switch (code) {
    case "42501": return "Platform admins only.";
    case "PV020": return "Sign in again (within the last 15 minutes) to change members.";
    case "PV021": return "Platform access to this account is read-only, so members cannot be changed.";
    case "PV026": return "That person is already a member.";
    case "23505": return "There is already a pending invitation for that email. Renew it instead.";
    case "PV012": return "This account only invites people at its authorized domains.";
    case "PV003": return "An account must keep at least one active admin.";
    case "PV027": return "That change is not allowed for this person.";
    case "22023": return "That invitation is no longer pending.";
    case "P0002": return "That account or person no longer exists.";
    default: return "That did not work. Please try again.";
  }
}
