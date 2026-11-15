"use server";

import { revalidatePath } from "next/cache";
import { jiraCheckCall } from "@/lib/atlassian/server";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { runReadChecks, runWriteCheck, type CheckKind, type CheckResult } from "@/lib/atlassian/jira-checks";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/jira/test";
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-[0-9]{1,9}$/;

export type CheckRun = { error: string } | { kind: CheckKind; runAt: string; checks: CheckResult[]; saved: boolean };

/** Human admins only: platform staff and service accounts (Claude) never run these (rule 10; the write check changes a customer's Jira). */
async function humanAdmin() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null;
  return ctx;
}

async function connectionAndSite(ctx: NonNullable<Awaited<ReturnType<typeof humanAdmin>>>, form: FormData) {
  const id = String(form.get("connection") ?? "");
  const siteId = String(form.get("site") ?? "");
  const { data: conn } = await ctx.supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", ctx.active.tenantId).eq("id", id).maybeSingle();
  const sites = (conn?.sites ?? []) as { id: string }[];
  if (!conn || conn.state !== "connected" || !sites.some((s) => s.id === siteId)) return null;
  return { connection: id, site: siteId };
}

async function save(ctx: NonNullable<Awaited<ReturnType<typeof humanAdmin>>>, connection: string, kind: CheckKind, checks: CheckResult[]) {
  // the database function checks again that the person is a human admin of this workspace and audits the write (actor, source UI, new value)
  const { error } = await ctx.supabase.rpc("jira_check_run_save", { p_tenant: ctx.active.tenantId, p_connection: connection, p_kind: kind, p_checks: checks });
  revalidatePath(PATH);
  return !error;
}

const failure = (e: unknown): { error: string } => ({ error: e instanceof ReconnectNeeded ? "Jira needs a new sign-in. Use Sign in to Jira again on the Jira page." : "Jira did not answer. Try again in a minute." });

/** The read-only Initiative-level checks on the stored connection. */
export async function runJiraReadChecks(form: FormData): Promise<CheckRun> {
  const ctx = await humanAdmin();
  if (!ctx) return { error: "Only workspace admins can run the checks." };
  const target = await connectionAndSite(ctx, form);
  if (!target) return { error: "That Jira connection is not available. Connect Jira on the Jira page." };
  const key = String(form.get("initiative") ?? "").trim().toUpperCase();
  if (key && !ISSUE_KEY.test(key)) return { error: "The Initiative key looks like ROAD-12." };
  const { data: links } = await ctx.supabase.from("jira_project_links").select("jira_project_key").eq("tenant_id", ctx.active.tenantId).eq("connection_id", target.connection).eq("site_id", target.site);
  try {
    const checks = await runReadChecks(jiraCheckCall(target.connection, target.site), { linkedProjects: (links ?? []).map((l) => String(l.jira_project_key)), initiativeKey: key });
    return { kind: "read", runAt: new Date().toISOString(), checks, saved: await save(ctx, target.connection, "read", checks) };
  } catch (e) {
    return failure(e);
  }
}

/** The write check: creates and deletes 2 test issues. Needs the confirmation box, two project keys and a human admin. */
export async function runJiraWriteCheck(form: FormData): Promise<CheckRun> {
  const ctx = await humanAdmin();
  if (!ctx) return { error: "Only workspace admins can run the write test." };
  if (form.get("confirm") !== "yes") return { error: "Tick the box to confirm: this creates and deletes 2 test issues in Jira." };
  const target = await connectionAndSite(ctx, form);
  if (!target) return { error: "That Jira connection is not available. Connect Jira on the Jira page." };
  const initiativeProject = String(form.get("initiativeProject") ?? "").trim().toUpperCase();
  const epicProject = String(form.get("epicProject") ?? "").trim().toUpperCase();
  if (!PROJECT_KEY.test(initiativeProject) || !PROJECT_KEY.test(epicProject)) return { error: "Enter two Jira project keys, for example ROAD and R8P." };
  try {
    const checks = await runWriteCheck(jiraCheckCall(target.connection, target.site), initiativeProject, epicProject);
    return { kind: "write", runAt: new Date().toISOString(), checks, saved: await save(ctx, target.connection, "write", checks) };
  } catch (e) {
    return failure(e);
  }
}
