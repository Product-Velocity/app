import { leavingChildrenOut } from "@/lib/atlassian/child-filter";
import { JiraConnectionsView, type JiraConnectionView, type JiraEventView, type JiraIssueView, type JiraProjectInfo, type JiraProjectLinkView, type JiraSyncView } from "@/components/jira-connections-view";
import type { JiraProjectChoice } from "@/components/jira-project-row";
import { webhooksEnabled } from "@/lib/atlassian/jira-webhooks-server";
import { jiraConfigured, jiraFieldChoices, jiraGet, jiraProjectDetail, type JiraConnectionRow } from "@/lib/atlassian/server";
import { parseFieldMap, proposePriorities, type FieldChoice } from "@/lib/atlassian/field-map";
import { proposeTypeMapping } from "@/lib/atlassian/type-mapping";
import { readJiraCatalog } from "@/lib/atlassian/catalog-server";
import type { TrackerCatalog } from "@/lib/tracker-fields/catalog";
import type { TrackerSection } from "@/components/tracker-tabs";
import { requireWorkspace } from "@/lib/session";
import { canEditItems } from "@pv/domain";
import { checkJiraNow, disconnectJira, readJiraNow, retryJiraEvent, reviewJiraIssues, saveJiraFieldMap, saveJiraProject, startJiraConnection } from "./actions";

type ProjectSearch = { values: { key: string; name: string; projectTypeKey: string; style?: string }[] };
type LinkRow = { id: string; project_id: string; connection_id: string; site_id: string; jira_project_key: string; jira_project_name: string; initiative_type_id: string; initiative_type_name: string; epic_type_id: string | null; epic_type_name: string | null; task_type_id: string | null; task_type_name: string | null };

