import { createAdminClient } from "@/lib/supabase/admin";
import { refreshJiraProject } from "@/lib/atlassian/refresh-jira";
import { ReconnectNeeded } from "@/lib/atlassian/token-provider";
import type { LinkToRead } from "@/lib/atlassian/read-jira";

/**
 * Daily check of Jira (Vercel Cron, free plan: once a day, two cron jobs at most; the other one is /api/cron/github). For every linked Jira
 * project of a connected workspace: reads the open work, the issues that became Done since, and the status of every linked initiative, and
 * applies it (Build Status from the status category; Initiative Status is never set from Jira), then their children and sub-tasks into the
 * read-only tree and the delivery roll-up (a failure of the tree is logged and never fails the status read). Reads Jira only. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is refused. A connection that needs a new sign-in is skipped for the rest of the run
 * (its state says so on the Jira settings page); nothing retries by itself.
 */
export const maxDuration = 60;
const BUDGET_MS = 45_000;

type Site = { id: string; url: string };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("forbidden", { status: 403 });
  const started = Date.now();
  const admin = createAdminClient({ via: "system" });
  const { data: conns } = await admin.from("jira_connections").select("id, sites").eq("state", "connected");
  const sitesOf = new Map(((conns ?? []) as { id: string; sites: Site[] }[]).map((c) => [c.id, c.sites]));
  const { data: links } = await admin.from("jira_project_links").select("id, tenant_id, connection_id, site_id, jira_project_key").in("connection_id", [...sitesOf.keys()]);
  const { data: reads } = await admin.from("jira_reads").select("link_id, read_at");
  const lastRead = new Map(((reads ?? []) as { link_id: string; read_at: string }[]).map((r) => [r.link_id, r.read_at]));
  // the projects read longest ago first, so a run that runs out of time continues where it stopped the next day
  const todo = ((links ?? []) as LinkToRead[]).sort((a, b) => (lastRead.get(a.id) ?? "").localeCompare(lastRead.get(b.id) ?? ""));

  const report = { projects: 0, checked: 0, changed: 0, stale: 0, missing: 0, light: 0, trees: 0, treeNodes: 0, treeFailed: 0, failed: 0, reconnect: 0, skipped: 0 };
  const blocked = new Set<string>();
  for (const l of todo) {
    const site = sitesOf.get(l.connection_id)?.find((s) => s.id === l.site_id);
    if (!site || blocked.has(l.connection_id)) { report.skipped++; continue; }
    if (Date.now() - started > BUDGET_MS) { report.skipped++; continue; }
    try {
      const r = await refreshJiraProject(l, site.url);
      report.projects++;
      report.checked += r.linked.checked;
      report.changed += r.linked.changed;
      report.stale += r.linked.stale;
      report.missing += r.linked.missing.length;
      report.light += r.light;
      report.trees += r.trees.applied;
      report.treeNodes += r.trees.nodes;
      report.treeFailed += r.trees.failed;
      if (r.trees.error) console.error(JSON.stringify({ jira: "cron-tree", link: l.id, error: r.trees.error }));
    } catch (e) {
      report.failed++;
      if (e instanceof ReconnectNeeded) { report.reconnect++; blocked.add(l.connection_id); }
      console.error(JSON.stringify({ jira: "cron", link: l.id, error: e instanceof ReconnectNeeded ? "reconnect needed" : e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    }
  }
  return Response.json(report);
}
