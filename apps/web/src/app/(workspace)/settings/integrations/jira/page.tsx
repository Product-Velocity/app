import { JiraConnectionsView, type JiraConnectionView, type JiraProjectInfo } from "@/components/jira-connections-view";
import { jiraConfigured, jiraGet, type JiraConnectionRow } from "@/lib/atlassian/server";
import { requireWorkspace } from "@/lib/session";
import { disconnectJira, startJiraConnection } from "./actions";

export const metadata = { title: "Jira · Product Velocity" };
export const maxDuration = 30;

type ProjectSearch = { values: { key: string; name: string; projectTypeKey: string; style?: string }[] };

export default async function JiraSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/integrations/jira");
  const canAdmin = active.role === "admin" && !active.platform;
  const { data } = await supabase.from("jira_connections").select("id, tenant_id, sites, scopes, state, connected_by, state_changed_at, created_at").eq("tenant_id", active.tenantId).neq("state", "disconnected").order("created_at");
  const rows = (data ?? []) as JiraConnectionRow[];
  const configured = jiraConfigured();

  const connections: JiraConnectionView[] = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      state: c.state,
      sites: c.sites,
      created_at: c.created_at,
      state_changed_at: c.state_changed_at,
      // project names are shown to admins only; a connection that needs a new sign-in is not asked
      projects:
        canAdmin && configured && c.state === "connected"
          ? await Promise.all(
              c.sites.map(async (s) => {
                try {
                  const r = await jiraGet<ProjectSearch>(c.id, s.id, "/project/search?maxResults=50");
                  const projects: JiraProjectInfo[] = r.values.map((v) => ({ key: v.key, name: v.name, type: v.projectTypeKey, style: v.style ?? null }));
                  return { siteId: s.id, projects };
                } catch (e) {
                  return { siteId: s.id, projects: null, error: e instanceof Error ? e.message : "unknown" };
                }
              }),
            )
          : [],
    })),
  );

  return <JiraConnectionsView connections={connections} canAdmin={canAdmin} configured={configured} status={status} connectAction={startJiraConnection} disconnectAction={disconnectJira} />;
}
