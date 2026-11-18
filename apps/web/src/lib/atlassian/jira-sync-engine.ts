import { parseSelectMap, selectRowsToMap, type SelectMap } from "./select-map";
import { DISCOVER_NOT_SYNCED, FROZEN_NOT_SYNCED } from "@pv/github";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { columnOnItems, FIELD_BY_KEY } from "@pv/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanItem, PushItemResult, ReceiveItem, SyncChoice, SyncConflict, SyncPreview, TakenOver } from "@/lib/github/push-types";
import { adfToText, markdownToAdf } from "./adf";
import { findByMarker, readIssue } from "./jira-issue";
import { epicResultText, linkEpics, planEpics, type EpicPlanLine, type EpicRequest } from "./epic-link";
import { getJson } from "./read-client";
import { readIssuesByKey, type SearchPage } from "./read-issues";
import { compareJira, COLUMN, LABEL, TEXT_FIELDS, markerFor, planJiraSend, type JiraBase, type PvItem, type SendPlan, type TextField } from "./jira-sync-core";
import type { SelectKey } from "./jira-sync-core";
import { OUTBOUND_JIRA_FIELDS } from "./outbound";
import { createIssue, updateIssue, type JiraRequest } from "./jira-write";
import { parseFieldMap } from "./field-map";
import { documentLinks, documentsPreviewNote } from "@pv/domain";
import { wroteJira } from "@/lib/sync-wrote";
import { documentUrl, shareUrl } from "@/lib/files/serve";
import type { Link } from "./jira-sections";
import { dropMissingFields } from "./mapped-fields";
import { effectiveJiraMap, parseConfigRows } from "@/lib/tracker-fields/mapping";
import { jiraRequest } from "./server";
import { ReconnectNeeded } from "./token-provider";
import { planJiraReady, writeJiraReady, type JiraReadyPlan } from "./jira-ready";

// The write half of "Sync with Jira" on the server (issue #67, #71): compare with the issue, say what would go out, and after the person
// confirmed, write ONE initiative at a time. Reading comes first; the write is idempotent (a hash of what was sent, a marker label on a created
// issue) and audited by the database functions of migration jira_sync_write (actor = the person, source UI). Status and transitions are not
// reachable from here (rule 6). Claude and service accounts never reach this code: the server action refuses them before (jira-sync.ts).

type Db = SupabaseClient;
export type Ctx = { supabase: Db; tenantId: string; userId: string; /** Public address of this app, for the share links of files (Files section); without it files are not linked. */ appUrl?: string };
type ItemRow = { initiative_phase?: string | null; tags?: string[]; focus_area?: string | null; value_type?: string | null; g2m_quarter?: string | null; id: string; item_code: string; initiative_name: string; summary: string | null; description: string | null; hypothesis: string | null; moscow: string | null; g2m_date_est: string | null; planned_start: string | null; stack_rank: number | null; change_type: string | null; theme: string | null; home_project_id: string | null };
/** The real column of each allowlisted field (G2M Date (est) lives in `end_date`): a column that does not exist makes the whole read fail, so they come from the field registry, as the GitHub push does. */
/** The allowlisted fields that are columns of items; Tags live in item_tags and are read apart. */
export const ITEM_COLUMNS: Record<string, string> = Object.fromEntries(OUTBOUND_JIRA_FIELDS.flatMap((k) => { const c = columnOnItems(FIELD_BY_KEY[k]!); return c ? [[k, c]] : []; }));
type LinkRow = { item_id: string; connection_id: string; site_id: string; issue_key: string; issue_id: string | null; html_url: string | null; mode: "follow" | "push"; sync_base: JiraBase | null; sent_hash: string | null; frozen_at?: string | null };
type ProjectLink = { selectRows?: unknown; project_id: string; connection_id: string; site_id: string; jira_project_key: string; jira_project_name: string; initiative_type_id: string; field_map?: unknown; /** Rows of tracker_field_config (the field configuration), as stored. */ config?: unknown };
type Conn = { id: string; sites: { id: string; name: string; url: string }[]; state: string };

export type Loaded = { /** Ready for build (issue #358): Gate B passed (ready_for_build_at set, phase Build) and the Jira move to To do was not handled yet. */ readyPending?: boolean; /** Artifact links and share links of files, for the Artifacts and Files sections. */ artifacts?: Link[]; files?: Link[]; /** The documents left shared, each as a name and a public link (the Documents section). */ documents?: Link[]; /** Epics asked for under this initiative (issue #431) that are not under it yet: pending ones and the ones Jira refused last time. */ epicRequests?: EpicRequest[]; /** What the preview says about the documents (sent, skipped, too long). */ documentsNote?: string; /** Files that have no share link and so are not in the description. */ unsharedFiles?: number; projectName?: string; /** Set when the initiative was removed (Trash), its Jira issue was closed by Product Velocity, and it was restored since: the issue is not reopened. */ closedWhileRemoved?: string | null; item: ItemRow; link: LinkRow | null; plink: ProjectLink | null; conn: Conn | null; siteUrl: string | null };

