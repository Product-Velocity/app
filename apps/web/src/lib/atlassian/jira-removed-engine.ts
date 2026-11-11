import { stoppedItems } from "@/lib/tracker/stopped";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RemovedCard, RemovedList, RemovedResult } from "@/lib/github/push-types";
import { namesForItem } from "@/lib/tracker-fields/load-names";
import { addRemovedLabel, chooseTransition, closeWith, readCloseState, type CloseState } from "./jira-close";
import type { JiraRequest } from "./jira-write";
import type { Ctx } from "./jira-sync-engine";
import { jiraRequest } from "./server";

// "Removed in Product Velocity" on the server (decision 2026-11-03-jira-close-removed). An initiative that was deleted sits in the Trash
// (items.deleted_at) and never touched Jira. For each one in the Trash whose Jira link is in mode `push` (Product Velocity owns the issue)
// and that was not handled yet, `listRemoved` reads the issue (status, Done transitions) so the preview can say what will happen; `closeOne`
// writes ONE initiative after the person confirmed: it reads Jira again, adds the label `pv:removed`, moves the issue to a Done status and
// records that it was handled. NEVER for a link in mode `follow` (the issue came from Jira), never for an initiative that is not in the Trash,
// never a delete. Claude and service accounts never reach this code: the server action refuses them before (jira-removed.ts) and the database
// function refuses them again. The columns of migration jira_close_removed are read apart from everything else: a database that does not have
// them yet offers nothing (it cannot remember what it did), and the rest of the app is unaffected.

const LIMIT = 25;
const IN_CHUNK = 100;
type Link = { item_id: string; connection_id: string; site_id: string; issue_key: string; html_url: string | null };
type Conn = { id: string; sites: { id: string; name: string; url: string }[]; state: string };
type Candidate = { /** Stopped at this gate (Cancelled), not deleted. */ stoppedGate?: string; id: string; code: string; name: string; /** The issue was adopted from Jira (the initiative was pulled in with "PV takes ownership"), not created by Sync: closing it ends real work there. */ adopted: boolean; link: Link; conn: Conn | null; siteUrl: string | null; rememberedStatusId: string | null };
const RECONNECT = "Jira needs a new sign-in. A workspace admin can sign in again under Settings > Integrations > Jira.";
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** The Trash entries that Product Velocity may close in Jira, newest first, or null when the database cannot remember handling them yet (migration not applied). */
async function candidates(ctx: Ctx, only?: string): Promise<{ list: Candidate[]; total: number } | { error: string } | null> {
  const { data: trashed, error } = await ctx.supabase.rpc("trashed_items", { p_tenant: ctx.tenantId }); // creators and admins only; deleted rows are invisible to every other read
  if (error) return { error: "The Trash could not be read." };
  const trashRows = ((trashed ?? []) as { id: string; item_code: string; initiative_name: string }[]).filter((t) => !only || t.id === only);
  // initiatives an approver stopped at a gate are offered like removed ones (issue #343)
  const stopped = new Map((await stoppedItems(ctx, only)).filter((s) => !trashRows.some((t) => t.id === s.id)).map((s) => [s.id, s]));
  const rows = [...trashRows, ...[...stopped.values()].map((s) => ({ id: s.id, item_code: s.item_code, initiative_name: s.initiative_name }))];
  if (rows.length === 0) return { list: [], total: 0 };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const links: Link[] = [];
  const handled = new Set<string>();
  for (const part of chunk(rows.map((r) => r.id), IN_CHUNK)) {
    const { data } = await ctx.supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key, html_url").eq("tenant_id", ctx.tenantId).eq("mode", "push").in("item_id", part);
    links.push(...((data ?? []) as Link[]));
    // apart from the rest: no column yet means nothing can be remembered, so nothing is offered
    const flags = await ctx.supabase.from("item_jira_links").select("item_id, removed_handled_at").eq("tenant_id", ctx.tenantId).eq("mode", "push").in("item_id", part);
    if (flags.error) return null;
    for (const f of (flags.data ?? []) as { item_id: string; removed_handled_at: string | null }[]) if (f.removed_handled_at) handled.add(f.item_id);
  }
  const open = links.filter((l) => !handled.has(l.item_id) && byId.has(l.item_id));
  const order = new Map(rows.map((r, i) => [r.id, i]));
  open.sort((a, b) => order.get(a.item_id)! - order.get(b.item_id)!);
  const shown = only ? open : open.slice(0, LIMIT);
  if (shown.length === 0) return { list: [], total: open.length };
  const { data: conns } = await ctx.supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", ctx.tenantId);
  const rem = await ctx.supabase.from("jira_project_links").select("connection_id, site_id, jira_project_key, removed_close_status_id").eq("tenant_id", ctx.tenantId); // tolerated to fail
  const remembered = (l: Link) => ((rem.data ?? []) as { connection_id: string; site_id: string; jira_project_key: string; removed_close_status_id: string | null }[]).find((p) => p.connection_id === l.connection_id && p.site_id === l.site_id && l.issue_key.startsWith(`${p.jira_project_key}-`))?.removed_close_status_id ?? null;
  // adopted initiatives are made by the pull-in with source "Jira issue KEY"; a deleted row is invisible to the person's own reads, so this one narrow read uses the server client, tenant-scoped
  const { data: srcs } = await createAdminClient({ via: "UI" }).from("items").select("id, source").eq("tenant_id", ctx.tenantId).in("id", shown.map((l) => l.item_id));
  const adoptedIds = new Set(((srcs ?? []) as { id: string; source: string | null }[]).filter((r) => typeof r.source === "string" && r.source.startsWith("Jira issue ")).map((r) => r.id));
  const list = shown.map((l): Candidate => {
    const conn = ((conns ?? []) as Conn[]).find((c) => c.id === l.connection_id) ?? null;
    const t = byId.get(l.item_id)!;
    return { id: l.item_id, code: t.item_code, name: t.initiative_name, adopted: adoptedIds.has(l.item_id), ...(stopped.has(l.item_id) ? { stoppedGate: stopped.get(l.item_id)!.gate } : {}), link: l, conn, siteUrl: conn?.sites.find((s) => s.id === l.site_id)?.url ?? null, rememberedStatusId: remembered(l) };
  });
  return { list, total: open.length };
}

