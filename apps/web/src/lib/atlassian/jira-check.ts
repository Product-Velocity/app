import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeLines, runSummary, type JiraEventRow } from "./jira-events";
import type { LinkToRead } from "./read-jira";
import { refreshJiraProject } from "./refresh-jira";
import { ReconnectNeeded } from "./token-provider";

// One run of "read Jira and apply it" for a set of linked projects, shared by the daily check (all workspaces) and "Check Jira now" (one workspace),
// so both behave the same by construction (decision 2026-11-03-tracker-parity). Reads Jira only. Writes the recent-events log (service role).
export type Site = { id: string; url: string };
export type CheckReport = { projects: number; checked: number; changed: number; stale: number; missing: number; light: number; trees: number; treeNodes: number; treeFailed: number; failed: number; reconnect: number; skipped: number };
export const emptyReport = (): CheckReport => ({ projects: 0, checked: 0, changed: 0, stale: 0, missing: 0, light: 0, trees: 0, treeNodes: 0, treeFailed: 0, failed: 0, reconnect: 0, skipped: 0 });

export async function checkJiraLinks(todo: LinkToRead[], sitesOf: Map<string, Site[]>, opts: { source: "check" | "manual"; budgetMs: number; blocked?: Set<string> }): Promise<CheckReport> {
  const started = Date.now();
  const admin = createAdminClient({ via: "system" });
  const report = emptyReport();
  const blocked = opts.blocked ?? new Set<string>();
  const perTenant = new Map<string, CheckReport>();
  const events: JiraEventRow[] = [];
  for (const l of todo) {
    const site = sitesOf.get(l.connection_id)?.find((s) => s.id === l.site_id);
    if (!site || blocked.has(l.connection_id) || Date.now() - started > opts.budgetMs) { report.skipped++; continue; }
    const t = perTenant.get(l.tenant_id) ?? emptyReport();
    perTenant.set(l.tenant_id, t);
    try {
      const r = await refreshJiraProject(l, site.url);
      for (const x of [report, t]) { x.projects++; x.checked += r.linked.checked; x.changed += r.linked.changed; x.stale += r.linked.stale; x.missing += r.linked.missing.length; x.light += r.light; x.trees += r.trees.applied; x.treeNodes += r.trees.nodes; x.treeFailed += r.trees.failed; }
      if (r.trees.error) console.error(JSON.stringify({ jira: "check-tree", link: l.id, error: r.trees.error }));
      for (const c of r.linked.changedIssues) events.push({ tenant_id: l.tenant_id, link_id: l.id, source: opts.source, kind: "change", issue_key: c.key, summary: describeLines(c.lines), state: "processed", last_error: null });
    } catch (e) {
      for (const x of [report, t]) x.failed++;
      const reconnect = e instanceof ReconnectNeeded;
      if (reconnect) { report.reconnect++; t.reconnect++; blocked.add(l.connection_id); }
      const why = reconnect ? "Sign in to Jira again" : e instanceof Error ? e.message.slice(0, 200) : "unknown";
      events.push({ tenant_id: l.tenant_id, link_id: l.id, source: opts.source, kind: "change", issue_key: null, summary: `Could not read ${l.jira_project_key}`, state: "error", last_error: why });
      console.error(JSON.stringify({ jira: "check", link: l.id, error: why }));
    }
  }
  for (const [tenant, t] of perTenant) events.push({ tenant_id: tenant, link_id: null, source: opts.source, kind: "run", issue_key: null, summary: runSummary(t), state: "processed", last_error: null });
  if (events.length > 0) await admin.from("jira_sync_events").insert(events);
  return report;
}

/** Events older than 90 days go (the log is for the last weeks, not for audit: that is audit_log). */
export async function pruneJiraEvents(): Promise<void> {
  await createAdminClient({ via: "system" }).from("jira_sync_events").delete().lt("received_at", new Date(Date.now() - 90 * 86_400_000).toISOString());
}
