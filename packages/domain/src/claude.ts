// Claude as a connected user (docs/20-CLAUDE-MCP.md FR-1): what the consent screen promises, which roles may use write
// tools, and the plain-language refusals. One place, so the consent page, the Connect Claude page and the server agree.

export const CLAUDE_CAN = [
  "Read the roadmap you can see: initiatives, groups, projects and their fields",
  "Create draft initiatives for you to review (marked as AI draft)",
  "Attach files and images to initiatives",
  "Preview what would go to GitHub (nothing is sent without your confirmation)",
] as const;

export const CLAUDE_CANNOT = [
  "Approve anything or mark work ready for build",
  "Set Stack Rank, Decision or Value",
  "Delete initiatives",
  "Change roles, members or settings",
] as const;

/** Roles that may use write tools; everyone else connects and reads. Matches the tool table in docs/20 section 7. */
export const CLAUDE_WRITE_ROLES = ["creator", "admin"] as const;
export const claudeMayWrite = (role: string): boolean => (CLAUDE_WRITE_ROLES as readonly string[]).includes(role);

export type ConnectionStatus = "ok" | "no_connection" | "revoked" | "workspace_off" | "not_member";

/** What /mcp answers when a token may not be used. Null when it may. 401 makes the client sign in again; 403 does not help to retry. */
export function refusalFor(status: ConnectionStatus): { http: 401 | 403; error: string; message: string } | null {
  switch (status) {
    case "ok":
      return null;
    case "revoked":
      return { http: 401, error: "connection_revoked", message: "This connection was revoked in Product Velocity. Connect Claude again from your account menu if you want to use it." };
    case "no_connection":
      return { http: 401, error: "no_connection", message: "This sign-in is not connected to a workspace. Connect Claude again and approve it on the consent screen." };
    case "workspace_off":
      return { http: 403, error: "workspace_off", message: "Claude is switched off for this workspace. A workspace admin can turn it on under Connect Claude." };
    case "not_member":
      return { http: 403, error: "not_member", message: "You are no longer a member of the workspace this connection was made for. Connect Claude again to choose another workspace." };
  }
}

export type UsageResult = { ok: true } | { ok: false; reason: string; limit: number; used: number };

const n = (v: number) => v.toLocaleString("en-US");

/** The readable message for a daily limit (Claude relays it to the person). */
export function limitMessage(r: Extract<UsageResult, { ok: false }>): string {
  const reset = "The count starts again at midnight UTC.";
  switch (r.reason) {
    case "workspace_items":
      return `This workspace reached its daily limit of ${n(r.limit)} items written through Claude. ${reset} You can keep reading in the meantime.`;
    case "workspace_bytes":
      return `This workspace reached its daily limit of ${Math.round(r.limit / (1024 * 1024))} MB of uploads through Claude. ${reset}`;
    case "connection_calls":
      return `This connection reached its daily limit of ${n(r.limit)} calls. ${reset}`;
    case "workspace_calls":
      return `This workspace reached its daily limit of ${n(r.limit)} calls through Claude. ${reset}`;
    default:
      return `A daily limit for Claude was reached. ${reset}`;
  }
}

/** What Claude may do for the signed-in person's role: the lists `get_workspace_context` returns, so Claude can explain its limits without guessing. */
export function claudeAllowances(role: string): { can: string[]; cannot: string[] } {
  const write = claudeMayWrite(role);
  return {
    can: write ? [...CLAUDE_CAN] : [CLAUDE_CAN[0], CLAUDE_CAN[3]],
    cannot: write
      ? [...CLAUDE_CANNOT]
      : ["Create or change anything: your role in this workspace is read-only (a workspace admin can give you the Creator role)", ...CLAUDE_CANNOT],
  };
}