const urlOf = (c: Candidate) => c.link.html_url ?? (c.siteUrl ? `${c.siteUrl}/browse/${c.link.issue_key}` : null);
const usable = (c: Candidate): string | null => (!c.conn || !c.siteUrl ? "Jira is not connected for this workspace." : c.conn.state === "reconnect_needed" ? RECONNECT : c.conn.state !== "connected" ? "Jira is not connected for this workspace." : null);

function card(c: Candidate, s: CloseState | null, why: string | null): RemovedCard {
  const base = { id: c.id, code: c.code, name: c.name, ...(c.adopted ? { adopted: true as const } : {}), ...(c.stoppedGate ? { stopped: { gate: c.stoppedGate } } : {}), issueKey: c.link.issue_key, issueUrl: urlOf(c), options: [] as RemovedCard["options"], defaultTransitionId: null as string | null };
  if (why) return { ...base, state: "error", message: why };
  if (!s) return { ...base, state: "error", message: "Jira could not be read just now. Try again in a minute." };
  if (!s.ok) return { ...base, state: s.kind === "gone" ? "gone" : "error", message: s.message };
  const pick = chooseTransition(s.done, null, c.rememberedStatusId);
  return { ...base, state: "ready", jiraStatus: s.statusName, alreadyDone: s.statusCategory === "done", options: s.done.map((t) => ({ id: t.id, name: t.name, toStatusName: t.toStatusName })), defaultTransitionId: pick.transition?.id ?? null };
}

/** What the preview shows: the removed initiatives of the workspace that can be closed in Jira, each with what Jira says now. Reads only; writes nothing. */
export async function listRemoved(ctx: Ctx, deps: { call?: JiraRequest } = {}): Promise<RemovedList> {
  const found = await candidates(ctx);
  if (found === null) return { ok: true, items: [], more: 0 };
  if ("error" in found) return { ok: false, error: found.error };
  const items: RemovedCard[] = [];
  let stop: string | null = null; // a lost sign-in is shown once and stops the reading: nothing loops
  for (const part of chunk(found.list, 5)) {
    items.push(...(await Promise.all(part.map(async (c) => {
      const why = stop ?? usable(c);
      if (why) return card(c, null, why);
      const s = await readCloseState(deps.call ?? jiraRequest(c.conn!.id, c.link.site_id), c.link.issue_key);
      if (!s.ok && s.kind === "reconnect") stop = RECONNECT;
      return card(c, s, null);
    }))));
  }
  return { ok: true, items, more: Math.max(0, found.total - found.list.length) };
}

