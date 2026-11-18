import { leavingChildrenOut } from "@/lib/atlassian/child-filter";
import { JiraConnectionsView, type JiraHeaderView, type JiraConnectionView, type JiraEventView, type JiraIssueView, type JiraProjectInfo, type JiraProjectLinkView, type JiraSyncView } from "@/components/jira-connections-view";
import type { JiraProjectChoice } from "@/components/jira-project-row";
import { webhooksEnabled } from "@/lib/atlassian/jira-webhooks-server";
import { jiraConfigured, jiraGet, jiraProjectDetail, type JiraConnectionRow } from "@/lib/atlassian/server";
import { parseFieldMap } from "@/lib/atlassian/field-map";
import { proposeTypeMapping } from "@/lib/atlassian/type-mapping";
import { readJiraCatalog, readJiraSelectFields, readJiraSiteFields, type JiraSiteFields } from "@/lib/atlassian/catalog-server";
import { countLinkedInitiatives } from "@/lib/atlassian/linked-counts";
import { countWithValues, readStamp } from "@/lib/select-editor/counts";
import { InitiativeSelectCard } from "@/components/initiative-select-card";
import { parseSelectMap, selectRowsToMap } from "@/lib/atlassian/select-map";
import { buildMappingView, type MappingView } from "@/lib/tracker-fields/view";
import { parseConfigRows } from "@/lib/tracker-fields/mapping";
import type { TrackerCatalog } from "@/lib/tracker-fields/catalog";
import type { TrackerSection } from "@/lib/tracker-fields/sections";
import { requireWorkspace } from "@/lib/session";
import { canEditItems } from "@pv/domain";
import { EpicProjectsCard, type EpicProjectSite } from "./epic-projects-card";
import { checkJiraNow, copyJiraFieldConfig, disconnectJira, readJiraNow, retryJiraEvent, reviewJiraIssues, saveJiraFieldConfig, saveJiraSelectMap, saveJiraProject, startJiraConnection } from "./actions";

const MAPPING_PATH = "/settings/integrations/jira/mapping";

type ProjectSearch = { values: { key: string; name: string; projectTypeKey: string; style?: string }[] };
type LinkRow = { id: string; project_id: string; connection_id: string; site_id: string; jira_project_key: string; jira_project_name: string; initiative_type_id: string; initiative_type_name: string; epic_type_id: string | null; epic_type_name: string | null; task_type_id: string | null; task_type_name: string | null };