export const COLS = ["id", "item_code", ...Object.values(ITEM_COLUMNS), "home_project_id"].filter((c, i, a) => a.indexOf(c) === i).join(", ");
/** A row as read with COLS, with the allowlisted values under their field keys. */
const asItemRow = (row: Record<string, unknown>): ItemRow => { const out: Record<string, unknown> = { ...row }; for (const [k, col] of Object.entries(ITEM_COLUMNS)) out[k] = row[col]; return out as ItemRow; };
export async function load(ctx: Ctx, id: string): Promise<Loaded | null> {
  const { data: itemData } = await ctx.supabase.from("items").select(COLS).eq("tenant_id", ctx.tenantId).is("deleted_at", null).eq("id", id).maybeSingle();
  const item = itemData as unknown as (Record<string, unknown> & { home_project_id: string | null }) | null;
  if (!item) return null;
  const { data: link } = await ctx.supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, sync_base, sent_hash, frozen_at").eq("tenant_id", ctx.tenantId).eq("item_id", id).maybeSingle();
  const l = (link ?? null) as LinkRow | null;
  const pq = ctx.supabase.from("jira_project_links").select("project_id, connection_id, site_id, jira_project_key, jira_project_name, initiative_type_id").eq("tenant_id", ctx.tenantId);
  const { data: plinks } = l ? await pq.eq("connection_id", l.connection_id).eq("site_id", l.site_id) : item.home_project_id ? await pq.eq("project_id", item.home_project_id) : { data: [] };
  const plink = ((plinks ?? []) as ProjectLink[]).find((p) => (l ? l.issue_key.startsWith(`${p.jira_project_key}-`) : true)) ?? null;
  // the field mapping is read apart from the link: a database that has not got that column yet must not make the whole link unreadable (nothing is then mapped)
  if (plink) {
    const { data: m } = await ctx.supabase.from("jira_project_links").select("field_map").eq("tenant_id", ctx.tenantId).eq("project_id", plink.project_id).maybeSingle();
    plink.field_map = (m as { field_map?: unknown } | null)?.field_map ?? {};
    // the field configuration (what was switched off or re-pointed for this project), read apart for the same reason: no table, no configuration
    const { data: cfg } = await ctx.supabase.from("tracker_field_config").select("slot, enabled, field_id, label_text").eq("tenant_id", ctx.tenantId).eq("project_id", plink.project_id).eq("provider", "jira");
    // Health, Initiative Status and Initiative Phase on custom select fields (issue #512), read apart: no table, nothing mapped
    const { data: sel } = await ctx.supabase.from("jira_select_map").select("slot, field_id, direction, options").eq("tenant_id", ctx.tenantId).eq("project_id", plink.project_id);
    plink.selectRows = sel ?? [];
    plink.config = ((cfg ?? []) as { slot: string; enabled: boolean; field_id: string | null; label_text?: string | null }[]).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id, text: r.label_text ?? null }));
  }
  // read apart too (migration jira_close_removed): without the column nothing was ever closed
  let closedWhileRemoved: string | null = null;
  if (l) {
    const { data: r, error: re } = await ctx.supabase.from("item_jira_links").select("removed_result").eq("tenant_id", ctx.tenantId).eq("item_id", id).maybeSingle();
    if (!re) closedWhileRemoved = (r as { removed_result?: string | null } | null)?.removed_result ?? null;
  }
  // Ready for build, read apart (migration ready_at_gate_b): without the columns nothing is offered
  let readyPending = false;
  const { data: rd, error: rdErr } = await ctx.supabase.from("items").select("ready_for_build_at, initiative_phase").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
  if (!rdErr && (rd as { ready_for_build_at?: string | null; initiative_phase?: string | null } | null)?.ready_for_build_at && (rd as { initiative_phase?: string | null }).initiative_phase === "Build") {
    if (!l) readyPending = true;
    else {
      const { data: h, error: hErr } = await ctx.supabase.from("item_jira_links").select("ready_handled_at").eq("tenant_id", ctx.tenantId).eq("item_id", id).maybeSingle();
      readyPending = !hErr && !(h as { ready_handled_at?: string | null } | null)?.ready_handled_at;
    }
  }
  const connId = l?.connection_id ?? plink?.connection_id;
  const { data: conn } = connId ? await ctx.supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", ctx.tenantId).eq("id", connId).maybeSingle() : { data: null };
  const c = (conn ?? null) as Conn | null;
  const siteId = l?.site_id ?? plink?.site_id;
  const { data: proj } = item.home_project_id ? await ctx.supabase.from("projects").select("name").eq("tenant_id", ctx.tenantId).eq("id", item.home_project_id).maybeSingle() : { data: null };
  const projectName = (proj as { name?: string } | null)?.name;
  // the tags, only read (they leave as labels when the project switches that on)
  const { data: tagRows } = await ctx.supabase.from("item_tags").select("value").eq("tenant_id", ctx.tenantId).eq("item_id", id).eq("kind", "tag");
  const itemRow = asItemRow(item as Record<string, unknown>);
  itemRow.tags = ((tagRows ?? []) as { value: string }[]).map((r) => r.value);
  // the links of the initiative and the share links of its files (a file without a share link is not sent); read apart, so a database without them sends none
  const { data: linkRows } = await ctx.supabase.from("item_attachments").select("name, url").eq("tenant_id", ctx.tenantId).eq("item_id", id).eq("kind", "link").eq("shared", true).order("created_at");
  const artifacts = ((linkRows ?? []) as { name: string; url: string }[]).map((r) => ({ label: r.name, url: r.url }));
  const { data: fileRows } = await ctx.supabase.from("item_attachments").select("name, share_token").eq("tenant_id", ctx.tenantId).eq("item_id", id).eq("kind", "file").order("created_at");
  const allFiles = (fileRows ?? []) as { name: string; share_token: string | null }[];
  const files = ctx.appUrl ? allFiles.filter((r) => r.share_token).map((r) => ({ label: r.name, url: shareUrl(ctx.appUrl!, r.share_token!, r.name) })) : [];
  // the documents the person left shared, as name + public link (CLAUDE.md rule 2, changed 2026-11-06). The text is never read here; read apart, so a database without the columns sends none
  const { data: docRows } = ctx.appUrl
    ? await ctx.supabase.from("item_documents").select("kind, title, status, has_text, share_token").eq("tenant_id", ctx.tenantId).eq("item_id", id).eq("shared", true).eq("ai_draft", false).order("created_at")
    : { data: [] };
  const docsRender = documentLinks(((docRows ?? []) as { kind: string; title: string; status: string; has_text: boolean; share_token: string | null }[])
    .filter((d) => d.share_token).map((d) => ({ title: d.title, kind: d.kind, status: d.status, hasText: d.has_text, url: documentUrl(ctx.appUrl!, d.share_token!, d.title) })));
  const documents = docsRender.links;
  const documentsNote = documentsPreviewNote(docsRender, "Jira description");
  const unsharedFiles = ctx.appUrl ? allFiles.filter((r) => !r.share_token).length : 0;
  // the epics asked for under this initiative, read apart (migration jira_epic_requests): without the table none are offered
  const { data: epicRows, error: epicErr } = await ctx.supabase.from("item_jira_epic_requests").select("epic_key, state, last_error").eq("tenant_id", ctx.tenantId).eq("item_id", id).in("state", ["pending", "failed"]).order("epic_key");
  const epicRequests: EpicRequest[] = epicErr ? [] : ((epicRows ?? []) as { epic_key: string; state: "pending" | "failed"; last_error: string | null }[]).map((r) => ({ key: r.epic_key, state: r.state, lastError: r.last_error }));
  return { ...(epicRequests.length ? { epicRequests } : {}), ...(artifacts.length ? { artifacts } : {}), ...(files.length ? { files } : {}), ...(documents.length ? { documents } : {}), ...(documentsNote ? { documentsNote } : {}), ...(unsharedFiles ? { unsharedFiles } : {}), ...(projectName ? { projectName } : {}), ...(closedWhileRemoved ? { closedWhileRemoved } : {}), ...(readyPending ? { readyPending } : {}), item: itemRow, link: l, plink, conn: c, siteUrl: c?.sites.find((s) => s.id === siteId)?.url ?? null };
}

