"use server";

import { requireWorkspace } from "@/lib/session";
import { applyLinkedStatuses } from "@/lib/atlassian/refresh-jira";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import type { RefreshSummary } from "@/lib/atlassian/refresh-linked";
import type { PushItemResult, ReceiveItem, SyncChoice, SyncConfirmResult, SyncPreviewResult } from "@/lib/github/push-types";
import type { BoardResult } from "@/lib/tracker/sync-router";

// The READ half of "Sync with Jira" (issue #67, #71). For the selected initiatives it reads their Jira issues, applies what Jira owns
// (Build Status from the status category) and lists it as Received. "To send" stays empty: writing to Jira is not built yet, so confirm
// refuses to send anything. Nothing here writes to Jira.

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
  const { data: linkRows } = await supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key, html_url").eq("tenant_id", tenant).in("item_id", visible);
  const links = (linkRows ?? []) as { item_id: string; connection_id: string; site_id: string; issue_key: string; html_url: string | null }[];
  const { data: plinks } = await supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("tenant_id", tenant);
  const { data: conns } = await supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", tenant);
  const connection = (id: string) => ((conns ?? []) as Conn[]).find((c) => c.id === id);

  const summaryOf = new Map<string, RefreshSummary>(); // item id -> summary of its project read
  const failed = new Map<string, string>(); // item id -> reason
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
      for (const i of itemIds) summaryOf.set(i, s);
    } catch (e) {
      // a connection that needs a new sign-in is shown, once; nothing retries by itself
      const msg = e instanceof ReconnectNeeded ? RECONNECT : "Jira could not be read just now. Try again in a minute.";
      for (const i of itemIds) failed.set(i, msg);
    }
  }

  const received: ReceiveItem[] = visible.map((id): ReceiveItem => {
    const it = seen.get(id)!;
    const base = { id, code: it.item_code, name: it.initiative_name, tracker: "jira" as const, readOnly: true, received: [], issueNumber: null, issueUrl: null };
    const link = links.find((l) => l.item_id === id);
    if (!link) return { ...base, status: "not_linked", message: "Not linked to a Jira issue yet. Sending to Jira is not built yet." };
    const withIssue = { ...base, issueLabel: link.issue_key, issueUrl: link.html_url };
    const why = failed.get(id);
    if (why) return { ...withIssue, status: "error", message: why };
    const s = summaryOf.get(id)!;
    if (s.missing.includes(link.issue_key)) return { ...withIssue, status: "missing", message: "Jira did not return this issue (deleted, moved or not visible to the connection). Nothing was changed." };
    const lines = s.received[id] ?? [];
    return { ...withIssue, status: lines.length > 0 ? "received" : "in_step", received: lines };
  });
  const names = [...new Set(links.map((l) => connection(l.connection_id)?.sites.find((s) => s.id === l.site_id)?.name).filter((n): n is string => !!n))];
  return { ok: true, account: names.join(", ") || "Jira", received, send: [] };
}

/** Jira has no board: nothing to read in this step. */
export async function checkJiraBoard(): Promise<BoardResult> {
  return { ok: true, lines: {}, failed: false };
}

/** Writing to Jira is not built yet: nothing is sent, and the result says so for every initiative asked about. */
export async function confirmJiraSync(ids: string[], _choices: SyncChoice[]): Promise<SyncConfirmResult> {
  const g = await gate(ids);
  if (!g.ok) return { ok: false, error: g.error };
  const results: PushItemResult[] = ids.map((id) => ({ id, code: "", outcome: "blocked", message: "Sending to Jira is not built yet. Nothing was written to Jira." }));
  return { ok: true, results, taken: [] };
}