/** Both sections of Settings, Integrations, Jira (decision 2026-11-03-tracker-field-config): the page and its /logs twin call this. */
export async function JiraSettings({ section, searchParams }: { section: TrackerSection; searchParams: Promise<{ status?: string; ignored?: string; c?: string; ch?: string; m?: string; why?: string; project?: string; t?: string }> }) {
  const { status, ignored, c: checkedN, ch: changedN, m: missingN, why, project: projectParam, t } = await searchParams;
  const { supabase, active } = await requireWorkspace(section === "connection" ? "/settings/integrations/jira" : `/settings/integrations/jira/${section}`);
  // each section loads only what it shows (decision 2026-11-16-tracker-settings-sections)
  const onProjects = section === "projects";
  const onMapping = section === "mapping";
  const onInbox = section === "inbox";
  const onLogs = section === "logs";
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
        onProjects && canAdmin && configured && c.state === "connected"
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
  const [{ data: projectRows }, { data: linkRows }, { data: readRows }, { data: countRows }, { data: mapRows }, { count: configCount }, { data: lastRunRows }] = await Promise.all([
    supabase.from("projects").select("id, name, tracker").eq("tenant_id", active.tenantId).order("name"),
    supabase.from("jira_project_links").select("id, project_id, connection_id, site_id, jira_project_key, jira_project_name, initiative_type_id, initiative_type_name, epic_type_id, epic_type_name, task_type_id, task_type_name").eq("tenant_id", active.tenantId),
    onInbox ? supabase.from("jira_reads").select("link_id, read_at, total, added, changed, truncated, error").eq("tenant_id", active.tenantId) : Promise.resolve({ data: [] }),
    supabase.rpc("jira_issue_counts"),
    // read apart from the link itself: a database that has not got the field mapping column yet must not hide the links (the mapping then shows as empty)
    onMapping ? supabase.from("jira_project_links").select("project_id, field_map").eq("tenant_id", active.tenantId) : Promise.resolve({ data: [] }),
    // the status header: has anything been changed from the defaults, and when did the last check run
    supabase.from("tracker_field_config").select("project_id", { count: "exact", head: true }).eq("tenant_id", active.tenantId).eq("provider", "jira"),
    supabase.from("jira_sync_events").select("received_at, summary").eq("tenant_id", active.tenantId).eq("kind", "run").order("received_at", { ascending: false }).limit(1),
  ]);
  const storedMaps = new Map(((mapRows ?? []) as { project_id: string; field_map: unknown }[]).map((r) => [r.project_id, r.field_map]));
  // the issues waiting for a decision (or the ignored ones of the project the person opened), at most 100 per project
  const linkedProjects = ((linkRows ?? []) as LinkRow[]).map((l) => l.project_id);
  const issueRows = new Map<string, JiraIssueView[]>();
  await Promise.all(
    (onInbox ? linkedProjects : []).map(async (project) => {
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
  const eligible = canAdmin && onProjects
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
          return { value: `${o.connection}|${o.site}|${o.key}`, label: o.label, group: o.group, types: d.issueTypes.map((t) => ({ id: t.id, name: t.name, hierarchyLevel: t.hierarchyLevel, subtask: t.subtask })), proposal: { initiative: proposal.initiative, epic: proposal.epic, task: proposal.task } } satisfies JiraProjectChoice;
        } catch {
          return null;
        }
      }),
    )
  ).filter((x): x is JiraProjectChoice => x !== null);

  // the field configuration (admins only): what each site offers (read once per site), the saved field map and the saved switches of each linked project
  const siteFields = new Map<string, Promise<JiraSiteFields | null>>();
  const fieldsFor = (connection: string, site: string) => {
    const k = `${connection}|${site}`;
    if (!siteFields.has(k)) siteFields.set(k, readJiraSiteFields(connection, site).catch((): null => null));
    return siteFields.get(k)!;
  };
  // the project the Field mapping section shows (one at a time): its saved settings, and the field catalog of its Jira project
  const allLinks = (linkRows ?? []) as LinkRow[];
  const selected = allLinks.find((l) => l.project_id === projectParam) ?? allLinks[0] ?? null;
  const { data: configRows } = canAdmin && onMapping && selected ? await supabase.from("tracker_field_config").select("project_id, slot, enabled, field_id, label_text").eq("tenant_id", active.tenantId).eq("provider", "jira").eq("project_id", selected.project_id) : { data: [] };
  const mappings = new Map<string, MappingView>();
  if (canAdmin && onMapping && selected) {
    const l = selected;
    const site = await fieldsFor(l.connection_id, l.site_id);
    const saved = ((configRows ?? []) as { project_id: string; slot: string; enabled: boolean; field_id: string | null; label_text?: string | null }[]).filter((r) => r.project_id === l.project_id).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id, text: r.label_text ?? null }));
    mappings.set(l.project_id, buildMappingView({ tracker: "jira", rows: parseConfigRows(saved, "jira"), jiraMap: parseFieldMap(storedMaps.get(l.project_id)), choices: site ? { startDates: site.startDates, themes: site.themes, priorities: site.priorities, dateFields: site.dateFields, proposal: site.proposal } : null }));
  }
  // "Initiative fields" (issue #512): Health, Initiative Status and Initiative Phase on custom select fields of the initiative issue
  let selectCard: React.ReactNode = null;
  if (canAdmin && onMapping && selected) {
    const { data: selRows } = await supabase.from("jira_select_map").select("slot, field_id, direction, options").eq("tenant_id", active.tenantId).eq("project_id", selected.project_id);
    const selRead = await readJiraSelectFields(selected.connection_id, selected.site_id, selected.jira_project_key, selected.initiative_type_id).then(
      (fields) => ({ fields, error: null as string | null }),
      (e: unknown) => ({ fields: null, error: e instanceof Error && /reconnect|sign/i.test(e.message) ? "Jira needs a new sign-in. A workspace admin can sign in again on Connect and configure." : "Jira could not be read just now (it refused the request or could not be reached). Read again in a minute." }),
    );
    const selFields = selRead.fields;
    const selError = selRead.error;
    const selCounts = await countWithValues(supabase, active.tenantId, selected.project_id, "item_jira_links");
    selectCard = <InitiativeSelectCard projectId={selected.project_id} projectName={((projectRows ?? []) as { id: string; name: string }[]).find((p) => p.id === selected.project_id)?.name ?? "this project"} saved={parseSelectMap(selectRowsToMap(selRows))} fields={selFields} action={saveJiraSelectMap} fieldsError={selError} counts={selCounts} readAt={readStamp()} readHref={`${MAPPING_PATH}?project=${encodeURIComponent(selected.project_id)}`} />;
  }
  const catalogs: TrackerCatalog[] = canAdmin && onMapping && selected
    ? [await readJiraCatalog(selected.connection_id, selected.site_id, selected.jira_project_key).catch((): null => null)].filter((c): c is TrackerCatalog => c !== null)
    : [];
  const linkedCounts = onProjects ? await countLinkedInitiatives(supabase, active.tenantId, ((projectRows ?? []) as { id: string }[]).map((p) => p.id)) : new Map<string, number>();
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
      linkedInitiatives: linkedCounts.get(p.id) ?? 0,
      rowLink: l ? { value: `${l.connection_id}|${l.site_id}|${l.jira_project_key}`, initiative: l.initiative_type_id, epic: l.epic_type_id, task: l.task_type_id } : null,
      mapping: mappings.get(p.id) ?? null,
    };
  });

  // Sync card: linked initiatives, the last check, the recent events and the state of live updates (admins see the events)
  const connected = rows.filter((c) => c.state === "connected");
  let sync: JiraSyncView | null = null;
  if (connected.length > 0 && onLogs) {
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

  // "Projects to check for epics" (issue #464): admins only, on the Projects section, for each connected site whose projects could be listed
  let epicSites: EpicProjectSite[] = [];
  if (canAdmin && onProjects) {
    const [{ data: tickedRows }, { data: treeRows }] = await Promise.all([
      supabase.from("jira_epic_projects").select("connection_id, site_id, project_key").eq("tenant_id", active.tenantId),
      supabase.from("item_jira_tree").select("issue_key").eq("tenant_id", active.tenantId).eq("level", 1).limit(5000),
    ]);
    const withEpics = new Set(((treeRows ?? []) as { issue_key: string }[]).map((t) => t.issue_key.replace(/-[0-9]+$/, "")));
    const ticked = (tickedRows ?? []) as { connection_id: string; site_id: string; project_key: string }[];
    epicSites = connections.flatMap((c) => c.projects.map((p) => ({ c, p }))).filter(({ p }) => (p.projects ?? []).length > 0).map(({ c, p }) => {
      const linked = ((linkRows ?? []) as LinkRow[]).filter((l) => l.connection_id === c.id && l.site_id === p.siteId).map((l) => l.jira_project_key);
      return {
        connectionId: c.id, siteId: p.siteId, siteName: c.sites.find((x) => x.id === p.siteId)?.name ?? "Jira",
        projects: (p.projects ?? []).map((j) => ({ key: j.key, name: j.name })),
        ticked: ticked.filter((t) => t.connection_id === c.id && t.site_id === p.siteId).map((t) => t.project_key),
        suggested: [...new Set([...linked, ...(p.projects ?? []).map((j) => j.key).filter((k) => withEpics.has(k))])],
      };
    });
  }

  const header: JiraHeaderView = {
    linked: allLinks.length,
    waiting: [...counts.values()].reduce((n, c) => n + c.not_pulled, 0),
    customised: (configCount ?? 0) > 0,
    lastCheck: ((lastRunRows ?? []) as { received_at: string }[])[0]?.received_at ?? null,
  };

  return (
    <JiraConnectionsView
      connections={connections} canAdmin={canAdmin} configured={configured} status={status} why={why} checked={checkedN ? { c: checkedN, ch: changedN ?? "0", m: missingN ?? "0" } : undefined}
      connectAction={startJiraConnection} disconnectAction={disconnectJira} projectLinks={projectLinks} choices={choices} sync={sync} saveProjectAction={saveJiraProject} readAction={readJiraNow}
      checkAction={checkJiraNow} section={section} catalogs={catalogs} retryAction={retryJiraEvent} canEdit={canEdit} reviewAction={reviewJiraIssues} fieldConfigAction={saveJiraFieldConfig}
      header={header} selectedProject={selected?.project_id} copyAction={copyJiraFieldConfig} version={t} mappingExtra={selectCard}
      projectsExtra={<EpicProjectsCard sites={epicSites} status={status} saved={epicSites.some((e) => e.ticked.length > 0)} />}
    />
  );
}