export const pvOf = (i: ItemRow): PvItem => ({ id: i.id, health: (i as { health?: string | null }).health ?? null, initiative_status: (i as { initiative_status?: string | null }).initiative_status ?? null, initiative_phase: i.initiative_phase ?? null, name: i.initiative_name, summary: i.summary, focus_area: i.focus_area, value_type: i.value_type, g2m_quarter: i.g2m_quarter, tags: i.tags, description: i.description, hypothesis: i.hypothesis, moscow: i.moscow, g2m_date_est: i.g2m_date_est, planned_start: i.planned_start, stack_rank: i.stack_rank, change_type: i.change_type, theme: i.theme });
const RECONNECT = "Jira needs a new sign-in. A workspace admin can sign in again under Settings > Integrations > Jira.";

/**
 * What a confirmed send would do for each epic asked for under this initiative (issue #431): reads the project's initiative type and the epics from
 * Jira, writes nothing. Used by the preview of Sync with Jira and by the check on the initiative's Jira tab, so the two always agree. A lost
 * sign-in throws ReconnectNeeded.
 */
export async function planEpicsFor(l: Loaded, req: JiraRequest): Promise<EpicPlanLine[]> {
  const requests = l.epicRequests ?? [];
  if (requests.length === 0) return [];
  const key = l.plink?.jira_project_key ?? l.link?.issue_key.split("-")[0] ?? "";
  let aboveEpic: boolean | null = null;
  const pj = await req("GET", `/project/${key}`);
  const types = typeof pj.json === "object" && pj.json !== null && Array.isArray((pj.json as { issueTypes?: unknown }).issueTypes) ? (pj.json as { issueTypes: { id?: unknown; hierarchyLevel?: unknown }[] }).issueTypes : [];
  const t = types.find((x) => String(x.id) === l.plink?.initiative_type_id);
  if (pj.status === 200 && t && typeof t.hierarchyLevel === "number") aboveEpic = t.hierarchyLevel >= 2;
  const read = await readIssuesByKey((p) => getJson<SearchPage>(req, p), requests.map((r) => r.key), l.siteUrl ?? "");
  return planEpics({ requests, read: read.rows, missing: read.missing, initiativeKey: l.link?.issue_key ?? null, aboveEpic });
}

