"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAuthorizeUrl, atlassianConfig, JIRA_SCOPES, WEBHOOK_SCOPES } from "@/lib/atlassian/oauth";
import { signConnectState } from "@/lib/atlassian/connect-state";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { checkJiraLinks } from "@/lib/atlassian/jira-check";
import { applyLinkedStatuses } from "@/lib/atlassian/refresh-jira";
import { describeLines } from "@/lib/atlassian/jira-events";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJiraLink } from "@/lib/atlassian/read-jira";
import { jiraProjectDetail } from "@/lib/atlassian/server";
import { parseFieldMap } from "@/lib/atlassian/field-map";
import { readJiraSiteFields } from "@/lib/atlassian/catalog-server";
import { configRowsFromForm, jiraMapFromForm, validateJiraMap } from "@/lib/tracker-fields/form";
import { validateConfig } from "@/lib/tracker-fields/mapping";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
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
  redirect(buildAuthorizeUrl(cfg, process.env.JIRA_WEBHOOKS === "1" ? [...JIRA_SCOPES, ...WEBHOOK_SCOPES] : JIRA_SCOPES, signConnectState(ctx.active.tenantId, ctx.user.id, ring.current)));
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

/** Reads the open issues of a linked Jira project into the light records. Reads Jira only; nothing is written to Jira. */
export async function readJiraNow(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const project = String(form.get("project") ?? "");
  const { data: link } = await ctx.supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("project_id", project).eq("tenant_id", ctx.active.tenantId).maybeSingle();
  const { data: conn } = link ? await ctx.supabase.from("jira_connections").select("sites, state").eq("id", link.connection_id).maybeSingle() : { data: null };
  const site = (conn?.sites as { id: string; url: string }[] | undefined)?.find((x) => x.id === link?.site_id);
  let status = "read";
  if (!link || !conn || conn.state !== "connected" || !site) status = "link-unavailable";
  else {
    try {
      await readJiraLink(link, site.url);
    } catch (e) {
      status = e instanceof ReconnectNeeded ? "read-reconnect" : "read-failed";
    }
  }
  revalidatePath(PATH);
  redirect(`${PATH}?status=${status}`);
}

/**
 * People decide what comes in from Jira (issue #67 C2a): Pull in (an initiative that follows the issue read only, or that Product Velocity
 * owns), Ignore, or Bring back. Creators and admins; the database checks the role and that the issue belongs to the project.
 */
export async function reviewJiraIssues(form: FormData): Promise<void> {
  const ctx = await requireWorkspace(PATH);
  const project = String(form.get("project") ?? "");
  const intent = String(form.get("intent") ?? "");
  const mode = String(form.get("mode") ?? "follow") === "push" ? "push" : "follow";
  const ids = form.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  if (ids.length === 0) redirect(`${PATH}?status=review-none&pv=${project}`);
  let status = "error";
  let counts = "";
  if (intent === "pull") {
    const { data, error } = await ctx.supabase.rpc("jira_pull_in", { p_ids: ids, p_project: project, p_mode: mode });
    if (!error) {
      const rows = (data ?? []) as { ok: boolean }[];
      const ok = rows.filter((r) => r.ok).length;
      status = ok === rows.length ? "pulled" : ok > 0 ? "pulled-some" : "pull-failed";
      counts = `&n=${ok}&m=${rows.length - ok}`;
    } else if (error.code === "42501") status = "review-denied";
    else if (error.code === "PV008") status = "link-tracker";
  } else if (intent === "ignore" || intent === "restore") {
    const { data, error } = await ctx.supabase.rpc("jira_set_state", { p_ids: ids, p_state: intent === "ignore" ? "ignored" : "not_pulled", p_reason: intent === "ignore" ? "Ignored by a person" : null });
    if (!error) {
      const ok = ((data ?? []) as { ok: boolean }[]).filter((r) => r.ok).length;
      status = intent === "ignore" ? "ignored" : "restored";
      counts = `&n=${ok}`;
    } else if (error.code === "42501") status = "review-denied";
  }
  revalidatePath(PATH);
  redirect(`${PATH}?status=${status}${counts}`);
}

/**
 * Saves the field configuration of ONE linked project (decision 2026-11-03-tracker-field-config): the start date, theme and priority fields (the Jira
 * field map) and the switches and due date field (tracker_field_config). Admin only. Every field id is checked against the fields the site reports now,
 * for type and for clashes, before anything is stored; the database checks the shapes and the closed list of settings again. "Reset" puts one setting
 * or all of them back to the default. Nothing is written to Jira.
 */
