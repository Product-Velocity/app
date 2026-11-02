import { JiraConnectionsView, type JiraConnectionView, type JiraProjectInfo, type JiraProjectLinkView, type JiraProjectOption } from "@/components/jira-connections-view";
import { jiraConfigured, jiraGet, jiraProjectDetail, type JiraConnectionRow } from "@/lib/atlassian/server";
import { proposeTypeMapping } from "@/lib/atlassian/type-mapping";
import { requireWorkspace } from "@/lib/session";
import { disconnectJira, linkJiraProject, readJiraNow, startJiraConnection, unlinkJiraProject } from "./actions";

export const metadata = { title: "Jira · Product Velocity" };
export const maxDuration = 30;

type ProjectSearch = { values: { key: string; name: string; projectTypeKey: string; style?: string }[] };
type LinkRow = { id: string; project_id: string; connection_id: string; site_id: string; jira_project_key: string; jira_project_name: string; initiative_type_name: string; epic_type_name: string | null; task_type_name: string | null };

export default async function JiraSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string; pv?: string; jp?: string }> }) {
  const { status, pv, jp } = await searchParams;
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

  // Project links (issue #67 slice B): the workspace's projects, their links, and for an admin the Jira projects that can be linked
  const [{ data: projectRows }, { data: linkRows }, { data: readRows }, { data: countRows }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("tenant_id", active.tenantId).order("name"),
    supabase.from("jira_project_links").select("id, project_id, connection_id, site_id, jira_project_key, jira_project_name, initiative_type_name, epic_type_name, task_type_name").eq("tenant_id", active.tenantId),
    supabase.from("jira_reads").select("link_id, read_at, total, added, changed, truncated, error").eq("tenant_id", active.tenantId),
    supabase.rpc("jira_issue_counts"),
  ]);
  const reads = new Map(((readRows ?? []) as { link_id: string; read_at: string; total: number; added: number; changed: number; truncated: boolean; error: string | null }[]).map((r) => [r.link_id, r]));
  const counts = new Map<string, { not_pulled: number; pulled: number; ignored: number }>();
  for (const c of (countRows ?? []) as { project_id: string; pull_state: "not_pulled" | "pulled" | "ignored"; n: number }[]) {
    const m = counts.get(c.project_id) ?? { not_pulled: 0, pulled: 0, ignored: 0 };
    m[c.pull_state] = Number(c.n);
    counts.set(c.project_id, m);
  }
  const links = new Map(((linkRows ?? []) as LinkRow[]).map((l) => [l.project_id, l]));
  const siteName = (connection: string, site: string) => rows.find((c) => c.id === connection)?.sites.find((s) => s.id === site)?.name ?? "Jira";
  const options: JiraProjectOption[] = canAdmin
    ? connections.flatMap((c) =>
        c.projects.flatMap((p) =>
          (p.projects ?? [])
            .filter((j) => j.type === "software" || j.type === "business")
            .map((j) => ({ value: `${c.id}|${p.siteId}|${j.key}`, label: `${j.key} · ${j.name}`, group: c.sites.find((s) => s.id === p.siteId)?.name ?? "Jira" })),
        ),
      )
    : [];

  // step 2 for the project the admin is working on: that Jira project's own issue types and the proposal
  let working: { projectId: string; mapping: NonNullable<JiraProjectLinkView["mapping"]> } | null = null;
  const [jpConn, jpSite, jpKey] = (jp ?? "").split("|");
  if (canAdmin && pv && jpConn && jpSite && jpKey && options.some((o) => o.value === jp)) {
    try {
      const d = await jiraProjectDetail(jpConn, jpSite, jpKey);
      const proposal = proposeTypeMapping(d.issueTypes);
      working = { projectId: pv, mapping: { connection: jpConn, site: jpSite, key: d.key, jiraName: d.name, types: d.issueTypes.map((t) => ({ id: t.id, name: t.name })), proposal } };
    } catch {
      working = null;
    }
  }
  const projectLinks: JiraProjectLinkView[] = ((projectRows ?? []) as { id: string; name: string }[]).map((p) => {
    const l = links.get(p.id);
    return {
      projectId: p.id,
      projectName: p.name,
      link: l ? { jiraKey: l.jira_project_key, jiraName: l.jira_project_name, siteName: siteName(l.connection_id, l.site_id), initiative: l.initiative_type_name, epic: l.epic_type_name, task: l.task_type_name } : null,
      read: l && reads.get(l.id) ? { readAt: reads.get(l.id)!.read_at, total: reads.get(l.id)!.total, added: reads.get(l.id)!.added, changed: reads.get(l.id)!.changed, truncated: reads.get(l.id)!.truncated, error: reads.get(l.id)!.error } : null,
      counts: counts.get(p.id) ?? { not_pulled: 0, pulled: 0, ignored: 0 },
      mapping: working?.projectId === p.id ? working.mapping : null,
      choosing: !l || pv === p.id,
    };
  });

  return (
    <JiraConnectionsView
      connections={connections} canAdmin={canAdmin} configured={configured} status={status} connectAction={startJiraConnection} disconnectAction={disconnectJira}
      projectLinks={projectLinks} jiraOptions={options} linkAction={linkJiraProject} unlinkAction={unlinkJiraProject} readAction={readJiraNow}
    />
  );
}
