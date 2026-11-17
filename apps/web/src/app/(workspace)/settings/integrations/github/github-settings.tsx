import Link from "next/link";
import { requireWorkspace } from "@/lib/session";
import { githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { readGithubCatalog } from "@/lib/github/catalog-server";
import { FieldWorkbench } from "@/components/tracker-field-workbench";
import { SetupSteps } from "@/components/tracker-status-header";
import { TableTools } from "@/components/table-tools";
import { TrackerProjectPicker } from "@/components/tracker-project-picker";
import { buildMappingView } from "@/lib/tracker-fields/view";
import { parseConfigRows } from "@/lib/tracker-fields/mapping";
import { setupSteps, type TrackerSection } from "@/lib/tracker-fields/sections";
import { unlinkedFields } from "@/lib/tracker-fields/workbench";
import { copyGithubFieldConfig, saveGithubFieldConfig } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { parseBoard } from "@pv/github";
import { BoardsCard } from "./boards";
import { EpicReposCard } from "./epic-repos-card";
import { ConnectForm, ProjectRow, RepoRow } from "./forms";
import { confirmWithGithub, continueOnGithub, disconnectGithub, refreshRepositories } from "./actions";
import { CopyMapping } from "@/components/copy-mapping";
import { GITHUB_BASE, GithubHeader } from "./header";
import { NOTICE, STATE } from "./shared";
import { githubAppSlug } from "@/lib/github/server";

type Repo = { id: string; full_name: string; is_private: boolean; access: string };
type Project = { id: string; name: string; default_repo: string | null; who_breaks_down: "product" | "engineering" | "either"; tracker: string | null; github_board?: unknown };
type Search = { status?: string; why?: string; project?: string; t?: string };

/**
 * Settings, Integrations, GitHub: the sections Connection, Projects, Field mapping and Inbox (Sync & logs has its own page). Each route loads only what its section
 * shows (decision 2026-11-16-tracker-settings-sections). The same sections, in the same order, as Jira.
 */
export async function GithubSettings({ section, searchParams }: { section: Exclude<TrackerSection, "logs">; searchParams: Promise<Search> }) {
  const { status, why, project: projectParam, t } = await searchParams;
  const here = section === "connection" ? GITHUB_BASE : `${GITHUB_BASE}/${section}`;
  const { supabase, active } = await requireWorkspace(here);
  const isAdmin = active.role === "admin";

  const { data: conn } = await supabase.from("github_connections").select("*").eq("tenant_id", active.tenantId).neq("state", "disconnected").maybeSingle();
  const c = conn as (ConnectionRow & { account_type: string | null; repository_selection: string | null; epic_type_available: boolean | null; repositories_synced_at: string | null; last_check_at: string | null; last_check_summary: string | null }) | null;
  const connected = c?.state === "connected";
  const state = c?.state ?? "disconnected";

  const { data: projectRows } = await supabase.from("projects").select("id, name, default_repo, who_breaks_down, tracker, github_board").eq("tenant_id", active.tenantId).order("name");
  const projects = (projectRows ?? []) as Project[];
  const githubProjects = projects.filter((p) => p.tracker === "github");

  // Projects section: the repositories and the epic repositories
  const { data: repoRows } = c && section === "projects" ? await supabase.from("github_repositories").select("id, full_name, is_private, access").eq("connection_id", c.id).is("removed_at", null).order("full_name") : { data: [] };
  const repos = (repoRows ?? []) as Repo[];
  const [{ data: epicTickedRows }, { data: epicTreeRows }] = isAdmin && connected && section === "projects"
    ? await Promise.all([
      supabase.from("github_epic_repos").select("repo_full_name").eq("tenant_id", active.tenantId),
      supabase.from("item_issue_tree").select("repo_full_name").eq("tenant_id", active.tenantId).eq("level", 1).limit(5000),
    ])
    : [{ data: [] }, { data: [] }];
  const epicTicked = ((epicTickedRows ?? []) as { repo_full_name: string }[]).map((r) => r.repo_full_name);
  const epicTreeRepos = ((epicTreeRows ?? []) as { repo_full_name: string }[]).map((r) => r.repo_full_name);

  // Field mapping section: ONE project at a time, its saved settings and the connection's own fields
  const selected = githubProjects.find((p) => p.id === projectParam) ?? githubProjects[0] ?? null;
  const { data: configRows } = section === "mapping" && isAdmin && connected && selected ? await supabase.from("tracker_field_config").select("project_id, slot, enabled, field_id, label_text").eq("tenant_id", active.tenantId).eq("provider", "github").eq("project_id", selected.id) : { data: [] };
  const mappingOf = (p: Project) =>
    buildMappingView({ tracker: "github", board: parseBoard(p.github_board), rows: parseConfigRows(((configRows ?? []) as { project_id: string; slot: string; enabled: boolean; field_id: string | null; label_text?: string | null }[]).filter((r) => r.project_id === p.id).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id, text: r.label_text ?? null })), "github") });
  const sc = section === "mapping" && isAdmin && connected && c?.installation_id != null && c.account_login ? githubSourceControl() : null;
  const catalog = sc && selected && c?.installation_id != null && c.account_login
    ? await readGithubCatalog(sc, c.installation_id, c.account_login, { boards: (() => { const b = parseBoard(selected.github_board); return b ? [{ id: b.id, title: b.title }] : []; })(), repos: selected.default_repo ? [selected.default_repo] : [] }).catch((): null => null)
    : null;
  const view = selected && section === "mapping" && isAdmin && connected ? mappingOf(selected) : null;
  const unlinked = view && selected ? unlinkedFields(catalog, [{ name: selected.name, view, board: parseBoard(selected.github_board) }]) : null;

  return (
    <div className="page-full">
      <GithubHeader supabase={supabase} tenantId={active.tenantId} c={c} current={section} />
      {section === "connection" && <p className="muted">App name on GitHub: <strong>{githubAppSlug() ?? "not configured"}</strong>.</p>}
      {(state === "waiting_approval" || state === "installing") && section === "connection" && <AutoRefresh />}
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      {(status === "error" || status === "field-config-invalid") && why && <p role="alert" className="notice">Reason: {why.slice(0, 200)}</p>}

      {section === "connection" && (
        <>
          <SetupSteps steps={setupSteps({ tracker: "GitHub", connected, linkedProjects: githubProjects.length, customised: false })} base={GITHUB_BASE} />
          <div className="card stack">
            <h2>Connection</h2>
            <p>
              <strong>{STATE[state]}</strong>
              {c?.account_login ? <> · {c.account_login} ({c.repository_selection === "all" ? "all repositories" : "selected repositories"})</> : c ? <> · {c.expected_account}</> : null}
            </p>

            {!c && isAdmin && <ConnectForm />}
            {!c && !isAdmin && <p className="muted">An admin can connect GitHub.</p>}

            {c && isAdmin && (
              <div className="row-form">
                {c.state === "installing" && c.installation_id !== null && (
                  <form action={confirmWithGithub}><button className="btn" type="submit">Confirm with GitHub</button></form>
                )}
                {(c.state === "requested" || c.state === "waiting_approval" || c.state === "installing") && (
                  <form action={continueOnGithub.bind(null, c.id)}><button className="btn" type="submit">Open GitHub again</button></form>
                )}
                {c.state === "connected" && (
                  <form action={refreshRepositories}><button className="btn" type="submit">Refresh repositories</button></form>
                )}
                {c.installation_id !== null && <Link className="btn" href="/settings/integrations/github/test">Test connection</Link>}
                <form action={disconnectGithub}>
                  <button className={c.state === "connected" || c.state === "suspended" ? "btn btn-danger-quiet" : "btn"} type="submit">{c.state === "connected" || c.state === "suspended" ? "Disconnect" : "Cancel"}</button>
                </form>
              </div>
            )}
            {c?.state === "installing" && c.installation_id !== null && isAdmin && (
              <p className="muted">GitHub has the App installed. This page updates when GitHub confirms. If it does not within a minute, press Confirm with GitHub: it asks GitHub directly and does not need the App owner.</p>
            )}
            {c?.state === "connected" && (
              <p className="muted">
                Issue type Epic: {c.epic_type_available === null ? "unknown (the App may not read issue types yet)" : c.epic_type_available ? "available" : "not available in this organisation, epics will use a label"}.
                {c.repositories_synced_at ? <> Repositories last read {new Date(c.repositories_synced_at).toLocaleString()}.</> : null}
              </p>
            )}
          </div>
        </>
      )}

      {section !== "connection" && !connected && (
        <p className="muted">GitHub is not connected. <Link href={GITHUB_BASE}>Connect it</Link> first; this section opens once it is.</p>
      )}

      {section === "projects" && connected && (
        <>
          <div className="card stack">
            <h2>Projects</h2>
            <p className="muted">
              A project has exactly one delivery tracker, and every initiative in it syncs with that tracker only. Pick it here, then the default repository for each GitHub project (tracking issues are created there) and who breaks the work down. {repos.filter((r) => r.access === "read_write").length} writable repositor{repos.filter((r) => r.access === "read_write").length === 1 ? "y is" : "ies are"} available.
            </p>
            <TableTools tableId="gh-projects" noun="projects" linkedLabel="Only projects that use GitHub" />
            <div className="table-wrap">
              <table className="table" id="gh-projects">
                <thead>
                  <tr><th scope="col">Project</th><th scope="col">Delivery tracker</th><th scope="col">Default repository</th><th scope="col">Who breaks down the work</th><th scope="col"><span className="visually-hidden">Save</span></th></tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <ProjectRow key={p.id} project={p} repos={repos.filter((r) => r.access === "read_write").map((r) => r.full_name)} canEdit={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <BoardsCard projects={projects.map((p) => ({ id: p.id, name: p.name, tracker: p.tracker, board: parseBoard(p.github_board) }))} canEdit={isAdmin} personalAccount={c?.account_type === "User"} />

          <div className="card stack">
            <h2>Repositories</h2>
            <p className="muted">
              Product Velocity never writes to a repository marked read-only: it cannot be a project&rsquo;s default repository and a push to it is refused. Public repositories start read-only.
            </p>
            <TableTools tableId="gh-repos" noun="repositories" />
            <div className="table-wrap">
              <table className="table" id="gh-repos">
                <thead>
                  <tr><th scope="col">Repository</th><th scope="col">Visibility</th><th scope="col">Access</th><th scope="col"><span className="visually-hidden">Save</span></th></tr>
                </thead>
                <tbody>{repos.map((r) => <RepoRow key={r.id} repo={r} canEdit={isAdmin} />)}</tbody>
              </table>
            </div>
          </div>

          {isAdmin && (
            <EpicReposCard
              repos={repos.map((r) => r.full_name)}
              ticked={epicTicked}
              suggested={[...new Set([...projects.flatMap((x) => (x.default_repo ? [x.default_repo] : [])), ...epicTreeRepos])].filter((n) => repos.some((r) => r.full_name === n))}
            />
          )}
        </>
      )}

      {section === "mapping" && connected && (
        <div className="card stack">
          <h2>Field mapping</h2>
          <p className="muted">One table per project: every Product Velocity field and where it goes in GitHub, with the setting in the row. It opens on the fields Sync moves. The defaults are what Sync does without any change. Nothing here is written to GitHub: the next Sync uses it and the preview says what is skipped.</p>
          {!isAdmin && <p className="muted">An admin can change the field mapping.</p>}
          {isAdmin && githubProjects.length === 0 && <p className="muted">No project uses GitHub as its delivery tracker yet. Choose it on the <Link href={`${GITHUB_BASE}/projects`}>Projects</Link> section.</p>}
          {isAdmin && selected && view && unlinked && (
            <>
              <TrackerProjectPicker projects={githubProjects.map((p) => ({ id: p.id, name: p.name }))} current={selected.id} action={`${GITHUB_BASE}/mapping`} />
              <FieldWorkbench key={`${selected.id}-${t ?? ""}`} tracker="GitHub" projectId={selected.id} projectName={selected.name} action={saveGithubFieldConfig} view={view} unlinked={unlinked.fields} unlinkedError={unlinked.error} unlinkedNotes={unlinked.notes} />
              {githubProjects.length > 1 && <CopyMapping tracker="GitHub" fromId={selected.id} fromName={selected.name} others={githubProjects.filter((p) => p.id !== selected.id).map((p) => ({ id: p.id, name: p.name }))} action={copyGithubFieldConfig} />}
            </>
          )}
        </div>
      )}

      {section === "inbox" && connected && (
        <div className="card stack">
          <h2>Inbox</h2>
          <p>GitHub issues and epics that are not in the roadmap yet wait on <Link href="/incoming">Incoming, GitHub</Link>, the same place Jira\u2019s waiting issues are listed under Incoming, Jira. Nothing is in the roadmap until a person pulls it in.</p>
          <div><Link className="btn btn-primary" href="/incoming">Open Incoming from GitHub</Link></div>
        </div>
      )}
    </div>
  );
}