export async function saveJiraFieldConfig(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const project = String(form.get("project") ?? "");
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const { data: link } = await ctx.supabase.from("jira_project_links").select("connection_id, site_id, field_map").eq("tenant_id", ctx.active.tenantId).eq("project_id", project).maybeSingle();
  if (!link) redirect(`${PATH}?status=error`);
  const map = jiraMapFromForm(get);
  const rows = configRowsFromForm("jira", get, (k) => form.has(k));
  const site = await readJiraSiteFields(link.connection_id as string, link.site_id as string).catch((): null => null);
  const used = [map.startDate ? { id: map.startDate, label: "Planned Start" } : null, map.theme ? { id: map.theme, label: "Initiative Group" } : null].filter((x): x is { id: string; label: string } => x !== null);
  const checked = validateConfig("jira", rows, site?.entries ?? null, used);
  const errors = [...validateJiraMap(map, parseFieldMap(link.field_map), site), ...(checked.ok ? [] : checked.errors)];
  if (errors.length > 0 || !checked.ok) redirect(`${PATH}?status=field-config-invalid&why=${encodeURIComponent(errors.join(" ").slice(0, 400))}`);
  const first = await ctx.supabase.rpc("jira_set_field_map", { p_project: project, p_map: map });
  const second = first.error ? null : await ctx.supabase.rpc("tracker_set_field_config", { p_project: project, p_rows: checked.rows.map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field })) });
  revalidatePath(PATH);
  redirect(`${PATH}?status=${first.error || second?.error ? "error" : "field-config-saved"}`);
}

/**
 * "Check Jira now" (the twin of "Check GitHub now"): the same run as the daily check, for this workspace only. Reads Jira, applies the status of
 * the linked initiatives, records the result in the recent-events table. Admin only; reading never writes to Jira.
 */
export async function checkJiraNow(): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const { data: conns } = await ctx.supabase.from("jira_connections").select("id, sites").eq("tenant_id", ctx.active.tenantId).eq("state", "connected");
  const sitesOf = new Map(((conns ?? []) as { id: string; sites: { id: string; url: string }[] }[]).map((c) => [c.id, c.sites]));
  const { data: links } = await ctx.supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("tenant_id", ctx.active.tenantId).in("connection_id", [...sitesOf.keys()]);
  let status = "checked";
  let qs = "";
  try {
    const r = await checkJiraLinks((links ?? []) as import("@/lib/atlassian/read-jira").LinkToRead[], sitesOf, { source: "manual", budgetMs: 50_000 });
    qs = `&c=${r.checked}&ch=${r.changed}&m=${r.missing}`;
    if (r.reconnect > 0) status = "read-reconnect";
    else if (r.failed > 0) status = "read-failed";
  } catch {
    status = "read-failed";
  }
  revalidatePath(`${PATH}/logs`);
  redirect(`${PATH}/logs?status=${status}${qs}`);
}

/** "Run again" for a failed row of the recent-events table: reads that issue again and applies it. */
export async function retryJiraEvent(id: string): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const { data: ev } = await ctx.supabase.from("jira_sync_events").select("id, link_id, issue_key, state").eq("id", id).eq("tenant_id", ctx.active.tenantId).maybeSingle();
  let status = "retry-failed";
  if (ev?.state === "error" && ev.link_id && ev.issue_key) {
    const { data: link } = await ctx.supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("id", ev.link_id).maybeSingle();
    const { data: conn } = link ? await ctx.supabase.from("jira_connections").select("sites, state").eq("id", link.connection_id).maybeSingle() : { data: null };
    const site = (conn?.sites as { id: string; url: string }[] | undefined)?.find((x) => x.id === link?.site_id);
    const { data: item } = link ? await ctx.supabase.from("item_jira_links").select("item_id").eq("connection_id", link.connection_id).eq("site_id", link.site_id).eq("issue_key", ev.issue_key) : { data: [] };
    if (link && site && conn?.state === "connected" && (item ?? []).length > 0) {
      try {
        const done = await applyLinkedStatuses(link, site.url, { itemIds: (item as { item_id: string }[]).map((x) => x.item_id) });
        const admin = createAdminClient({ via: "system" });
        await admin.from("jira_sync_events").update({ state: "processed", last_error: null, summary: done.changedIssues.length ? describeLines(done.changedIssues[0]!.lines) : `Read ${ev.issue_key} again: nothing changed`, attempts: 2 }).eq("id", id);
        status = "retried";
      } catch (e) {
        status = e instanceof ReconnectNeeded ? "read-reconnect" : "retry-failed";
      }
    }
  }
  revalidatePath(`${PATH}/logs`);
  redirect(`${PATH}/logs?status=${status}`);
}

/**
 * The Projects table, one step (replaces Choose + Link): the row's tracker choice and Jira project with its three issue types. "none" unlinks;
 * "jira" links (or changes the link). The Jira project and its issue types are read again from Jira here (the form is never trusted).
 */
export async function saveJiraProject(form: FormData): Promise<void> {
  if (String(form.get("tracker") ?? "") === "none") return unlinkJiraProject(form);
  const choice = String(form.get("jira") ?? "").split("|");
  const next = new FormData();
  next.set("project", String(form.get("project") ?? ""));
  next.set("connection", choice[0] ?? "");
  next.set("site", choice[1] ?? "");
  next.set("key", choice[2] ?? "");
  next.set("initiative", String(form.get("initiative") ?? ""));
  next.set("epic", String(form.get("epic") ?? ""));
  next.set("task", String(form.get("task") ?? ""));
  return linkJiraProject(next);
}
