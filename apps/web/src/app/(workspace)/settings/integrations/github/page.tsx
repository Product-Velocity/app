import { requireWorkspace } from "@/lib/session";
import { githubAppSlug, githubSourceControl, type ConnectionRow } from "@/lib/github/server";
import { readGithubCatalog } from "@/lib/github/catalog-server";
import { FieldCatalogView, FieldMappingForm } from "@/components/tracker-field-config";
import { buildMappingView } from "@/lib/tracker-fields/view";
import { parseConfigRows } from "@/lib/tracker-fields/mapping";
import { saveGithubFieldConfig } from "./actions";
import { AutoRefresh } from "./auto-refresh";
import { parseBoard } from "@pv/github";
import { BoardsCard } from "./boards";
import { ConnectForm, ProjectRow, RepoRow } from "./forms";
import { confirmWithGithub, continueOnGithub, disconnectGithub, refreshRepositories } from "./actions";
import { NOTICE, STATE } from "./shared";
import { TrackerTabs } from "@/components/tracker-tabs";
import Link from "next/link";

export const metadata = { title: "GitHub · Product Velocity" };
/** The field catalog reads several GitHub endpoints: allow the longest run the plan offers. */
export const maxDuration = 60;

type Repo = { id: string; full_name: string; is_private: boolean; access: string };
type Project = { id: string; name: string; default_repo: string | null; who_breaks_down: "product" | "engineering" | "either"; tracker: string | null; github_board?: unknown };

export default async function GithubSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string; why?: string }> }) {
  const { status, why } = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/integrations/github");
  const isAdmin = active.role === "admin";

  const { data: conn } = await supabase.from("github_connections").select("*").eq("tenant_id", active.tenantId).neq("state", "disconnected").maybeSingle();
  const c = conn as (ConnectionRow & { account_type: string | null; repository_selection: string | null; epic_type_available: boolean | null; repositories_synced_at: string | null; last_check_at: string | null; last_check_summary: string | null }) | null;
  const { data: repoRows } = c ? await supabase.from("github_repositories").select("id, full_name, is_private, access").eq("connection_id", c.id).is("removed_at", null).order("full_name") : { data: [] };
  const { data: projectRows } = await supabase.from("projects").select("id, name, default_repo, who_breaks_down, tracker, github_board").eq("tenant_id", active.tenantId).order("name");
  const repos = (repoRows ?? []) as Repo[];
  const projects = (projectRows ?? []) as Project[];
  const state = c?.state ?? "disconnected";

  // the read-only field catalog (admins): organisation issue fields, the linked boards' fields, labels, issue types, milestones
  const sc = isAdmin && c?.state === "connected" && c.installation_id !== null && c.account_login ? githubSourceControl() : null;
  const boardList = projects.flatMap((p) => { const b = parseBoard(p.github_board); return b ? [{ id: b.id, title: b.title }] : []; });
  const catalog = sc && c?.installation_id != null && c.account_login
    ? await readGithubCatalog(sc, c.installation_id, c.account_login, { boards: boardList, repos: [...new Set(projects.flatMap((p) => (p.default_repo ? [p.default_repo] : [])))] }).catch((): null => null)
    : null;

  const { data: configRows } = isAdmin && c?.state === "connected" ? await supabase.from("tracker_field_config").select("project_id, slot, enabled, field_id").eq("tenant_id", active.tenantId).eq("provider", "github") : { data: [] };
  const githubProjects = projects.filter((p) => p.tracker === "github");

  return (
    <div className="page-narrow">
      <h1>GitHub</h1>
      <p className="muted">
        Connect this workspace to a GitHub organisation. Product Velocity never copies commercial fields (value, confidence, customers, decisions) to GitHub.
        {" "}App name on GitHub: <strong>{githubAppSlug() ?? "not configured"}</strong>.
      </p>
      <TrackerTabs base="/settings/integrations/github" current="configure" tracker="GitHub" />
      {(state === "waiting_approval" || state === "installing") && <AutoRefresh />}
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}
      {(status === "error" || status === "field-config-invalid") && why && <p role="alert" className="notice">Reason: {why.slice(0, 200)}</p>}

      <div className="card stack">
        <h2>Status</h2>
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
              <button className="btn" type="submit">{c.state === "connected" || c.state === "suspended" ? "Disconnect" : "Cancel"}</button>
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

      {c?.state === "connected" && (
        <div className="card stack">
          <h2>Repositories</h2>
          <p className="muted">
            Product Velocity never writes to a repository marked read-only: it cannot be a project&rsquo;s default repository and a push to it is refused. Public repositories start read-only.
          </p>
          <table className="table">
            <thead>
              <tr><th scope="col">Repository</th><th scope="col">Visibility</th><th scope="col">Access</th><th scope="col"><span className="visually-hidden">Save</span></th></tr>
            </thead>
            <tbody>{repos.map((r) => <RepoRow key={r.id} repo={r} canEdit={isAdmin} />)}</tbody>
          </table>
        </div>
      )}

      {c?.state === "connected" && (
        <div className="card stack">
          <h2>Projects</h2>
          <p className="muted">
            A project has exactly one delivery tracker, and every initiative in it syncs with that tracker only. Pick it here, then the default repository for each GitHub project (tracking issues are created there) and who breaks the work down. {repos.filter((r) => r.access === "read_write").length} writable repositor{repos.filter((r) => r.access === "read_write").length === 1 ? "y is" : "ies are"} available.
          </p>
          <table className="table">
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
      )}

      {c?.state === "connected" && (
        <BoardsCard projects={projects.map((p) => ({ id: p.id, name: p.name, tracker: p.tracker, board: parseBoard(p.github_board) }))} canEdit={isAdmin} personalAccount={c.account_type === "User"} />
      )}

      {isAdmin && c?.state === "connected" && (
        <div className="card stack">
          <h2>Field configuration</h2>
          <p className="muted">Where each Product Velocity field goes in GitHub, for each project that uses GitHub. The defaults are what Sync does without any change; change what you need and save. Nothing here is written to GitHub: the next Sync uses it and the preview says what is skipped.</p>
          {githubProjects.length === 0 && <p className="muted">No project uses GitHub as its delivery tracker yet. Choose it under Projects above.</p>}
          {githubProjects.map((p) => (
            <FieldMappingForm key={p.id} tracker="GitHub" projectId={p.id} projectName={p.name} action={saveGithubFieldConfig}
              view={buildMappingView({ tracker: "github", board: parseBoard(p.github_board), rows: parseConfigRows(((configRows ?? []) as { project_id: string; slot: string; enabled: boolean; field_id: string | null }[]).filter((r) => r.project_id === p.id).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id })), "github") })} />
          ))}
          <h3>Fields GitHub shows this connection</h3>
          <p className="muted">Organisation issue fields, the linked boards&rsquo; fields, labels, issue types and milestones.</p>
          {catalog ? <FieldCatalogView catalogs={[catalog]} tracker="GitHub" id="github-catalog" /> : <p role="alert" className="error">GitHub could not be read just now. Try again in a minute.</p>}
        </div>
      )}
    </div>
  );
}