export type EpicCheck = { ok: true; lines: { key: string; text: string; ok: boolean }[] } | { ok: false; error: string };

/** The check on the initiative's Jira tab: for each epic asked for, whether a send would link it (OK) or why not. Reads Jira only. */
export async function checkEpics(ctx: Ctx, id: string, deps: { call?: JiraRequest } = {}): Promise<EpicCheck> {
  const l = await load(ctx, id);
  if (!l) return { ok: false, error: "This initiative was not found." };
  if (!l.epicRequests?.length) return { ok: true, lines: [] };
  if (l.link?.mode === "follow") return { ok: false, error: "This initiative follows its Jira issue read-only: take ownership first." };
  if (!l.plink && !l.link) return { ok: false, error: "This initiative's project is not linked to a Jira project." };
  if (!l.conn || l.conn.state !== "connected" || !l.siteUrl) return { ok: false, error: l.conn?.state === "reconnect_needed" ? RECONNECT : "Jira is not connected for this workspace." };
  try {
    const lines = await planEpicsFor(l, deps.call ?? jiraRequest(l.conn.id, l.link?.site_id ?? l.plink!.site_id));
    return { ok: true, lines: lines.map((x) => ({ key: x.key, text: x.text, ok: x.will || x.already === true })) };
  } catch (e) {
    return { ok: false, error: e instanceof ReconnectNeeded ? RECONNECT : "Jira could not be read just now. Try again in a minute." };
  }
}

export type Evaluated =
  | { kind: "error"; message: string; reconnect?: boolean }
  | { kind: "missing"; message: string }
  | { kind: "follows" }
  | { kind: "no_project" }
  | { kind: "discover" }
  | { kind: "frozen" }
  | { kind: "ok"; ready?: JiraReadyPlan; readyNote?: string; epics?: EpicPlanLine[]; plan: SendPlan; conflicts: SyncConflict[]; jiraHashes: Partial<Record<TextField, string>>; selectHashes: Partial<Record<SelectKey, string>>; card: Pick<PlanItem, "ready" | "id" | "tracker" | "code" | "name" | "project" | "repo" | "action" | "title" | "labels" | "block" | "issueNumber" | "issueUrl" | "issueLabel" | "notes" | "epics"> };

