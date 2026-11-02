"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAuthorizeUrl, atlassianConfig, JIRA_SCOPES } from "@/lib/atlassian/oauth";
import { signConnectState } from "@/lib/atlassian/connect-state";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { jiraProjectDetail } from "@/lib/atlassian/server";
import { validateTypeMapping } from "@/lib/atlassian/type-mapping";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/jira";

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null; // platform staff never reach integration secrets (rule 10)
  return ctx;
}

/** Sends the admin to Atlassian's consent screen with a signed, ten-minute state tied to this person and workspace. */
export async function startJiraConnection(): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const cfg = atlassianConfig();
  const ring = keyRing();
  if (!cfg || !ring) redirect(`${PATH}?status=not-configured`);
  redirect(buildAuthorizeUrl(cfg, JIRA_SCOPES, signConnectState(ctx.active.tenantId, ctx.user.id, ring.current)));
}

/** Ends a connection and deletes its saved sign-in. The database checks that the person is a human admin of the workspace. */
export async function disconnectJira(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const id = String(form.get("id") ?? "");
  const { error } = await ctx.supabase.rpc("jira_disconnect", { p_connection: id });
  revalidatePath(PATH);
  redirect(`${PATH}?status=${error ? "error" : "disconnected"}`);
}

const nameOf = (types: { id: string; name: string }[], id: string | null) => (id ? (types.find((t) => t.id === id)?.name ?? null) : null);

/**
 * Links a PV project to a Jira project. The Jira project and its issue types are read again from Jira here, so the ids and names stored are
 * Jira's, not whatever the form carried. Only software and business projects can be linked (Product Discovery ideas come later).
 */
export async function linkJiraProject(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const [project, connection, site, key] = [text("project"), text("connection"), text("site"), text("key")];
  const initiative = text("initiative");
  const epic = text("epic") || null;
  const task = text("task") || null;
  let status = "linked";
  try {
    const { data: conn } = await ctx.supabase.from("jira_connections").select("id, sites, state").eq("id", connection).eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
    if (!conn || !(conn.sites as { id: string }[]).some((s) => s.id === site)) redirect(`${PATH}?status=link-unavailable`);
    const detail = await jiraProjectDetail(connection, site, key);
    if (detail.projectTypeKey !== "software" && detail.projectTypeKey !== "business") redirect(`${PATH}?status=link-type`);
    const invalid = validateTypeMapping(detail.issueTypes, { initiative, epic, task });
    if (invalid) redirect(`${PATH}?status=link-types`);
    const { error } = await ctx.supabase.rpc("jira_link_project", {
      p_project: project, p_connection: connection, p_site: site, p_jira_project_id: detail.id, p_jira_project_key: detail.key, p_jira_project_name: detail.name,
      p_initiative_id: initiative, p_initiative_name: nameOf(detail.issueTypes, initiative),
      p_epic_id: epic, p_epic_name: nameOf(detail.issueTypes, epic), p_task_id: task, p_task_name: nameOf(detail.issueTypes, task),
    });
    if (error) status = error.code === "PV008" ? "link-tracker" : error.code === "PV009" ? "link-unavailable" : error.code === "23505" ? "link-taken" : "error";
  } catch (e) {
    // redirect() throws a control-flow error that must pass through
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    status = "error";
  }
  revalidatePath(PATH);
  redirect(`${PATH}?status=${status}`);
}

export async function unlinkJiraProject(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const { error } = await ctx.supabase.rpc("jira_unlink_project", { p_project: String(form.get("project") ?? "") });
  revalidatePath(PATH);
  redirect(`${PATH}?status=${error ? "error" : "unlinked"}`);
}
