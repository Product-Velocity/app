import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapIssue, PAGE_SIZE, MAX_PAGES, type SearchPage } from "./read-issues";
import { openEpicsJql } from "./epic-coverage";
import { jiraGet } from "./server";
import { ReconnectNeeded } from "./token-provider";

export type EpicsRead = { projects: number; epics: number; failed: number; truncated: boolean };

/** The ids of the site's issue types at hierarchy level 1 (epics, whatever the site calls them). */
async function epicTypeIds(connection: string, site: string): Promise<string[]> {
  const types = await jiraGet<{ id?: unknown; hierarchyLevel?: unknown }[]>(connection, site, "/issuetype");
  return (Array.isArray(types) ? types : []).filter((t) => t.hierarchyLevel === 1 && typeof t.id === "string" && /^[0-9]{1,20}$/.test(t.id)).map((t) => t.id as string);
}

/**
 * Reads the open epics of the ticked projects (jira_epic_projects) into jira_epics_seen, one project at a time, so one project that cannot be read
 * leaves the others as they were. Reads Jira only; nothing is written to Jira. Throws only for a sign-in that needs renewing (ReconnectNeeded).
 */
export async function readTickedEpics(tenantId: string): Promise<EpicsRead> {
  const admin = createAdminClient({ via: "system" });
  const [{ data: ticked }, { data: conns }] = await Promise.all([
    admin.from("jira_epic_projects").select("connection_id, site_id, project_key").eq("tenant_id", tenantId).order("project_key"),
    admin.from("jira_connections").select("id, sites, state").eq("tenant_id", tenantId).eq("state", "connected"),
  ]);
  const out: EpicsRead = { projects: 0, epics: 0, failed: 0, truncated: false };
  const types = new Map<string, Promise<string[]>>();
  for (const t of (ticked ?? []) as { connection_id: string; site_id: string; project_key: string }[]) {
    const conn = ((conns ?? []) as { id: string; sites: { id: string; url?: string }[] }[]).find((c) => c.id === t.connection_id);
    const site = conn?.sites.find((s) => s.id === t.site_id);
    if (!conn || !site) { out.failed++; continue; }
    try {
      const tk = `${t.connection_id}|${t.site_id}`;
      if (!types.has(tk)) types.set(tk, epicTypeIds(t.connection_id, t.site_id));
      const ids = await types.get(tk)!;
      if (ids.length === 0) { out.failed++; continue; }
      const rows: ReturnType<typeof mapIssue>[] = [];
      let token: string | undefined;
      let pages = 0;
      for (;;) {
        const q = new URLSearchParams({ jql: openEpicsJql(t.project_key, ids), maxResults: String(PAGE_SIZE), fields: "summary,issuetype,status,parent,updated" });
        if (token) q.set("nextPageToken", token);
        const page = await jiraGet<SearchPage>(t.connection_id, t.site_id, `/search/jql?${q.toString()}`);
        pages++;
        for (const raw of page.issues ?? []) rows.push(mapIssue(raw, site.url ?? ""));
        if (page.isLast !== false || !page.nextPageToken) break;
        if (pages >= MAX_PAGES) { out.truncated = true; break; }
        token = page.nextPageToken;
      }
      const clean = rows.filter((r): r is NonNullable<typeof r> => r !== null && r.key.startsWith(`${t.project_key}-`));
      // a read that stopped at the page limit must not delete the epics it did not reach: it only adds
      if (out.truncated) { out.failed++; continue; }
      const { error } = await admin.rpc("jira_replace_epics", {
        p_tenant: tenantId, p_connection: t.connection_id, p_site: t.site_id, p_project: t.project_key,
        p_rows: clean.map((r) => ({ key: r.key, title: r.title, status: r.status, category: r.category, parent: r.parent, url: r.url, updated: r.updated })),
      });
      if (error) { out.failed++; continue; }
      out.projects++;
      out.epics += clean.length;
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      out.failed++;
      console.error(JSON.stringify({ jira: "epics-read", project: t.project_key, error: e instanceof Error ? e.message.slice(0, 120) : "unknown" }));
    }
  }
  return out;
}