/**
 * Closes ONE removed initiative's issue after the person confirmed. Reads the issue and its transitions again first and writes nothing if the
 * choice is not possible any more. Order: label, then the transition, then the record; the record is made only when the work is complete, so a
 * refusal is shown and the initiative stays on the list (Try again re-adds the same label, which changes nothing).
 */
export async function closeOne(ctx: Ctx, id: string, transitionId: string | null, deps: { call?: JiraRequest } = {}): Promise<{ result: RemovedResult }> {
  const found = await candidates(ctx, id);
  const fail = (code: string, message: string, c?: Candidate): { result: RemovedResult } => ({ result: { id, code, outcome: "error", message, ...(c ? { issueLabel: c.link.issue_key, ...(urlOf(c) ? { issueUrl: urlOf(c)! } : {}) } : {}) } });
  if (found === null) return fail("", "Product Velocity cannot remember what it closes yet: the database update (migration jira_close_removed) is not applied. Nothing was written.");
  if ("error" in found) return fail("", found.error);
  const c = found.list[0];
  if (!c) return fail("", "This initiative is not in the Trash and was not stopped at a gate, its Jira issue came from Jira, or it was handled already. Nothing was written.");
  const refused = usable(c);
  if (refused) return fail(c.code, refused, c);
  const call = deps.call ?? jiraRequest(c.conn!.id, c.link.site_id);
  const ref = { issueLabel: c.link.issue_key, ...(urlOf(c) ? { issueUrl: urlOf(c)! } : {}) };
  const admin = createAdminClient({ via: "UI" });
  const record = async (result: "closed" | "labeled" | "already_done" | "not_found", status?: { id: string; name: string }) => {
    const { error } = await admin.rpc("jira_record_removed", { p_actor: ctx.userId, p_item: id, p_result: result, p_status_name: status?.name ?? null, p_status_id: status?.id ?? null });
    return !error;
  };
  const savedLater = "Jira was updated, but Product Velocity could not record it. Try again: it will find the issue already done.";

  const s = await readCloseState(call, c.link.issue_key);
  if (!s.ok) {
    if (s.kind === "gone") return (await record("not_found")) ? { result: { id, code: c.code, outcome: "not_found", message: "Jira no longer has this issue (or it is not visible to the connection): there is nothing to close.", ...ref } } : fail(c.code, s.message, c);
    return fail(c.code, s.message, c);
  }
  // decide before any write: a choice that is not a Done transition of this issue right now, or no choice among several, stops here
  const pick = s.statusCategory === "done" ? { transition: null, needsChoice: false, chosenNotAllowed: false } : chooseTransition(s.done, transitionId, c.rememberedStatusId);
  if (pick.chosenNotAllowed) return fail(c.code, "That Done status is not available for this issue any more. Check again and choose. Nothing was written.", c);
  if (pick.needsChoice) return fail(c.code, "Choose which Done status to move this issue to. Nothing was written.", c);

  const names = await namesForItem(ctx.supabase, ctx.tenantId, id, "jira");
  const label = await addRemovedLabel(call, c.link.issue_key, undefined, names);
  if (!label.ok) return fail(c.code, label.message, c);
  if (s.statusCategory === "done") {
    return (await record("already_done")) ? { result: { id, code: c.code, outcome: "already_done", message: `The issue was already in a Done status (${s.statusName}). The label pv:removed was added.`, ...ref } } : fail(c.code, savedLater, c);
  }
  if (!pick.transition) {
    return (await record("labeled")) ? { result: { id, code: c.code, outcome: "labeled", message: "No transition to a Done status exists in this issue's workflow, so only the label pv:removed was added. Close it in Jira.", ...ref } } : fail(c.code, savedLater, c);
  }
  const moved = await closeWith(call, c.link.issue_key, pick.transition.id, s.done);
  if (!moved.ok) return fail(c.code, `The label pv:removed was added, but the issue was not closed. ${moved.message}`, c);
  return (await record("closed", { id: pick.transition.toStatusId, name: pick.transition.toStatusName })) ? { result: { id, code: c.code, outcome: "closed", message: `Moved to ${pick.transition.toStatusName} and labelled pv:removed.`, ...ref } } : fail(c.code, savedLater, c);
}
