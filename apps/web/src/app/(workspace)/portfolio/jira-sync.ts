"use server";

import { requireWorkspace } from "@/lib/session";
import { DbReadError, safeReadMessage } from "@/lib/db-error";
import { applyLinkedStatuses, applyLinkedTrees } from "@/lib/atlassian/refresh-jira";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import type { RefreshSummary } from "@/lib/atlassian/refresh-linked";
import type { PlanItem, PushItemResult, ReceiveItem, SyncChoice, SyncConfirmResult, SyncPreviewResult, TakenOver } from "@/lib/github/push-types";
import type { BoardResult } from "@/lib/tracker/sync-router";
import { siteUrl } from "@/lib/site-url";
import { evaluate, load, previewParts, previewOne, writeOne, type Ctx } from "@/lib/atlassian/jira-sync-engine";

// "Sync with Jira" (issue #67, #71). READ first: for the selected initiatives it reads their Jira issues, applies what Jira owns (Build Status
// from the status category) and lists it as Received. Then it compares the texts Product Velocity owns (name, description) three ways and
// lists what would go out (To send) and the conflicts. NOTHING is written to Jira by start: only confirmJiraSync writes, one initiative at a
// time, after the person confirmed in the dialog. Only creators and admins reach it (gate): Claude (MCP), service accounts and platform
// staff cannot, because this is a UI server action and gate refuses them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 25;
const RECONNECT = "Jira needs a new sign-in. A workspace admin can sign in again under Settings > Integrations > Jira.";

type PLink = { id: string; tenant_id: string; connection_id: string; site_id: string; jira_project_key: string };
type Conn = { id: string; sites: { id: string; name: string; url: string }[]; state: string };

async function gate(ids: string[]) {
  const ctx = await requireWorkspace("/portfolio");
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === "string" && UUID.test(i))) return { ok: false, error: "Choose at least one initiative." } as const;
  if (ids.length > LIMIT) return { ok: false, error: `Sync up to ${LIMIT} initiatives at a time.` } as const;
  const { data: me } = await ctx.supabase.from("tenant_members").select("is_service_account").eq("tenant_id", ctx.active.tenantId).eq("user_id", ctx.user.id).maybeSingle();
  if (!["creator", "admin"].includes(ctx.active.role) || me?.is_service_account || ctx.active.platform) return { ok: false, error: "Only creators and admins of the account can sync with Jira." } as const;
  return { ok: true, ctx } as const;
}

