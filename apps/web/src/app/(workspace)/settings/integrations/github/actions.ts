"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { configRowsFromForm } from "@/lib/tracker-fields/form";
import { validateConfig } from "@/lib/tracker-fields/mapping";
import { parseBoard, runConnectionDiagnostics, signInstallState, type CheckResult } from "@pv/github";
import { boardSelectsFromForm, validateBoardSelects } from "@/lib/github/board-selects-form";
import { confirmInstalledConnection, githubAppSlug, githubSecret, githubSourceControl, refreshConnection, type ConnectionRow } from "@/lib/github/server";
import { retryEvent, runCheck } from "@/lib/github/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/github";
export type FormState = { error?: string; ok?: string } | null;

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null; // platform admins never reach integration secrets or send to GitHub (rule 10)
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

/**
 * "Confirm with GitHub" (issue #364): for a connection that is installed but still waiting for GitHub's webhook. Any admin can use it,
 * so the App owner does not have to redeliver the webhook. GitHub is asked directly (App key); the installation must exist, belong to
 * the account entered and not be suspended. Writes nothing to GitHub.
 */
export async function confirmWithGithub(): Promise<void> {
  const ctx = await adminOnly();
  const sc = githubSourceControl();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  if (!sc) redirect(`${PATH}?status=error`);
  const { data } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).neq("state", "disconnected").maybeSingle();
  const c = data as ConnectionRow | null;
  if (!c || c.installation_id === null || c.state === "suspended") redirect(`${PATH}?status=not-confirmed`);
  let result: Awaited<ReturnType<typeof confirmInstalledConnection>>;
  try {
    result = await confirmInstalledConnection(createAdminClient({ via: "UI" }), sc, c);
  } catch {
    redirect(`${PATH}?status=error`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?status=${result === "connected" ? "connected" : result === "wrong-account" ? "wrong-account" : "not-confirmed"}`);
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
  if (!ctx) redirect(`${PATH}?status=error&why=${encodeURIComponent("Only admins can run the check.")}`);
  if (!sc) redirect(`${PATH}?status=error&why=${encodeURIComponent("The GitHub App is not configured on the server (App id or private key missing).")}`);
  const { data } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  if (!data) redirect(`${PATH}?status=error&why=${encodeURIComponent("No connected GitHub installation found for this workspace.")}`);
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
  const tracker = String(form.get("tracker") ?? "") || null;
  if (tracker !== null && !["github", "jira"].includes(tracker)) return { error: "Choose a tracker from the list." };
  const { error } = await ctx.supabase.from("projects").update({ default_repo: repo, who_breaks_down: who, tracker }).eq("id", String(form.get("project_id"))).eq("tenant_id", ctx.active.tenantId);
  if (error) return { error: error.code === "PV005" ? "That repository is not available through the GitHub connection." : error.code === "PV008" ? error.message : "We could not save that." };
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

/** Compares GitHub with every linked item now (the same check that runs daily) and applies what differs. */
export async function checkGithubNow(form?: FormData): Promise<void> {
  // started from the Incoming page or from Settings > GitHub: the answer goes back to where the button was
  const back = form?.get("from") === "incoming" ? "/incoming" : `${PATH}/logs`;
  const ctx = await adminOnly();
  const sc = githubSourceControl();
  if (!ctx || !sc) redirect(`${back}?status=error`);
  const { data } = await ctx.supabase.from("github_connections").select("*").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  if (!data) redirect(`${back}?status=error`);
  // The check takes tens of seconds (a few calls to GitHub and to the database for every linked item). It runs after the answer
  // has been sent, so the page does not freeze; the result appears under the button when it is done.
  const connection = data as ConnectionRow;
  after(async () => { await runCheck(createAdminClient({ via: "GitHub webhook" }), sc, connection); });
  revalidatePath(back);
  redirect(`${back}?status=started&t=${Date.now()}`);
}

export async function retrySyncEvent(eventId: string): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const ok = await retryEvent(createAdminClient({ via: "GitHub webhook" }), ctx.active.tenantId, eventId);
  revalidatePath(`${PATH}/logs`);
  redirect(`${PATH}/logs?status=${ok ? "retried" : "retry-failed"}`);
}

/**
 * Saves the field configuration of ONE project (decision 2026-11-03-tracker-field-config): which of the labels, the milestone, the issue type and the
 * artifact and file sections Sync sends. Admin only; the database checks the closed list of settings again. The board's fields are saved by the
 * Project boards card. Nothing is written to GitHub.
 */
export async function saveGithubFieldConfig(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const project = get("project");
  const back: (qs: string) => never = (qs) => redirect(`${PATH}/mapping?project=${encodeURIComponent(project)}&${qs}&t=${Date.now()}`);
  const checked = validateConfig("github", configRowsFromForm("github", get, (k) => form.has(k)), null);
  if (!checked.ok) back(`status=field-config-invalid&why=${encodeURIComponent(checked.errors.join(" ").slice(0, 400))}`);
  const { error } = await ctx.supabase.rpc("tracker_set_field_config", { p_project: project, p_rows: checked.rows.map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field, text: r.text ?? null })) });
  revalidatePath(`${PATH}/mapping`);
  back(`status=${error ? "error" : "field-config-saved"}`);
}

/**
 * Saves the "Initiative fields" card of a project's linked board (issue #513): Health, Initiative Status and Initiative Phase on single-select fields.
 * The fields and options are read from the board at save time and the mapping is checked against them; it is stored with the board in
 * `projects.github_board`, next to the other board fields. Admin only (a person, never Claude); nothing is written to GitHub.
 */
export async function saveGithubBoardSelects(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const project = get("project");
  const back: (qs: string) => never = (qs) => redirect(`${PATH}/mapping?project=${encodeURIComponent(project)}&${qs}&t=${Date.now()}`);
  const invalid = (why: string): never => back(`status=field-config-invalid&why=${encodeURIComponent(why.slice(0, 400))}`);
  const { data: proj } = await ctx.supabase.from("projects").select("github_board").eq("id", project).eq("tenant_id", ctx.active.tenantId).maybeSingle();
  const board = parseBoard(proj?.github_board);
  if (!board) return invalid("This project has no linked GitHub Project. Link one under Connect and configure first.");
  const sc = githubSourceControl();
  const { data: conn } = await ctx.supabase.from("github_connections").select("installation_id").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
  const installationId = (conn as { installation_id?: number | null } | null)?.installation_id;
  if (!sc || !installationId) return invalid("GitHub is not connected for this workspace.");
  const fields = await sc.getBoardFields(installationId, board.id).catch((): null => null);
  if (!fields) return invalid("The fields of this board could not be read just now, so the initiative fields cannot be saved. Try again in a minute.");
  const selects = boardSelectsFromForm(get, fields);
  const m = board.mapping;
  const taken = [m.priority, m.group, m.dueDate, m.size, m.status, m.iteration].flatMap((r) => (r ? [r.id] : []));
  const errors = validateBoardSelects(selects, fields, taken);
  if (errors.length > 0) return invalid(errors.join(" "));
  const { selects: _old, ...rest } = m;
  void _old;
  const stored = parseBoard({ id: board.id, number: board.number, title: board.title, url: board.url, mapping: { ...rest, ...(selects ? { selects } : {}) } });
  if (!stored) return invalid("That mapping could not be saved.");
  const { error } = await ctx.supabase.from("projects").update({ github_board: stored }).eq("id", project).eq("tenant_id", ctx.active.tenantId);
  revalidatePath(`${PATH}/mapping`);
  back(`status=${error ? "error" : "field-config-saved"}`);
}

/**
 * Copies the saved field settings of one project to others that also use GitHub (the "Copy to other projects" box of Field mapping). The same closed list of
 * settings, written by the same database function, so the same checks apply. A project with no saved setting copies the defaults, which resets the targets.
 * The linked board's fields (Project boards) are not copied: they belong to each project's own board. Admin only; nothing is written to GitHub.
 */
export async function copyGithubFieldConfig(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const from = String(form.get("from") ?? "");
  const to = [...new Set(form.getAll("to").map(String))].filter((x) => x && x !== from);
  const back: (status: string) => never = (status) => redirect(`${PATH}/mapping?project=${encodeURIComponent(from)}&status=${status}&t=${Date.now()}`);
  if (to.length === 0) back("copy-none");
  const [{ data: src }, { data: targets }] = await Promise.all([
    ctx.supabase.from("tracker_field_config").select("slot, enabled, field_id, label_text").eq("tenant_id", ctx.active.tenantId).eq("provider", "github").eq("project_id", from),
    ctx.supabase.from("projects").select("id").eq("tenant_id", ctx.active.tenantId).eq("tracker", "github").in("id", to),
  ]);
  const rows = ((src ?? []) as { slot: string; enabled: boolean; field_id: string | null; label_text: string | null }[]).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id, text: r.label_text ?? null }));
  let failed = 0;
  for (const t of (targets ?? []) as { id: string }[]) {
    const { error } = await ctx.supabase.rpc("tracker_set_field_config", { p_project: t.id, p_rows: rows });
    if (error) failed++;
  }
  revalidatePath(`${PATH}/mapping`);
  back(failed > 0 ? "error" : "field-config-copied");
}

/** Saves the repositories ticked under "Repositories to check for epics" (issue #465). Workspace admins who are people (the database checks it too). */
export async function saveEpicRepos(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  let status = "epics-saved";
  if (!ctx) status = "not-admin";
  else {
    const { data: conn } = await ctx.supabase.from("github_connections").select("id").eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
    const repos = [...new Set(form.getAll("repo").map((r) => String(r)))];
    if (!conn) status = "epics-error";
    else {
      const { error } = await ctx.supabase.rpc("github_set_epic_repos", { p_connection: conn.id, p_repos: repos });
      if (error) status = error.code === "42501" ? "not-admin" : "epics-error";
    }
  }
  revalidatePath(`${PATH}/projects`);
  revalidatePath("/incoming");
  redirect(`${PATH}/projects?status=${status}`);
}