/** Both sections of Settings, Integrations, Jira (decision 2026-11-03-tracker-field-config): the page and its /logs twin call this. */
export async function JiraSettings({ section, searchParams }: { section: TrackerSection; searchParams: Promise<{ status?: string; ignored?: string; c?: string; ch?: string; m?: string }> }) {
  const { status, ignored, c: checkedN, ch: changedN, m: missingN } = await searchParams;
  const { supabase, active } = await requireWorkspace(section === "logs" ? "/settings/integrations/jira/logs" : "/settings/integrations/jira");
  const configure = section === "configure";
  const canAdmin = active.role === "admin" && !active.platform;
  const canEdit = canEditItems(active.role) && !active.platform;
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
      scopes: c.scopes,
      // project names are shown to admins only; a connection that needs a new sign-in is not asked
      projects:
        configure && canAdmin && configured && c.state === "connected"
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
  const [{ data: projectRows }, { data: linkRows }, { data: readRows }, { data: countRows }, { data: mapRows }] = await Promise.all([
    supabase.from("projects").select("id, name, tracker").eq("tenant_id", active.tenantId).order("name"),
    supabase.from("jira_project_links").select("id, project_id, connection_id, site_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name, epic_type_id, epic_type_name, task_type_id, task_type_name").eq("tenant_id", active.tenantId),
    supabase.from("jira_reads").select("link_id, read_at, total, added, changed, truncated, error").eq("tenant_id", active.tenantId),
    supabase.rpc("jira_issue_counts"),
    // read apart from the link itself: a database that has not got the field mapping column yet must not hide the links (the mapping then shows as empty)
    supabase.from("jira_project_links").select("project_id, field_map").eq("tenant_id", active.tenantId),
  ]);
  const storedMaps = new Map(((mapRows ?? []) as { project_id: string; field_map: unknown }[]).map((r) => [r.project_id, r.field_map]));
  // the issues waiting for a decision (or the ignored ones of the project the person opened), at most 100 per project
  const linkedProjects = ((linkRows ?? []) as LinkRow[]).map((l) => l.project_id);
  const issueRows = new Map<string, JiraIssueView[]>();
  await Promise.all(
    (configure ? linkedProjects : []).map(async (project) => {
      // the children of a linked initiative are part of its tree, not issues waiting for a decision
      const { data: rowsOfProject } = await leavingChildrenOut((leaveOut) => {
        const q = supabase
          .from("jira_issues").select("id, issue_key, title, issue_type, status, status_category, html_url, hierarchy_level")
          .eq("tenant_id", active.tenantId).eq("project_id", project).eq("pull_state", ignored === project ? "ignored" : "not_pulled");
        return (leaveOut ? q.is("child_of_item", null) : q).order("jira_updated_at", { ascending: false, nullsFirst: false }).limit(100);
      });
      issueRows.set(project, ((rowsOfProject ?? []) as { id: string; issue_key: string; title: string; issue_type: string | null; status: string | null; status_category: string | null; html_url: string | null }[]).map((r) => ({ id: r.id, key: r.issue_key, title: r.title, type: r.issue_type, status: r.status, category: r.status_category, url: r.html_url })));
    }),
  );
  const reads = new Map(((readRows ?? []) as { link_id: string; read_at: string; total: number; added: number; changed: number; truncated: boolean; error: string | null }[]).map((r) => [r.link_id, r]));
  const counts = new Map<string, { not_pulled: number; pulled: number; ignored: number }>();
  for (const c of (countRows ?? []) as { project_id: string; pull_state: "not_pulled" | "pulled" | "ignored"; n: number }[]) {
    const m = counts.get(c.project_id) ?? { not_pulled: 0, pulled: 0, ignored: 0 };
    m[c.pull_state] = Number(c.n);
    counts.set(c.project_id, m);
  }
  const links = new Map(((linkRows ?? []) as LinkRow[]).map((l) => [l.project_id, l]));
  const siteName = (connection: string, site: string) => rows.find((c) => c.id === connection)?.sites.find((s) => s.id === site)?.name ?? "Jira";
  // the Jira projects that can be linked, each with ITS OWN issue types and the proposal (they differ per project; read once, in parallel, 30 at most)
  const eligible = canAdmin && configure
    ? connections.flatMap((c) =>
        c.projects.flatMap((p) =>
          (p.projects ?? [])
            .filter((j) => j.type === "software" || j.type === "business")
            .map((j) => ({ connection: c.id, site: p.siteId, key: j.key, label: `${j.key} · ${j.name}`, group: c.sites.find((x) => x.id === p.siteId)?.name ?? "Jira" })),
        ),
      ).slice(0, 30)
    : [];
  const choices: JiraProjectChoice[] = (
    await Promise.all(
      eligible.map(async (o) => {
        try {
          const d = await jiraProjectDetail(o.connection, o.site, o.key);
          const proposal = proposeTypeMapping(d.issueTypes);
          return { value: `${o.connection}|${o.site}|${o.key}`, label: o.label, group: o.group, types: d.issueTypes.map((t) => ({ id: t.id, name: t.name })), proposal: { initiative: proposal.initiative, epic: proposal.epic, task: proposal.task } } satisfies JiraProjectChoice;
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is JiraProjectChoice => x !== null);

  // the field mapping form (admins only): the site's start-date candidates and priorities, read once per site; a site that cannot be read shows a notice
  const choicesBySite = new Map<string, Promise<{ startDates: FieldChoice[]; themes: FieldChoice[]; priorities: FieldChoice[] } | null>>();
  const choicesFor = (connection: string, site: string) => {
    const k = `${connection}|${site}`;
    if (!choicesBySite.has(k)) choicesBySite.set(k, jiraFieldChoices(connection, site).catch(() => null));
    return choicesBySite.get(k)!;
  };
  const fieldMaps = new Map<string, NonNullable<JiraProjectLinkView["fieldMap"]>>();
  if (canAdmin && configure) {
    await Promise.all(((linkRows ?? []) as LinkRow[]).map(async (l) => {
      const choices = await choicesFor(l.connection_id, l.site_id);
      fieldMaps.set(l.project_id, { current: parseFieldMap(storedMaps.get(l.project_id)), startDates: choices?.startDates ?? [], themes: choices?.themes ?? [], priorities: choices?.priorities ?? [], proposal: choices ? proposePriorities(choices.priorities) : {}, unreadable: choices === null });
    }));
  }
  // the read-only field catalog of each linked Jira project (admins; one read per linked project, in parallel; a project that fails shows its own notice)
  const catalogs: TrackerCatalog[] = canAdmin && configure
    ? (await Promise.all(((linkRows ?? []) as LinkRow[]).map((l) => readJiraCatalog(l.connection_id, l.site_id, l.jira_project_key).catch((): null => null)))).filter((c): c is TrackerCatalog => c !== null)
    : [];
  const projectLinks: JiraProjectLinkView[] = ((projectRows ?? []) as { id: string; name: string }[]).map((p) => {
    const l = links.get(p.id);
    return {
      projectId: p.id,
      projectName: p.name,
      link: l ? { jiraKey: l.jira_project_key, jiraName: l.jira_project_name, siteName: siteName(l.connection_id, l.site_id), initiative: l.initiative_type_name, epic: l.epic_type_name, task: l.task_type_name } : null,
      read: l && reads.get(l.id) ? { readAt: reads.get(l.id)!.read_at, total: reads.get(l.id)!.total, added: reads.get(l.id)!.added, changed: reads.get(l.id)!.changed, truncated: reads.get(l.id)!.truncated, error: reads.get(l.id)!.error } : null,
      counts: counts.get(p.id) ?? { not_pulled: 0, pulled: 0, ignored: 0 },
      issues: issueRows.get(p.id) ?? [],
      showIgnored: ignored === p.id,
      tracker: (p as { tracker?: string | null }).tracker ?? null,
      rowLink: l ? { value: `${l.connection_id}|${l.site_id}|${l.jira_project_key}`, initiative: l.initiative_type_id, epic: l.epic_type_id, task: l.task_type_id } : null,
      fieldMap: fieldMaps.get(p.id) ?? null,
    };
  });

  // Sync card: linked initiatives, the last check, the recent events and the state of live updates (admins see the events)
  const connected = rows.filter((c) => c.state === "connected");
  let sync: JiraSyncView | null = null;
  if (connected.length > 0 && !configure) {
    const [{ count: linkedCount }, { data: lastRun }, { data: eventRows }, { data: hookRows }] = await Promise.all([
      supabase.from("item_jira_links").select("item_id", { count: "exact", head: true }).eq("tenant_id", active.tenantId),
      supabase.from("jira_sync_events").select("received_at, summary").eq("tenant_id", active.tenantId).eq("kind", "run").order("received_at", { ascending: false }).limit(1),
      canAdmin ? supabase.from("jira_sync_events").select("id, received_at, source, issue_key, summary, state, last_error, attempts").eq("tenant_id", active.tenantId).eq("kind", "change").order("received_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
      supabase.from("jira_webhooks").select("state").eq("tenant_id", active.tenantId),
    ]);
    const hooks = (hookRows ?? []) as { state: string }[];
    sync = {
      linked: linkedCount ?? 0,
      lastCheck: (lastRun ?? [])[0] ? { at: (lastRun as { received_at: string; summary: string }[])[0]!.received_at, summary: (lastRun as { received_at: string; summary: string }[])[0]!.summary } : null,
      events: ((eventRows ?? []) as { id: string; received_at: string; source: JiraEventView["source"]; issue_key: string | null; summary: string; state: JiraEventView["state"]; last_error: string | null; attempts: number }[]).map((e) => ({ id: e.id, at: e.received_at, source: e.source, issue: e.issue_key, summary: e.summary, state: e.state, error: e.last_error, attempts: e.attempts })),
      live: { enabled: webhooksEnabled(), registered: hooks.filter((h) => h.state === "active").length, total: hooks.length, needsScope: hooks.some((h) => h.state === "needs_scope") },
    };
  }

  return (
    <JiraConnectionsView
      connections={connections} canAdmin={canAdmin} configured={configured} status={status} checked={checkedN ? { c: checkedN, ch: changedN ?? "0", m: missingN ?? "0" } : undefined}
      connectAction={startJiraConnection} disconnectAction={disconnectJira} projectLinks={projectLinks} choices={choices} sync={sync} saveProjectAction={saveJiraProject} readAction={readJiraNow}
      checkAction={checkJiraNow} section={section} catalogs={catalogs} retryAction={retryJiraEvent} canEdit={canEdit} reviewAction={reviewJiraIssues} fieldMapAction={saveJiraFieldMap}
    />
  );
}
