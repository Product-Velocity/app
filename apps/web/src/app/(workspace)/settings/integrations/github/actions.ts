"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runConnectionDiagnostics, signInstallState, type CheckResult } from "@pv/github";
import { githubAppSlug, githubSecret, githubSourceControl, refreshConnection, type ConnectionRow } from "@/lib/github/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/github";
export type FormState = { error?: string; ok?: string } | null;

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account) return null;
  return ctx;
}

const installUrl = (state: string) => `https://github.com/apps/${githubAppSlug()}/installations/new?state=${encodeURIComponent(state)}`;
const stateFor = (tenantId: string, userId: string, connectionId: string) =>
  signInstallState({ tenantId, userId, connectionId, exp: Math.floor(Date.now() / 1000) + 3600 }, githubSecret() ?? "");

/** Creates the connection row (state "requested") and sends the admin to GitHub's install page. */
export async function startConnection(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminOnly();
  if (!ctx) return { error: "Only admins can connect GitHub." };
  if (!githubAppSlug() || !githubSecret() || !githubSourceControl()) return { error: "The GitHub App is not set up for this deployment yet. Ask the platform owner to set the GitHub App variables." };
  const account = String(form.get("account") ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  const { data, error } = await ctx.supabase.from("github_connections").insert({ tenant_id: ctx.active.tenantId, expected_account: account }).select("id").single();
  if (error) {
    if (error.code === "23514") return { error: "Enter the GitHub organisation or account name, for example acme-corp." };
    if (error.code === "23505") return { error: "This workspace already has a GitHub connection. Cancel it first to start again." };
    return { error: "We could not start the connection." };
  }
  redirect(installUrl(stateFor(ctx.active.tenantId, ctx.user.id, data.id as string)));
}

/** Re-opens GitHub's install page for an attempt that was started but not finished. */
export async function continueOnGithub(connectionId: string) {
  const ctx = await adminOnly();
  if (!ctx || !githubAppSlug()) redirect(`${PATH}?status=error`);
  const { data } = await ctx.supabase.from("github_connections").select("id, state").eq("id", connectionId).maybeSingle();
  if (!data || data.state === "disconnected") redirect(`${PATH}?status=bad-link`);
  redirect(installUrl(stateFor(ctx.active.tenantId, ctx.user.id, connectionId)));
}

/** Ends or cancels the connection. It does not uninstall the App on GitHub (that is the organisation owner's choice). */
export async function disconnectGithub(): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const { error } = await ctx.supabase.rpc("github_disconnect", { p_tenant: ctx.active.tenantId });
  revalidatePath(PATH);
  redirect(`${PATH}?status=${error ? "error" : "disconnected"}`);
}

export async function refreshRepositories(): Promise<void> {
  const ctx = await adminOnly();
  const sc = githubSourceControl();
  if (!ctx || !sc) redirect(`${PATH}?status=error`);
  const { data } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  if (!data) redirect(`${PATH}?status=error`);
  try {
    await refreshConnection(createAdminClient({ via: "UI" }), sc, data as ConnectionRow);
  } catch {
    redirect(`${PATH}?status=error`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?status=refreshed`);
}

export async function saveProjectGithub(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminOnly();
  if (!ctx) return { error: "Only admins can change this." };
  const who = String(form.get("who_breaks_down") ?? "");
  if (!["product", "engineering", "either"].includes(who)) return { error: "Choose who breaks down the work." };
  const repo = String(form.get("default_repo") ?? "") || null;
  const { error } = await ctx.supabase.from("projects").update({ default_repo: repo, who_breaks_down: who }).eq("id", String(form.get("project_id"))).eq("tenant_id", ctx.active.tenantId);
  if (error) return { error: error.code === "PV005" ? "That repository is not available through the GitHub connection." : "We could not save that." };
  revalidatePath(PATH);
  return { ok: "Saved" };
}

/** Read-only test of this workspace's own connection (R-025). Writes nothing to GitHub and returns no secrets. */
export async function runConnectionTest(): Promise<{ results: CheckResult[] } | { error: string }> {
  const ctx = await adminOnly();
  if (!ctx) return { error: "Only admins can run the connection test." };
  const sc = githubSourceControl();
  if (!sc) return { error: "The GitHub App is not set up for this deployment yet." };
  const { data: conn } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).neq("state", "disconnected").maybeSingle();
  const c = conn as ConnectionRow | null;
  if (!c?.installation_id) return { error: "There is no installed GitHub connection to test yet." };
  const { data: projects } = await ctx.supabase.from("projects").select("name, default_repo").eq("tenant_id", ctx.active.tenantId).not("default_repo", "is", null);
  const results = await runConnectionDiagnostics({
    sc,
    installationId: c.installation_id,
    expectedAccount: c.expected_account,
    projectRepos: (projects ?? []).map((p: { name: string; default_repo: string }) => ({ project: p.name, repo: p.default_repo })),
  });
  return { results };
}

/** Marks a repository read-only (never written to) or writable again. Clearing project defaults that use it happens in the database. */
export async function setRepoAccess(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await adminOnly();
  if (!ctx) return { error: "Only admins can change this." };
  const access = String(form.get("access") ?? "");
  if (!["read_write", "read_only"].includes(access)) return { error: "Choose read-only or can be written to." };
  const { error } = await ctx.supabase.rpc("github_set_repo_access", { p_repo: String(form.get("repo_id")), p_access: access });
  if (error) return { error: "We could not save that." };
  revalidatePath(PATH);
  return { ok: access === "read_only" ? "Now read-only" : "Saved" };
}
