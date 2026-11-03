import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanItem, PushItemResult, ReceiveItem, SyncChoice, SyncConflict, SyncPreview, TakenOver } from "@/lib/github/push-types";
import { adfToText, markdownToAdf } from "./adf";
import { findByMarker, readIssue } from "./jira-issue";
import { compareJira, COLUMN, LABEL, markerFor, planJiraSend, type JiraBase, type PvItem, type SendPlan, type TextField } from "./jira-sync-core";
import { createIssue, updateIssue, type JiraRequest } from "./jira-write";
import { parseFieldMap } from "./field-map";
import { jiraRequest } from "./server";
import { ReconnectNeeded } from "./token-provider";

// The write half of "Sync with Jira" on the server (issue #67, #71): compare with the issue, say what would go out, and after the person
// confirmed, write ONE initiative at a time. Reading comes first; the write is idempotent (a hash of what was sent, a marker label on a created
// issue) and audited by the database functions of migration jira_sync_write (actor = the person, source UI). Status and transitions are not
// reachable from here (rule 6). Claude and service accounts never reach this code: the server action refuses them before (jira-sync.ts).

type Db = SupabaseClient;
export type Ctx = { supabase: Db; tenantId: string; userId: string };
type ItemRow = { id: string; item_code: string; initiative_name: string; description: string | null; moscow: string | null; g2m_date_est: string | null; planned_start: string | null; home_project_id: string | null };
type LinkRow = { item_id: string; connection_id: string; site_id: string; issue_key: string; issue_id: string | null; html_url: string | null; mode: "follow" | "push"; sync_base: JiraBase | null; sent_hash: string | null };
type ProjectLink = { project_id: string; connection_id: string; site_id: string; jira_project_key: string; jira_project_name: string; initiative_type_id: string; field_map?: unknown };
type Conn = { id: string; sites: { id: string; name: string; url: string }[]; state: string };

export type Loaded = { item: ItemRow; link: LinkRow | null; plink: ProjectLink | null; conn: Conn | null; siteUrl: string | null };

const COLS = "id, item_code, initiative_name, description, moscow, g2m_date_est, planned_start, home_project_id";
export async function load(ctx: Ctx, id: string): Promise<Loaded | null> {
  const { data: item } = await ctx.supabase.from("items").select(COLS).eq("tenant_id", ctx.tenantId).is("deleted_at", null).eq("id", id).maybeSingle();
  if (!item) return null;
  const { data: link } = await ctx.supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key, issue_id, html_url, mode, sync_base, sent_hash").eq("tenant_id", ctx.tenantId).eq("item_id", id).maybeSingle();
  const l = (link ?? null) as LinkRow | null;
  const pq = ctx.supabase.from("jira_project_links").select("project_id, connection_id, site_id, jira_project_key, jira_project_name, initiative_type_id, field_map").eq("tenant_id", ctx.tenantId);
  const { data: plinks } = l ? await pq.eq("connection_id", l.connection_id).eq("site_id", l.site_id) : item.home_project_id ? await pq.eq("project_id", item.home_project_id) : { data: [] };
  const plink = ((plinks ?? []) as ProjectLink[]).find((p) => (l ? l.issue_key.startsWith(`${p.jira_project_key}-`) : true)) ?? null;
  const connId = l?.connection_id ?? plink?.connection_id;
  const { data: conn } = connId ? await ctx.supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", ctx.tenantId).eq("id", connId).maybeSingle() : { data: null };
  const c = (conn ?? null) as Conn | null;
  const siteId = l?.site_id ?? plink?.site_id;
  return { item: item as ItemRow, link: l, plink, conn: c, siteUrl: c?.sites.find((s) => s.id === siteId)?.url ?? null };
}

export const pvOf = (i: ItemRow): PvItem => ({ id: i.id, name: i.initiative_name, description: i.description, moscow: i.moscow, g2m_date_est: i.g2m_date_est, planned_start: i.planned_start });
const RECONNECT = "Jira needs a new sign-in. A workspace admin can sign in again under Settings > Integrations > Jira.";

