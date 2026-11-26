"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildAuthorizeUrl, atlassianConfig, CONFLUENCE_SCOPES, JIRA_SCOPES, WEBHOOK_SCOPES } from "@/lib/atlassian/oauth";
import { CONFLUENCE_WRITE_SCOPE } from "@/lib/confluence/server";
import { signConnectState } from "@/lib/atlassian/connect-state";
import { keyRing } from "@/lib/atlassian/token-crypto";
import { checkJiraLinks } from "@/lib/atlassian/jira-check";
import { applyLinkedStatuses } from "@/lib/atlassian/refresh-jira";
import { describeLines } from "@/lib/atlassian/jira-events";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJiraLink } from "@/lib/atlassian/read-jira";
import { jiraProjectDetail } from "@/lib/atlassian/server";
import { parseFieldMap } from "@/lib/atlassian/field-map";
import { STATUS_ANCHOR, releaseChoice, unlinkStatus } from "@/lib/atlassian/link-status";
import { readJiraSiteFields, readJiraSelectFields } from "@/lib/atlassian/catalog-server";
import { selectMapFromForm, selectRows } from "@/lib/atlassian/select-map-form";
import { validateSelectMap } from "@/lib/atlassian/select-map";
import { configRowsFromForm, jiraMapFromForm, validateJiraMap } from "@/lib/tracker-fields/form";
import { validateConfig } from "@/lib/tracker-fields/mapping";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import { validateTypeMapping } from "@/lib/atlassian/type-mapping";
import { copyJiraIssueTexts } from "@/app/(workspace)/incoming/copy-jira-texts";
import { requireWorkspace } from "@/lib/session";

const PATH = "/settings/integrations/jira";
// each section has its own address (decision 2026-11-16-tracker-settings-sections): an action returns to the section it was used on
const PROJECTS = `${PATH}/projects`;
const INBOX = `${PATH}/inbox`;
const MAPPING = `${PATH}/mapping`;

async function adminOnly() {
  const ctx = await requireWorkspace(PATH);
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (ctx.active.role !== "admin" || me?.is_service_account || ctx.active.platform) return null; // platform staff never reach integration secrets (rule 10)
  return ctx;
}

/**
 * The scopes of a sign-in. A sign-in again keeps Confluence permission when the workspace already has it (otherwise signing in to Jira again would quietly
 * remove the ability to publish documents), and adds it when `withConfluence` is set (the "Add Confluence" button).
 */
async function scopesFor(ctx: NonNullable<Awaited<ReturnType<typeof adminOnly>>>, withConfluence: boolean): Promise<string[]> {
  const { data } = await ctx.supabase.from("jira_connections").select("scopes").eq("tenant_id", ctx.active.tenantId).neq("state", "disconnected");
  const had = (data ?? []).some((c) => String(c.scopes ?? "").split(/\s+/).includes(CONFLUENCE_WRITE_SCOPE));
  return [...JIRA_SCOPES, ...(process.env.JIRA_WEBHOOKS === "1" ? WEBHOOK_SCOPES : []), ...(withConfluence || had ? CONFLUENCE_SCOPES : [])];
}

async function startConnection(withConfluence: boolean): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const cfg = atlassianConfig();
  const ring = keyRing();
  if (!cfg || !ring) redirect(`${PATH}?status=not-configured`);
  redirect(buildAuthorizeUrl(cfg, await scopesFor(ctx, withConfluence), signConnectState(ctx.active.tenantId, ctx.user.id, ring.current)));
}

/** Sends the admin to Atlassian's consent screen with a signed, ten-minute state tied to this person and workspace. */
export async function startJiraConnection(): Promise<void> {
  await startConnection(false);
}

