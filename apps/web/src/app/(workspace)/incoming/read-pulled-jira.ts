"use server";

import { requireWorkspace } from "@/lib/session";
import { applyLinkedBuildDates, applyLinkedStatuses, applyLinkedTrees } from "@/lib/atlassian/refresh-jira";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PulledReadResult = { read: number; failed: number };

/**
 * Right after Jira issues are pulled into Product Velocity (Incoming), the same read that Sync with Jira starts with runs once for the new
 * initiatives: the status (Build Status), the children (epics under an Initiative, stories under an epic) and the build dates. Without it the Jira tab
 * and the grid stay empty until the first Sync. Read only (nothing is written to Jira), tolerant (a failure here never undoes the pull-in: the next
 * Sync reads again), and only for creators and admins.
 */
export async function readPulledJira(itemIds: string[]): Promise<PulledReadResult> {
  const ids = [...new Set(itemIds)].filter((x) => UUID.test(x)).slice(0, 100);
  if (ids.length === 0) return { read: 0, failed: 0 };
  const { supabase, active } = await requireWorkspace("/incoming");
  if (active.platform || !["creator", "admin"].includes(active.role)) return { read: 0, failed: ids.length };
  const tenant = active.tenantId;
  const [{ data: links }, { data: plinks }, { data: conns }] = await Promise.all([
    supabase.from("item_jira_links").select("item_id, connection_id, site_id, issue_key").eq("tenant_id", tenant).in("item_id", ids),
    supabase.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").eq("tenant_id", tenant),
    supabase.from("jira_connections").select("id, sites, state").eq("tenant_id", tenant),
  ]);
  type PLink = { id: string; tenant_id: string; connection_id: string; site_id: string; jira_project_key: string };
  const groups = new Map<string, { plink: PLink; itemIds: string[] }>();
  let failed = 0;
  for (const l of (links ?? []) as { item_id: string; connection_id: string; site_id: string; issue_key: string }[]) {
    const plink = ((plinks ?? []) as PLink[]).find((p) => p.connection_id === l.connection_id && p.site_id === l.site_id && l.issue_key.startsWith(`${p.jira_project_key}-`));
    if (!plink) { failed++; continue; }
    const g = groups.get(plink.id) ?? { plink, itemIds: [] };
    g.itemIds.push(l.item_id);
    groups.set(plink.id, g);
  }
  let read = 0;
  for (const { plink, itemIds } of groups.values()) {
    const conn = ((conns ?? []) as { id: string; sites: { id: string; url: string }[]; state: string }[]).find((c) => c.id === plink.connection_id);
    const site = conn?.sites.find((s) => s.id === plink.site_id);
    if (!conn || conn.state !== "connected" || !site) { failed += itemIds.length; continue; }
    try {
      await applyLinkedStatuses(plink, site.url, { itemIds });
      const t = await applyLinkedTrees(plink, site.url, { itemIds });
      if (t.error || t.failed > 0) console.error(JSON.stringify({ jira: "pull-in-tree", error: t.error, failed: t.failed }));
      const d = await applyLinkedBuildDates(plink, { itemIds });
      if (d.error) console.error(JSON.stringify({ jira: "pull-in-dates", error: d.error }));
      read += itemIds.length;
    } catch (e) {
      failed += itemIds.length;
      console.error(JSON.stringify({ jira: "pull-in-read", error: e instanceof Error ? e.message.slice(0, 120) : "unknown" }));
    }
  }
  return { read, failed };
}