export type Evaluated =
  | { kind: "error"; message: string; reconnect?: boolean }
  | { kind: "missing"; message: string }
  | { kind: "follows" }
  | { kind: "no_project" }
  | { kind: "ok"; plan: SendPlan; conflicts: SyncConflict[]; jiraHashes: Partial<Record<TextField, string>>; card: Pick<PlanItem, "id" | "tracker" | "code" | "name" | "project" | "repo" | "action" | "title" | "labels" | "block" | "issueNumber" | "issueUrl" | "issueLabel" | "notes"> };

/** Reads the issue (if there is one) and decides, given the choices made so far, what would go out. */
export async function evaluate(l: Loaded, picks: Partial<Record<TextField, "pv" | "jira">>, call?: JiraRequest): Promise<Evaluated> {
  if (l.link?.mode === "follow") return { kind: "follows" };
  if (!l.link && !l.plink) return { kind: "no_project" };
  if (!l.conn || l.conn.state !== "connected" || !l.siteUrl) return l.conn?.state === "reconnect_needed" ? { kind: "error", message: RECONNECT, reconnect: true } : { kind: "error", message: "Jira is not connected for this workspace." };
  const req = call ?? jiraRequest(l.conn.id, (l.link?.site_id ?? l.plink!.site_id));
  const pv = pvOf(l.item);
  const code = l.item.item_code;
  const project = l.plink?.jira_project_name ?? "Jira";
  const key = l.plink?.jira_project_key ?? l.link!.issue_key.split("-")[0]!;
  let now: Awaited<ReturnType<typeof readIssue>> | null = null;
  try {
    if (l.link) now = await readIssue(req, l.link.issue_key);
  } catch (e) {
    return e instanceof ReconnectNeeded ? { kind: "error", message: RECONNECT, reconnect: true } : { kind: "error", message: "Jira could not be read just now. Try again in a minute." };
  }
  if (now && !now.ok) return now.kind === "gone" ? { kind: "missing", message: now.message } : { kind: "error", message: now.message, reconnect: now.kind === "reconnect" };
  const issue = now && now.ok ? now.issue : null;
  const plan = planJiraSend({ pv, jira: issue, base: l.link?.sync_base ?? null, sentHash: l.link?.sent_hash ?? null, picks, map: parseFieldMap(l.plink?.field_map), ...(l.plink && !l.link ? { create: { projectKey: key, issueTypeId: l.plink.initiative_type_id } } : {}) });
  const conflicts: SyncConflict[] = [];
  const jiraHashes: Partial<Record<TextField, string>> = {};
  if (issue) {
    for (const f of compareJira(pv, issue, l.link?.sync_base).fields) {
      jiraHashes[f.field] = f.jiraHash;
      if (f.verdict !== "github" && f.verdict !== "both") continue;
      conflicts.push({ field: f.field, label: LABEL[f.field], kind: f.verdict === "github" ? "github" : "both", pv: f.pvText, github: f.jiraText, ghHash: f.jiraHash, defaultChoice: f.verdict === "github" ? "pv" : null });
    }
  }
  const url = l.link ? (l.link.html_url ?? (l.siteUrl ? `${l.siteUrl}/browse/${l.link.issue_key}` : null)) : null;
  const card = { id: l.item.id, tracker: "jira" as const, code, name: l.item.initiative_name, project, repo: key, action: plan.action, title: String(plan.fields.summary ?? l.item.initiative_name), labels: (plan.fields.labels as string[] | undefined) ?? [], block: adfToText(plan.fields.description ?? markdownToAdf("")), issueNumber: null, issueUrl: url, ...(l.link ? { issueLabel: l.link.issue_key } : {}), ...(plan.notes.length ? { notes: plan.notes } : {}) };
  return { kind: "ok", plan, conflicts, jiraHashes, card };
}
/** What the preview shows for the send half of one initiative. */
export function previewParts(e: Evaluated): { conflicts: SyncConflict[]; plan?: PlanItem; create: boolean } {
  if (e.kind !== "ok") return { conflicts: [], create: false };
  const plan: PlanItem | undefined = e.card.action === "unchanged" && e.conflicts.length === 0 && !e.card.issueLabel ? undefined : e.card;
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
  for (const c of choices) if (c.itemId === id && (c.field === "title" || c.field === "description")) { picks[c.field] = c.choice === "pv" ? "pv" : "jira"; seen[c.field] = c.ghHash; }
  const e = await evaluate(l, picks, deps.call);
  if (e.kind === "follows") return { result: { ...base, outcome: "blocked", message: "This initiative follows its Jira issue read-only: nothing is sent." }, taken: [] };
  if (e.kind === "no_project") return { result: { ...base, outcome: "blocked", message: "This initiative's project is not linked to a Jira project." }, taken: [] };
  if (e.kind === "missing") return { result: { ...base, outcome: "missing", message: e.message }, taken: [] };
  if (e.kind === "error") return { result: { ...base, outcome: "error", message: e.message }, taken: [] };
  // Jira changed since the preview, or a conflict has no choice: nothing is written
  if (e.plan.unresolved.length > 0) return { stale: true, error: "Jira has a change that was not in the preview. Nothing was written for this initiative." };
  for (const f of ["title", "description"] as const) if (picks[f] && seen[f] !== e.jiraHashes[f]) return { stale: true, error: `${LABEL[f]} changed in Jira after the preview. Nothing was written for this initiative.` };

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
    for (const f of ["title", "description"] as const) if (plan.takeOver[COLUMN[f]] !== undefined) pullBase[f] = plan.newBase[f]!;
    const { data, error } = await admin.rpc("jira_apply_pull", { p_actor: ctx.userId, p_item: id, p_fields: plan.takeOver, p_base: pullBase });
    if (error) return { result: { ...base, outcome: "error", message: "Could not take over the text from Jira. Nothing was sent." }, taken: [] };
    const before = (data ?? {}) as Record<string, string | null>;
    for (const col of pulled) taken.push({ itemId: id, code, field: col, before: before[col] ?? null, after: plan.takeOver[col] ?? null });
  }

  const send = async (): Promise<WriteResult> => {
  // 2. send
  let resultKey = issueKey ?? "";
  let outcome: PushItemResult["outcome"] = "unchanged";
  let issueId: string | null = l.link?.issue_id ?? null;
  if (plan.action === "create") {
    const marker = markerFor(id);
    const projectKey = l.plink!.jira_project_key;
    const existing = await findByMarker(call, projectKey, marker); // a create whose answer was lost is found again, never repeated
    if (existing) { resultKey = existing.key; issueId = existing.id; outcome = "created"; }
    else {
      const w = await createIssue(call, plan.fields);
      if (!w.ok) return { result: { ...base, outcome: w.kind === "gone" ? "missing" : "error", message: w.message }, taken };
      resultKey = w.key; issueId = w.id; outcome = "created";
    }
    const url = `${l.siteUrl}/browse/${resultKey}`;
    const { error } = await admin.rpc("jira_create_link", { p_actor: ctx.userId, p_item: id, p_connection: connId, p_site: siteId, p_key: resultKey, p_issue_id: issueId, p_url: url, p_base: plan.newBase, p_sent_hash: plan.sentHash });
    if (error) return { result: { ...base, outcome: "error", issueLabel: resultKey, issueUrl: url, message: `The issue ${resultKey} exists in Jira, but linking it failed. Sync again: it will be found, not created twice.` }, taken };
    return { result: { ...base, outcome, issueLabel: resultKey, issueUrl: url }, taken };
  }
  if (plan.action === "update") {
    const w = await updateIssue(call, issueKey!, plan.fields);
    if (!w.ok) return { result: { ...base, outcome: w.kind === "gone" ? "missing" : "error", ...(issueKey ? { issueLabel: issueKey } : {}), message: w.message }, taken };
    outcome = "updated";
  }
  // 3. record what both sides now agree on (also when nothing was sent, so the first compare is stored)
  const rec = await admin.rpc("jira_record_sync", { p_actor: ctx.userId, p_item: id, p_base: plan.newBase, p_sent_hash: plan.action === "update" ? plan.sentHash : null });
  if (rec.error) return { result: { ...base, outcome: "error", ...(issueKey ? { issueLabel: issueKey } : {}), message: "Jira was updated but the sync state could not be saved. Sync again to finish." }, taken };
  const url = l.link!.html_url ?? `${l.siteUrl}/browse/${issueKey}`;
  return { result: { ...base, outcome, issueLabel: issueKey!, issueUrl: url }, taken };
  };
  try {
    return await send();
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