/** The same sign-in, asking for permission to create and edit Confluence pages as well (publishing documents, issue #693). */
export async function startConfluenceConnection(): Promise<void> {
  await startConnection(true);
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
/** A newly linked project gets the suggested priorities (highest = Must ... lowest = Won't) when none are saved yet, so Priority is sent from the first Sync. Never fails the link. */
async function proposePriorityOnLink(supabase: Awaited<ReturnType<typeof adminOnly>> extends infer C ? (C extends { supabase: infer S } ? S : never) : never, project: string, connection: string, site: string): Promise<void> {
  try {
    const { data: row } = await supabase.from("jira_project_links").select("field_map").eq("project_id", project).maybeSingle();
    const map = parseFieldMap(row?.field_map);
    if (Object.keys(map.priorityByMoscow ?? {}).length > 0) return;
    const fields = await readJiraSiteFields(connection, site);
    if (Object.keys(fields.proposal).length === 0) return;
    await supabase.rpc("jira_set_field_map", { p_project: project, p_map: { ...map, priorityByMoscow: fields.proposal } });
  } catch (e) {
    console.error(JSON.stringify({ jira: "priority-proposal", error: e instanceof Error ? e.message.slice(0, 100) : "unknown" }));
  }
}

export async function linkJiraProject(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PROJECTS}?status=not-admin`);
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const [project, connection, site, key] = [text("project"), text("connection"), text("site"), text("key")];
  const initiative = text("initiative");
  const epic = text("epic") || null;
  const task = text("task") || null;
  let status = "linked";
  try {
    const { data: conn } = await ctx.supabase.from("jira_connections").select("id, sites, state").eq("id", connection).eq("tenant_id", ctx.active.tenantId).eq("state", "connected").maybeSingle();
    if (!conn || !(conn.sites as { id: string }[]).some((s) => s.id === site)) redirect(`${PROJECTS}?status=link-unavailable`);
    const detail = await jiraProjectDetail(connection, site, key);
    if (detail.projectTypeKey !== "software" && detail.projectTypeKey !== "business") redirect(`${PROJECTS}?status=link-type`);
    const invalid = validateTypeMapping(detail.issueTypes, { initiative, epic, task });
    if (invalid) redirect(`${PROJECTS}?status=link-types`);
    const { error } = await ctx.supabase.rpc("jira_link_project", {
      p_project: project, p_connection: connection, p_site: site, p_jira_project_id: detail.id, p_jira_project_key: detail.key, p_jira_project_name: detail.name,
      p_initiative_id: initiative, p_initiative_name: nameOf(detail.issueTypes, initiative),
      p_epic_id: epic, p_epic_name: nameOf(detail.issueTypes, epic), p_task_id: task, p_task_name: nameOf(detail.issueTypes, task),
    });
    if (!error) await proposePriorityOnLink(ctx.supabase, project, connection, site);
    // read only or can write (issue #656): the admin's choice on the row, applied after the link; the database checks that the person is a human admin
    if (!error && form.has("access")) {
      const ro = await ctx.supabase.rpc("jira_set_project_read_only", { p_project: project, p_read_only: text("access") === "read" });
      if (ro.error) status = "error";
    }
    if (error) status = error.code === "PV008" ? "link-tracker" : error.code === "PV009" ? "link-unavailable" : error.code === "23505" ? "link-taken" : "error";
  } catch (e) {
    // redirect() throws a control-flow error that must pass through
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    status = "error";
  }
  revalidatePath(PROJECTS);
  redirect(`${PROJECTS}?status=${status}#${STATUS_ANCHOR}`);
}

export async function unlinkJiraProject(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PROJECTS}?status=not-admin`);
  const choice = releaseChoice(form.get("release"));
  const { data, error } = await ctx.supabase.rpc("jira_unlink_project_release", { p_project: String(form.get("project") ?? ""), p_delete: choice === "delete" });
  const released = Number((data as { released?: number } | null)?.released ?? 0);
  revalidatePath(PROJECTS);
  const status = error ? unlinkStatus(error.code) : released === 0 ? "unlinked" : choice === "delete" ? "unlinked-delete" : "unlinked-keep";
  redirect(`${PROJECTS}?status=${status}#${STATUS_ANCHOR}`);
}