export async function startJiraSync(ids: string[]): Promise<SyncPreviewResult> {
  const g = await gate(ids);
  if (!g.ok) return { ok: false, error: g.error };
  const { supabase, active } = g.ctx;
  const tenant = active.tenantId;
  // everything below is read as the signed-in person (row-level security): only initiatives they can see are looked at
  const { data: items } = await supabase.from("items").select("id, item_code, initiative_name").eq("tenant_id", tenant).is("deleted_at", null).in("id", ids);
  const seen = new Map(((items ?? []) as { id: string; item_code: string; initiative_name: string }[]).map((i) => [i.id, i]));
  const visible = ids.filter((i) => seen.has(i));
  const { data: linkRows } = await supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key, html_url, mode").eq("tenant_id", tenant).in("item_id", visible);
  const links = (linkRows ?? []) as { item_id: string; connection_id: string; site_id: string; issue_key: string; html_url: string | null; mode: "follow" | "push" }[];
  const { data: plinks } = await supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("tenant_id", tenant);
  const { data: conns } = await supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", tenant);
  const connection = (id: string) => ((conns ?? []) as Conn[]).find((c) => c.id === id);

  const summaryOf = new Map<string, RefreshSummary>(); // item id -> summary of its project read
  const failed = new Map<string, string>(); // item id -> reason
  const treeNote = new Map<string, string>(); // item id -> why its children could not be read (a note on the card, not an error)
  const groups = new Map<string, { plink: PLink; itemIds: string[] }>();
  for (const l of links) {
    const plink = ((plinks ?? []) as PLink[]).find((p) => p.connection_id === l.connection_id && p.site_id === l.site_id && l.issue_key.startsWith(`${p.jira_project_key}-`));
    if (!plink) { failed.set(l.item_id, "This initiative's Jira project is not linked any more. An admin can link it again under Settings > Integrations > Jira."); continue; }
    const grp = groups.get(plink.id) ?? { plink, itemIds: [] };
    grp.itemIds.push(l.item_id);
    groups.set(plink.id, grp);
  }
  for (const { plink, itemIds } of groups.values()) {
    const conn = connection(plink.connection_id);
    const site = conn?.sites.find((s) => s.id === plink.site_id);
    if (!conn || conn.state !== "connected" || !site) { for (const i of itemIds) failed.set(i, conn?.state === "reconnect_needed" ? RECONNECT : "Jira is not connected for this workspace."); continue; }
    try {
      const s = await applyLinkedStatuses(plink, site.url, { itemIds });
      // then their children and sub-tasks (read only; a failure of the tree does not fail the status read, ReconnectNeeded does propagate)
      const t = await applyLinkedTrees(plink, site.url, { itemIds });
      // the tree never fails the sync, but it is not hidden either: the cards of the initiatives it could not read say so, and the reason is logged
      if (t.error || t.failed > 0 || t.unreadable.length > 0) console.error(JSON.stringify({ jira: "sync-tree", error: t.error, failed: t.failed, unreadable: t.unreadable.length }));
      for (const i of t.unreadable) treeNote.set(i, "The children of this issue could not be read: Jira did not return it for their query.");
      for (const i of t.failedItems) treeNote.set(i, `The children of this issue could not be read${t.error ? `: ${t.error}` : "."} Issues already known from the project list are shown instead.`);
      for (const i of itemIds) summaryOf.set(i, s);
    } catch (e) {
      // a connection that needs a new sign-in is shown, once; nothing retries by itself
      // a failed database read says so (and why); only an unknown failure gets the generic text
      const msg = e instanceof ReconnectNeeded ? RECONNECT : safeReadMessage(e, "Jira could not be read just now. Try again in a minute.");
      if (!(e instanceof ReconnectNeeded) && !(e instanceof DbReadError)) console.error(JSON.stringify({ jira: "receive", error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
      for (const i of itemIds) failed.set(i, msg);
    }
  }

  const received: ReceiveItem[] = visible.map((id): ReceiveItem => {
    const it = seen.get(id)!;
    const base = { id, code: it.item_code, name: it.initiative_name, tracker: "jira" as const, received: [], issueNumber: null, issueUrl: null };
    const link = links.find((l) => l.item_id === id);
    if (!link) return { ...base, status: "not_linked", message: "Not in Jira yet." };
    const withIssue = { ...base, ...(link.mode === "follow" ? { readOnly: true as const } : {}), issueLabel: link.issue_key, issueUrl: link.html_url };
    const why = failed.get(id);
    if (why) return { ...withIssue, status: "error", message: why };
    const s = summaryOf.get(id)!;
    if (s.missing.includes(link.issue_key)) return { ...withIssue, status: "missing", message: "Jira did not return this issue (deleted, moved or not visible to the connection). Nothing was changed." };
    const lines = s.received[id] ?? [];
    const note = treeNote.get(id);
    return { ...withIssue, status: lines.length > 0 ? "received" : "in_step", received: lines, ...(note ? { message: note } : {}) };
  });
  const names = [...new Set(links.map((l) => connection(l.connection_id)?.sites.find((s) => s.id === l.site_id)?.name).filter((n): n is string => !!n))];
  // the send half: compare the texts and say what would go out (reads Jira again for the push-mode ones; writes nothing)
  const ctx: Ctx = { supabase: supabase as never, tenantId: tenant, userId: g.ctx.user.id, appUrl: await siteUrl() };
  const send: PlanItem[] = [];
  const out: ReceiveItem[] = [];
  for (const batch of chunk(received, 5)) {
    out.push(...(await Promise.all(batch.map(async (card0): Promise<ReceiveItem> => {
      let card = card0;
      if (card.status === "error" || card.status === "missing") return card;
      const l = await load(ctx, card.id);
      if (!l) return card;
      const e = await evaluate(l, {});
      if (e.kind === "error") return { ...card, status: "error", message: e.message };
      if (e.kind === "missing") return { ...card, status: "missing", message: e.message };
      const parts = previewParts(e);
      if (parts.plan) send.push(parts.plan);
      // restored after its issue was closed because it was removed: said, never reopened by Product Velocity
      if (l.closedWhileRemoved && l.closedWhileRemoved !== "not_found") card = { ...card, message: `This initiative was removed earlier, so its Jira issue ${l.link?.issue_key ?? ""} was labelled “pv:removed”${l.closedWhileRemoved === "closed" || l.closedWhileRemoved === "already_done" ? " and is in a Done status" : ""}. Product Velocity does not reopen it: reopen it in Jira if the work continues.` };
      if (parts.create) return { ...card, status: "not_linked", message: "Not in Jira yet: will be created in the linked Jira project." };
      if (parts.conflicts.length > 0) return { ...card, status: "conflict", conflicts: parts.conflicts };
      return card;
    }))));
  }
  const rank = new Map(visible.map((id, i) => [id, i]));
  return { ok: true, account: names.join(", ") || "Jira", received: out, send: send.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)) };
}
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Jira has no board: nothing to read in this step. */
export async function checkJiraBoard(): Promise<BoardResult> {
  return { ok: true, lines: {}, failed: false };
}

/**
 * Writes the confirmed initiatives to Jira, one at a time, each after reading its issue again. Nothing is written for an initiative whose
 * Jira text changed since the preview: it comes back as `stale` with the new difference, and the ones after it wait (as for GitHub).
 */
export async function confirmJiraSync(ids: string[], choices: SyncChoice[]): Promise<SyncConfirmResult> {
  const g = await gate(ids);
  if (!g.ok) return { ok: false, error: g.error };
  const ctx: Ctx = { supabase: g.ctx.supabase as never, tenantId: g.ctx.active.tenantId, userId: g.ctx.user.id, appUrl: await siteUrl() };
  const results: PushItemResult[] = [];
  const taken: TakenOver[] = [];
  for (const id of ids) {
    const w = await writeOne(ctx, id, choices);
    if ("stale" in w) return { ok: false, error: w.error, stale: await previewOne(ctx, id, "Jira") };
    results.push(w.result);
    taken.push(...w.taken);
  }
  return { ok: true, results, taken };
}