/** Reads the issue (if there is one) and decides, given the choices made so far, what would go out. */
export async function evaluate(l: Loaded, picks: Partial<Record<TextField, "pv" | "jira">>, call?: JiraRequest, selectPicks: Partial<Record<SelectKey, "pv" | "jira">> = {}): Promise<Evaluated> {
  if (l.link?.frozen_at) return { kind: "frozen" };
  if (l.link?.mode === "follow") return { kind: "follows" };
  if (!l.link && !l.plink) return { kind: "no_project" };
  if (!l.link && l.item.initiative_phase === "Discover") return { kind: "discover" };
  if (!l.conn || l.conn.state !== "connected" || !l.siteUrl) return l.conn?.state === "reconnect_needed" ? { kind: "error", message: RECONNECT, reconnect: true } : { kind: "error", message: "Jira is not connected for this workspace." };
  const req = call ?? jiraRequest(l.conn.id, (l.link?.site_id ?? l.plink!.site_id));
  const pv = pvOf(l.item);
  const code = l.item.item_code;
  const project = l.plink?.jira_project_name ?? "Jira";
  const key = l.plink?.jira_project_key ?? l.link!.issue_key.split("-")[0]!;
  const selects = parseSelectMap(selectRowsToMap(l.plink?.selectRows));
  let now: Awaited<ReturnType<typeof readIssue>> | null = null;
  try {
    if (l.link) now = await readIssue(req, l.link.issue_key, undefined, Object.values(selects).map((c) => c!.field));
  } catch (e) {
    return e instanceof ReconnectNeeded ? { kind: "error", message: RECONNECT, reconnect: true } : { kind: "error", message: "Jira could not be read just now. Try again in a minute." };
  }
  if (now && !now.ok) return now.kind === "gone" ? { kind: "missing", message: now.message } : { kind: "error", message: now.message, reconnect: now.kind === "reconnect" };
  const issue = now && now.ok ? now.issue : null;
  // the saved field configuration, with the custom fields it names checked against the site now (a field that is gone is left out and the preview says so)
  const checked = await dropMissingFields(req, effectiveJiraMap(parseFieldMap(l.plink?.field_map), parseConfigRows(l.plink?.config, "jira")), { cacheKey: `${l.conn.id}|${l.link?.site_id ?? l.plink!.site_id}` });
  const plan = planJiraSend({ pv, jira: issue, base: l.link?.sync_base ?? null, sentHash: l.link?.sent_hash ?? null, picks, selectPicks, selectsNow: Object.fromEntries(Object.entries(selects).map(([slot, c]) => [slot, issue?.custom[c!.field] ?? null])), map: { ...checked.map, ...(Object.keys(selects).length > 0 ? { selects } : {}) }, ...(l.artifacts ? { artifacts: l.artifacts } : {}), ...(l.documents ? { documents: l.documents } : {}), ...(l.files ? { files: l.files } : {}), ...(l.projectName ? { projectName: l.projectName } : {}), ...(l.plink && !l.link ? { create: { projectKey: key, issueTypeId: l.plink.initiative_type_id } } : {}) });
  plan.notes.push(...checked.notes);
  if (l.documentsNote) plan.notes.push(l.documentsNote);
  if (l.unsharedFiles && !checked.map.off?.includes("jira.body.files")) plan.notes.push(`${l.unsharedFiles === 1 ? "1 attached file has" : `${l.unsharedFiles} attached files have`} no share link, so ${l.unsharedFiles === 1 ? "it is" : "they are"} not in the description. Share it on the item's Spec tab to include it.`);
  const conflicts: SyncConflict[] = [];
  const jiraHashes: Partial<Record<TextField, string>> = {};
  const selectHashes: Partial<Record<SelectKey, string>> = {};
  if (issue) {
    for (const f of compareJira(pv, issue, l.link?.sync_base).fields) {
      jiraHashes[f.field] = f.jiraHash;
      if (f.verdict !== "github" && f.verdict !== "both") continue;
      conflicts.push({ field: f.field, label: LABEL[f.field], kind: f.verdict === "github" ? "github" : "both", pv: f.pvText, github: f.jiraText, ghHash: f.jiraHash, defaultChoice: f.verdict === "github" ? "pv" : null });
    }
    // Health and Initiative Status changed in Jira (issue #512): shown like a text conflict, never applied without a choice
    for (const c of plan.selectConflicts) {
      selectHashes[c.pvKey] = c.jiraHash;
      conflicts.push({ field: c.pvKey, label: c.label, kind: c.verdict === "jira" ? "github" : "both", pv: c.pv || "(empty)", github: c.jira, ghHash: c.jiraHash, defaultChoice: c.verdict === "jira" ? "pv" : null });
    }
  }
  // Ready for build: reads the status and the allowed transitions (no write) so the preview can say what would happen
  let ready: JiraReadyPlan | undefined;
  let readyNote: string | undefined;
  if (l.readyPending) {
    if (!l.link) ready = { state: "set", text: "Move to To do (after the issue is created, if it starts in another To Do status)", transition: { id: "0", name: "", toStatusName: "To do" }, from: "" };
    else {
      try {
        const rr = await planJiraReady(req, l.link.issue_key);
        if (rr.ok) ready = rr.plan; else readyNote = rr.message;
      } catch (e) { if (e instanceof ReconnectNeeded) return { kind: "error", message: RECONNECT, reconnect: true }; readyNote = "Jira could not be read just now, so its status is left as it is."; }
    }
  }
  // epics asked for under this initiative (issue #431): read them and the project's initiative type, no write; failures only leave the epics out of the preview
  let epics: EpicPlanLine[] | undefined;
  if (l.epicRequests?.length) {
    try {
      epics = await planEpicsFor(l, req);
    } catch (e) {
      if (e instanceof ReconnectNeeded) return { kind: "error", message: RECONNECT, reconnect: true };
      epics = l.epicRequests.map((r) => ({ key: r.key, will: false, previousParent: null, text: `${r.key}: Jira could not be read just now, so this epic is left for the next sync.` }));
    }
  }
  const epicsView = epics?.length ? { epics: epics.map((x) => ({ key: x.key, text: x.text, will: x.will })) } : {};
  const url = l.link ? (l.link.html_url ?? (l.siteUrl ? `${l.siteUrl}/browse/${l.link.issue_key}` : null)) : null;
  const readyView = ready && (ready.state === "set" || ready.state === "blocked") ? { ready: { text: ready.text, will: ready.state === "set" } } : readyNote ? { ready: { text: readyNote, will: false } } : {};
  const card = { id: l.item.id, tracker: "jira" as const, code, name: l.item.initiative_name, project, repo: key, action: plan.action, title: String(plan.fields.summary ?? l.item.initiative_name), labels: (plan.fields.labels as string[] | undefined) ?? [], block: adfToText(plan.fields.description ?? markdownToAdf("")), issueNumber: null, issueUrl: url, ...(l.link ? { issueLabel: l.link.issue_key } : {}), ...(plan.notes.length ? { notes: plan.notes } : {}), ...readyView, ...epicsView };
  return { kind: "ok", plan, conflicts, jiraHashes, selectHashes, card, ...(ready ? { ready } : {}), ...(epics ? { epics } : {}) };
}
/** What the preview shows for the send half of one initiative. */
export function previewParts(e: Evaluated): { conflicts: SyncConflict[]; plan?: PlanItem; create: boolean } {
  if (e.kind !== "ok") return { conflicts: [], create: false };
  const plan: PlanItem | undefined = e.card.action === "unchanged" && e.conflicts.length === 0 && !e.card.issueLabel && !e.card.ready && !e.card.epics?.length ? undefined : e.card;
  return { conflicts: e.conflicts, ...(plan ? { plan } : {}), create: e.plan.action === "create" };
}