/** Reads the open issues of a linked Jira project into the light records. Reads Jira only; nothing is written to Jira. */
export async function readJiraNow(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${INBOX}?status=not-admin`);
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
  revalidatePath(INBOX);
  redirect(`${INBOX}?status=${status}`);
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
  if (ids.length === 0) redirect(`${INBOX}?status=review-none&pv=${project}`);
  let status = "error";
  let counts = "";
  if (intent === "pull") {
    const { data, error } = await ctx.supabase.rpc("jira_pull_in", { p_ids: ids, p_project: project, p_mode: mode });
    if (!error) {
      const rows = (data ?? []) as { ok: boolean; item_id?: string | null }[];
      const ok = rows.filter((r) => r.ok).length;
      // keep each issue's description and type:/area: labels once (issue #365); reading them never fails the pull-in
      const created = rows.filter((r) => r.ok && r.item_id).map((r) => r.item_id as string);
      if (created.length > 0) await copyJiraIssueTexts(created).catch(() => null);
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
  revalidatePath(INBOX);
  redirect(`${INBOX}?status=${status}${counts}`);
}

/**
 * Saves the field configuration of ONE linked project (decision 2026-11-03-tracker-field-config): the start date, theme (Focus Area) and priority fields (the Jira
 * field map) and the switches and due date field (tracker_field_config). Admin only. Every field id is checked against the fields the site reports now,
 * for type and for clashes, before anything is stored; the database checks the shapes and the closed list of settings again. "Reset" puts one setting
 * or all of them back to the default. Nothing is written to Jira.
 */
export async function saveJiraFieldConfig(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const project = String(form.get("project") ?? "");
  const back: (qs: string) => never = (qs) => redirect(`${MAPPING}?project=${encodeURIComponent(project)}&${qs}&t=${Date.now()}`);
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const { data: link } = await ctx.supabase.from("jira_project_links").select("connection_id, site_id, field_map").eq("tenant_id", ctx.active.tenantId).eq("project_id", project).maybeSingle();
  if (!link) back("status=error");
  const map = jiraMapFromForm(get);
  const rows = configRowsFromForm("jira", get, (k) => form.has(k));
  const site = await readJiraSiteFields(link.connection_id as string, link.site_id as string).catch((): null => null);
  const used = [map.startDate ? { id: map.startDate, label: "Planned Start" } : null, map.theme ? { id: map.theme, label: "Focus Area" } : null].filter((x): x is { id: string; label: string } => x !== null);
  const checked = validateConfig("jira", rows, site?.entries ?? null, used);
  const errors = [...validateJiraMap(map, parseFieldMap(link.field_map), site), ...(checked.ok ? [] : checked.errors)];
  if (errors.length > 0 || !checked.ok) back(`status=field-config-invalid&why=${encodeURIComponent(errors.join(" ").slice(0, 400))}`);
  const first = await ctx.supabase.rpc("jira_set_field_map", { p_project: project, p_map: map });
  const second = first.error ? null : await ctx.supabase.rpc("tracker_set_field_config", { p_project: project, p_rows: checked.rows.map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field, text: r.text ?? null })) });
  revalidatePath(MAPPING);
  back(`status=${first.error || second?.error ? "error" : "field-config-saved"}`);
}

/**
 * Saves the "Initiative fields" card (issue #512): Health, Initiative Status and Initiative Phase on custom select fields of the Jira issue that is the
 * initiative. The fields and options are read from Jira's create screen of the project's initiative type at save time and the mapping is checked against
 * them. Admin only; a person, never Claude. Nothing is written to Jira.
 */
export async function saveJiraSelectMap(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const project = String(form.get("project") ?? "");
  const back: (qs: string) => never = (qs) => redirect(`${MAPPING}?project=${encodeURIComponent(project)}&${qs}&t=${Date.now()}`);
  const { data: link } = await ctx.supabase.from("jira_project_links").select("connection_id, site_id, jira_project_key, initiative_type_id").eq("tenant_id", ctx.active.tenantId).eq("project_id", project).maybeSingle();
  if (!link) back("status=error");
  const map = selectMapFromForm((k) => String(form.get(k) ?? "").trim());
  if (Object.keys(map).length > 0) {
    const fields = await readJiraSelectFields(link.connection_id as string, link.site_id as string, link.jira_project_key as string, link.initiative_type_id as string).catch((): null => null);
    if (!fields) back(`status=field-config-invalid&why=${encodeURIComponent("The fields of this Jira site could not be read just now, so the initiative fields cannot be saved. Try again in a minute.")}`);
    const errors = validateSelectMap(map, new Map(fields.map((f) => [f.id, f.options.map((o) => o.id)])));
    if (errors.length > 0) back(`status=field-config-invalid&why=${encodeURIComponent(errors.join(" ").slice(0, 400))}`);
  }
  const r = await ctx.supabase.rpc("jira_set_select_map", { p_project: project, p_rows: selectRows(map) });
  revalidatePath(MAPPING);
  back(`status=${r.error ? "error" : "field-config-saved"}`);
}

/**
 * Copies the saved field settings of one project to others linked to Jira on the SAME site (the "Copy to other projects" box of Field mapping): the switches
 * and due date field (tracker_field_config) and the start date, theme and priority fields (the Jira field map). Field ids differ between sites, so a project
 * on another site is skipped. Written by the same database functions as a normal save. A project with nothing saved copies the defaults. Admin only.
 */
export async function copyJiraFieldConfig(form: FormData): Promise<void> {
  const ctx = await adminOnly();
  if (!ctx) redirect(`${PATH}?status=not-admin`);
  const from = String(form.get("from") ?? "");
  const to = [...new Set(form.getAll("to").map(String))].filter((x) => x && x !== from);
  const back: (status: string) => never = (status) => redirect(`${MAPPING}?project=${encodeURIComponent(from)}&status=${status}&t=${Date.now()}`);
  if (to.length === 0) back("copy-none");
  const [{ data: srcLink }, { data: srcRows }, { data: targets }] = await Promise.all([
    ctx.supabase.from("jira_project_links").select("connection_id, site_id, field_map").eq("tenant_id", ctx.active.tenantId).eq("project_id", from).maybeSingle(),
    ctx.supabase.from("tracker_field_config").select("slot, enabled, field_id, label_text").eq("tenant_id", ctx.active.tenantId).eq("provider", "jira").eq("project_id", from),
    ctx.supabase.from("jira_project_links").select("project_id, connection_id, site_id").eq("tenant_id", ctx.active.tenantId).in("project_id", to),
  ]);
  if (!srcLink) back("error");
  const rows = ((srcRows ?? []) as { slot: string; enabled: boolean; field_id: string | null; label_text: string | null }[]).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id, text: r.label_text ?? null }));
  const map = parseFieldMap(srcLink!.field_map);
  let failed = 0;
  for (const t of (targets ?? []) as { project_id: string; connection_id: string; site_id: string }[]) {
    if (t.connection_id !== srcLink!.connection_id || t.site_id !== srcLink!.site_id) continue; // another site has other field ids
    const first = await ctx.supabase.rpc("jira_set_field_map", { p_project: t.project_id, p_map: map });
    const second = first.error ? null : await ctx.supabase.rpc("tracker_set_field_config", { p_project: t.project_id, p_rows: rows });
    if (first.error || second?.error) failed++;
  }
  revalidatePath(MAPPING);
  back(failed > 0 ? "error" : "field-config-copied");
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
  next.set("access", String(form.get("access") ?? "write"));
  return linkJiraProject(next);
}
