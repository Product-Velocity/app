import "server-only";
import { decideConnectionChange, sourceControlFromEnv, type ConnectionEvent, type SourceControl } from "@pv/github";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export const githubSourceControl = (): SourceControl | null => sourceControlFromEnv(process.env);
export const githubAppSlug = () => process.env.GITHUB_APP_SLUG ?? null;
/** The webhook secret doubles as the key for install-state tokens (they are derived with a label, see @pv/github). */
export const githubSecret = () => process.env.GITHUB_APP_WEBHOOK_SECRET ?? null;

export type ConnectionRow = {
  id: string;
  tenant_id: string;
  expected_account: string;
  installation_id: number | null;
  account_login: string | null;
  state: "requested" | "waiting_approval" | "installing" | "connected" | "suspended" | "disconnected";
};

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

/** Marks every repository removed and clears project defaults for a workspace (mirrors github_disconnect()). */
async function detachRepositories(admin: Admin, tenantId: string, connectionId?: string) {
  const repos = admin.from("github_repositories").update({ removed_at: new Date().toISOString() }).eq("tenant_id", tenantId).is("removed_at", null);
  must(await (connectionId ? repos.eq("connection_id", connectionId) : repos), "mark repositories removed");
  must(await admin.from("projects").update({ default_repo: null }).eq("tenant_id", tenantId).not("default_repo", "is", null), "clear project defaults");
}

/**
 * Re-reads the installation's repositories (GitHub is the source of truth, so a delivery is never trusted for the list),
 * marks vanished ones removed, clears project defaults that pointed at them and records whether Epic exists.
 */
export async function refreshConnection(admin: Admin, sc: SourceControl, c: ConnectionRow) {
  if (c.installation_id === null) throw new Error("connection has no installation");
  const [installation, repos] = await Promise.all([sc.getInstallation(c.installation_id), sc.listRepositories(c.installation_id)]);
  const login = installation?.accountLogin ?? c.account_login ?? c.expected_account;
  const types = await sc.listIssueTypes(c.installation_id, login).catch(() => null);

  const existing = must(await admin.from("github_repositories").select("id, github_repo_id, full_name, removed_at").eq("connection_id", c.id), "read repositories") as { id: string; github_repo_id: number; full_name: string; removed_at: string | null }[];
  const live = new Set(repos.map((r) => r.id));
  for (const r of repos) {
    const row = existing.find((e) => e.github_repo_id === r.id);
    if (!row) must(await admin.from("github_repositories").insert({ tenant_id: c.tenant_id, connection_id: c.id, github_repo_id: r.id, full_name: r.fullName, is_private: r.private, access: r.private ? "read_write" : "read_only" }), "add repository"); // public repositories start read-only
    else if (row.full_name !== r.fullName || row.removed_at) must(await admin.from("github_repositories").update({ full_name: r.fullName, is_private: r.private, removed_at: null }).eq("id", row.id), "update repository");
  }
  for (const gone of existing.filter((e) => !live.has(e.github_repo_id) && !e.removed_at)) {
    must(await admin.from("github_repositories").update({ removed_at: new Date().toISOString() }).eq("id", gone.id), "remove repository");
    must(await admin.from("projects").update({ default_repo: null }).eq("tenant_id", c.tenant_id).ilike("default_repo", gone.full_name), "clear project default");
  }
  must(
    await admin.from("github_connections").update({
      repository_selection: installation?.repositorySelection ?? null,
      epic_type_available: types === null ? null : types.some((t) => t.toLowerCase() === "epic"),
      repositories_synced_at: new Date().toISOString(),
    }).eq("id", c.id),
    "update connection",
  );
  return { repositories: repos.length };
}

const OPEN = ["requested", "waiting_approval", "installing"] as const;

/** Applies an installation or installation_repositories delivery. Idempotent: replaying one changes nothing. */
export async function applyConnectionEvent(admin: Admin, sc: SourceControl, ev: ConnectionEvent) {
  const bound = must(await admin.from("github_connections").select("*").eq("installation_id", ev.installationId).neq("state", "disconnected").maybeSingle(), "find connection") as ConnectionRow | null;
  const pending = bound
    ? []
    : (must(await admin.from("github_connections").select("*").in("state", [...OPEN]).ilike("expected_account", ev.accountLogin), "find pending connection") as ConnectionRow[]);
  const decision = decideConnectionChange(ev, bound, pending);
  if (decision.kind === "ignore") return;

  const row = [bound, ...pending].find((r) => r?.id === decision.id)!;
  if (decision.kind === "refresh") {
    await refreshConnection(admin, sc, row);
    return;
  }
  const patch = {
    state: decision.state,
    ...(decision.state === "connected" ? { installation_id: ev.installationId, account_login: ev.accountLogin, account_type: ev.accountType, repository_selection: ev.repositorySelection } : {}),
  };
  must(await admin.from("github_connections").update(patch).eq("id", row.id), "update connection");
  if (decision.state === "disconnected") await detachRepositories(admin, row.tenant_id, row.id);
  if (decision.state === "connected") await refreshConnection(admin, sc, { ...row, installation_id: ev.installationId, account_login: ev.accountLogin });
}