export type WriteResult = { result: PushItemResult; taken: TakenOver[] } | { stale: true; error: string };

/**
 * Writes ONE initiative after the person confirmed. Reads Jira again first: if the difference is not what the preview showed (a conflict
 * without a choice, or Jira's text changed since), nothing is written and `stale` asks for a new preview. Order: take over the chosen Jira
 * texts, then send Product Velocity's, then record the new base (only after the send worked, so a failure retries next time).
 */
export async function writeOne(ctx: Ctx, id: string, choices: SyncChoice[], deps: { call?: JiraRequest } = {}): Promise<WriteResult> {
  const l = await load(ctx, id);
  if (!l) return { result: { id, code: "", outcome: "error", message: "This initiative was not found." }, taken: [] };
  const code = l.item.item_code;
  const base = { id, code };
  const picks: Partial<Record<TextField, "pv" | "jira">> = {};
  const seen: Partial<Record<TextField, string>> = {};
  const selectPicks: Partial<Record<SelectKey, "pv" | "jira">> = {};
  const selectSeen: Partial<Record<SelectKey, string>> = {};
  for (const c of choices) {
    if (c.itemId !== id) continue;
    if ((TEXT_FIELDS as readonly string[]).includes(c.field)) { picks[c.field as TextField] = c.choice === "pv" ? "pv" : "jira"; seen[c.field as TextField] = c.ghHash; }
    else if (c.field === "health" || c.field === "initiative_status") { selectPicks[c.field] = c.choice === "pv" ? "pv" : "jira"; selectSeen[c.field] = c.ghHash; }
  }
  const e = await evaluate(l, picks, deps.call, selectPicks);
  if (e.kind === "follows") return { result: { ...base, outcome: "blocked", message: "This initiative follows its Jira issue read-only: nothing is sent." }, taken: [] };
  if (e.kind === "frozen") return { result: { ...base, outcome: "blocked", message: FROZEN_NOT_SYNCED }, taken: [] };
  if (e.kind === "discover") return { result: { ...base, outcome: "blocked", message: DISCOVER_NOT_SYNCED }, taken: [] };
  if (e.kind === "no_project") return { result: { ...base, outcome: "blocked", message: "This initiative's project is not linked to a Jira project." }, taken: [] };
  if (e.kind === "missing") return { result: { ...base, outcome: "missing", message: e.message }, taken: [] };
  if (e.kind === "error") return { result: { ...base, outcome: "error", message: e.message }, taken: [] };
  // Jira changed since the preview, or a conflict has no choice: nothing is written
  if (e.plan.unresolved.length > 0 || e.plan.unresolvedSelects.length > 0) return { stale: true, error: "Jira has a change that was not in the preview. Nothing was written for this initiative." };
  for (const f of TEXT_FIELDS) if (picks[f] && seen[f] !== e.jiraHashes[f]) return { stale: true, error: `${LABEL[f]} changed in Jira after the preview. Nothing was written for this initiative.` };

  for (const k of ["health", "initiative_status"] as const) if (selectPicks[k] && selectSeen[k] !== e.selectHashes[k]) return { stale: true, error: `${k === "health" ? "Health" : "Initiative Status"} changed in Jira after the preview. Nothing was written for this initiative.` };
  const admin = createAdminClient({ via: "UI" });
  const taken: TakenOver[] = [];
  const plan = e.plan;
  const issueKey = l.link?.issue_key;
  const siteId = l.link?.site_id ?? l.plink!.site_id;
  const connId = l.conn!.id;
  const call = deps.call ?? jiraRequest(connId, siteId);

  // 1. take over the Jira texts the person chose (undoable, audited as the person)
  const pulled = Object.keys(plan.takeOver) as (keyof SendPlan["takeOver"])[];
  if (pulled.length > 0) {
    const pullBase: JiraBase = {};
    for (const f of TEXT_FIELDS) if (plan.takeOver[COLUMN[f]] !== undefined) pullBase[f] = plan.newBase[f]!;
    const { data, error } = await admin.rpc("jira_apply_pull", { p_actor: ctx.userId, p_item: id, p_fields: plan.takeOver, p_base: pullBase });
    if (error) return { result: { ...base, outcome: "error", message: "Could not take over the text from Jira. Nothing was sent." }, taken: [] };
    const before = (data ?? {}) as Record<string, string | null>;
    for (const col of pulled) taken.push({ itemId: id, code, field: col, before: before[col] ?? null, after: plan.takeOver[col] ?? null });
  }

  // 1b. take over the Jira values (Health, Initiative Status) the person chose: audited as the person, undoable
  const selPulled = Object.keys(plan.selectTakeOver) as SelectKey[];
  if (selPulled.length > 0) {
    const selBase: JiraBase = {};
    for (const k of selPulled) selBase[`sel_${k}`] = plan.newBase[`sel_${k}`]!;
    const { data, error } = await admin.rpc("jira_apply_select_pull", { p_actor: ctx.userId, p_item: id, p_fields: plan.selectTakeOver, p_base: selBase });
    if (error) return { result: { ...base, outcome: "error", message: "Could not take over the value from Jira. Nothing was sent." }, taken };
    const before = (data ?? {}) as Record<string, string | null>;
    for (const k of selPulled) taken.push({ itemId: id, code, field: k, before: before[k] ?? null, after: plan.selectTakeOver[k] ?? null });
  }

  const send = async (): Promise<WriteResult> => {
  // 2. send
  let resultKey = issueKey ?? "";
  let droppedNote: string | undefined; // optional fields Jira refused (not on the issue type's screen) and that were left out
  let outcome: PushItemResult["outcome"] = "unchanged";
  let issueId: string | null = l.link?.issue_id ?? null;
  if (plan.action === "create") {
    const marker = plan.marker ?? markerFor(id);
    const projectKey = l.plink!.jira_project_key;
    const existing = await findByMarker(call, projectKey, marker); // a create whose answer was lost is found again, never repeated
    if (existing) { resultKey = existing.key; issueId = existing.id; outcome = "created"; }
    else {
      const w = await createIssue(call, plan.fields);
      if (!w.ok) return { result: { ...base, outcome: w.kind === "gone" ? "missing" : "error", message: w.message }, taken };
      resultKey = w.key; issueId = w.id; outcome = "created"; droppedNote = w.dropped?.join(" ");
    }
    const url = `${l.siteUrl}/browse/${resultKey}`;
    const { error } = await admin.rpc("jira_create_link", { p_actor: ctx.userId, p_item: id, p_connection: connId, p_site: siteId, p_key: resultKey, p_issue_id: issueId, p_url: url, p_base: plan.newBase, p_sent_hash: plan.sentHash });
    if (error) return { result: { ...base, outcome: "error", issueLabel: resultKey, issueUrl: url, message: `The issue ${resultKey} exists in Jira, but linking it failed. Sync again: it will be found, not created twice.` }, taken };
    return { result: { ...base, outcome, issueLabel: resultKey, issueUrl: url, wrote: wroteJira(plan.fields), ...(droppedNote ? { message: droppedNote } : {}) }, taken };
  }
  if (plan.action === "update") {
    const w = await updateIssue(call, issueKey!, plan.fields);
    if (!w.ok) return { result: { ...base, outcome: w.kind === "gone" ? "missing" : "error", ...(issueKey ? { issueLabel: issueKey } : {}), message: w.message }, taken };
    outcome = "updated";
    droppedNote = w.dropped?.join(" ");
  }
  // 3. record what both sides now agree on (also when nothing was sent, so the first compare is stored)
  const rec = await admin.rpc("jira_record_sync", { p_actor: ctx.userId, p_item: id, p_base: plan.newBase, p_sent_hash: plan.action === "update" ? plan.sentHash : null });
  if (rec.error) return { result: { ...base, outcome: "error", ...(issueKey ? { issueLabel: issueKey } : {}), message: "Jira was updated but the sync state could not be saved. Sync again to finish." }, taken };
  const url = l.link!.html_url ?? `${l.siteUrl}/browse/${issueKey}`;
  return { result: { ...base, outcome, issueLabel: issueKey!, issueUrl: url, ...(outcome === "updated" ? { wrote: wroteJira(plan.fields) } : {}), ...(droppedNote ? { message: droppedNote } : {}) }, taken };
  };
  // Ready for build (issue #358): after the confirmed send, move the issue to To do while it is still at the start (the status is read again in writeJiraReady)
  const finishReady = async (w: WriteResult): Promise<WriteResult> => {
    if (!("result" in w) || e.ready?.state !== "set" || !["created", "updated", "unchanged"].includes(w.result.outcome)) return w;
    const key = w.result.issueLabel ?? issueKey;
    if (!key) return w;
    const r = await writeJiraReady(call, key);
    if (!r.ok) return { ...w, result: { ...w.result, outcome: w.result.outcome === "unchanged" ? "error" : w.result.outcome, message: [w.result.message, `Status was not moved to To do. ${r.message}`].filter(Boolean).join(" ") } };
    const rec = await admin.rpc("jira_record_ready", { p_actor: ctx.userId, p_item: id, p_result: r.result, p_status: r.status });
    const said = rec.error ? "The issue is in To do, but Product Velocity could not record it." : r.result === "set" ? `Moved to ${r.status}.` : "Status is already at or past To do: it was not changed.";
    const wrote = r.result === "set" ? [...(w.result.wrote ?? []), "Status: To do"] : w.result.wrote;
    return { ...w, result: { ...w.result, outcome: w.result.outcome === "unchanged" && r.result === "set" ? "updated" : w.result.outcome, ...(wrote ? { wrote } : {}), message: [w.result.message, said].filter(Boolean).join(" ") } };
  };
  // Epics asked for under this initiative (issue #431): after the confirmed send, and only once the initiative's issue exists, set each epic's parent
  const finishEpics = async (w: WriteResult): Promise<WriteResult> => {
    if (!("result" in w) || !e.epics?.some((x) => x.will || x.already) || !["created", "updated", "unchanged"].includes(w.result.outcome)) return w;
    const parent = w.result.issueLabel ?? issueKey;
    if (!parent) return w;
    const results = await linkEpics(call, e.epics, parent);
    for (const r of results) {
      const rec = await admin.rpc("jira_record_epic_link", { p_actor: ctx.userId, p_item: id, p_key: r.key, p_ok: r.ok, p_previous_parent: r.previousParent, p_error: r.error });
      if (rec.error) r.error = r.error ?? "Product Velocity could not record it, so it will be offered again (nothing is moved twice).";
    }
    const said = epicResultText(results, parent);
    const moved = results.filter((r) => r.ok).map((r) => r.key);
    const wrote = moved.length > 0 ? [...(w.result.wrote ?? []), `Parent of ${moved.join(", ")}`] : w.result.wrote;
    return { ...w, result: { ...w.result, outcome: w.result.outcome === "unchanged" && moved.length > 0 ? "updated" : w.result.outcome, ...(wrote ? { wrote } : {}), message: [w.result.message, said].filter(Boolean).join(" ") } };
  };
  try {
    return await finishReady(await finishEpics(await send()));
  } catch (err) {
    // a lost sign-in is shown as such and never retried; anything else is a plain failure of this initiative only
    return { result: { ...base, outcome: "error", message: err instanceof ReconnectNeeded ? RECONNECT : "Sending to Jira did not finish for this initiative. Check Jira before trying again: an issue may already exist, and sending again will find it." }, taken };
  }
}

/** Re-runs the preview of one initiative for the stale answer. */
export async function previewOne(ctx: Ctx, id: string, account: string): Promise<SyncPreview> {
  const l = await load(ctx, id);
  const received: ReceiveItem[] = [];
  const send: PlanItem[] = [];
  if (l) {
    const e = await evaluate(l, {});
    const parts = previewParts(e);
    received.push({ id, code: l.item.item_code, name: l.item.initiative_name, tracker: "jira", status: parts.conflicts.length ? "conflict" : "in_step", received: [], conflicts: parts.conflicts, issueNumber: null, ...(l.link ? { issueLabel: l.link.issue_key } : {}), issueUrl: l.link?.html_url ?? null });
    if (parts.plan) send.push(parts.plan);
  }
  return { account, received, send };
}
