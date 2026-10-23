import { requireWorkspace } from "@/lib/session";
import { githubAppSlug, type ConnectionRow } from "@/lib/github/server";
import { AutoRefresh } from "./auto-refresh";
import { ConnectForm, ProjectRow, RepoRow } from "./forms";
import { continueOnGithub, disconnectGithub, refreshRepositories } from "./actions";
import Link from "next/link";

export const metadata = { title: "GitHub · Product Velocity" };

const NOTICE: Record<string, string> = {
  waiting: "Request sent. An owner of the GitHub organisation must approve it; this page updates when GitHub confirms.",
  installed: "Installed on GitHub. Waiting for GitHub to confirm; this page updates when it does.",
  connected: "Connected.",
  disconnected: "Disconnected. The App stays installed on GitHub until an organisation owner uninstalls it.",
  refreshed: "Repositories refreshed.",
  "bad-link": "That link is no longer valid. Start the connection again.",
  "wrong-account": "GitHub was installed on a different account than the one you entered. Cancel and connect again with the right name.",
  "not-found": "GitHub did not recognise that installation. Try again.",
  "already-linked": "That GitHub installation is already connected to another workspace.",
  "not-admin": "Only admins can connect GitHub.",
  error: "Something went wrong. Try again, or run the connection test.",
};

const STATE: Record<ConnectionRow["state"], string> = {
  requested: "Started: finish the install on GitHub",
  waiting_approval: "Waiting for approval by a GitHub organisation owner",
  installing: "Installed: waiting for GitHub to confirm",
  connected: "Connected",
  suspended: "Suspended on GitHub",
  disconnected: "Not connected",
};

type Repo = { id: string; full_name: string; is_private: boolean; access: string };
type Project = { id: string; name: string; default_repo: string | null; who_breaks_down: "product" | "engineering" | "either" };

export default async function GithubSettingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase, active } = await requireWorkspace("/settings/integrations/github");
  const isAdmin = active.role === "admin";

  const { data: conn } = await supabase.from("github_connections").select("*").eq("tenant_id", active.tenantId).neq("state", "disconnected").maybeSingle();
  const c = conn as (ConnectionRow & { repository_selection: string | null; epic_type_available: boolean | null; repositories_synced_at: string | null }) | null;
  const { data: repoRows } = c ? await supabase.from("github_repositories").select("id, full_name, is_private, access").eq("connection_id", c.id).is("removed_at", null).order("full_name") : { data: [] };
  const { data: projectRows } = await supabase.from("projects").select("id, name, default_repo, who_breaks_down").eq("tenant_id", active.tenantId).order("name");
  const repos = (repoRows ?? []) as Repo[];
  const projects = (projectRows ?? []) as Project[];
  const state = c?.state ?? "disconnected";

  return (
    <div className="page-narrow">
      <h1>GitHub</h1>
      <p className="muted">
        Connect this workspace to a GitHub organisation. Product Velocity never copies commercial fields (value, confidence, customers, decisions) to GitHub.
        {" "}App name on GitHub: <strong>{githubAppSlug() ?? "not configured"}</strong>.
      </p>
      {(state === "waiting_approval" || state === "installing") && <AutoRefresh />}
      {status && NOTICE[status] && <p role="status" className="notice">{NOTICE[status]}</p>}

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
            Pick the default repository for each project (tracking issues are created there) and who breaks the work down. {repos.filter((r) => r.access === "read_write").length} writable repositor{repos.filter((r) => r.access === "read_write").length === 1 ? "y is" : "ies are"} available.
          </p>
          <table className="table">
            <thead>
              <tr><th scope="col">Project</th><th scope="col">Default repository</th><th scope="col">Who breaks down the work</th><th scope="col"><span className="visually-hidden">Save</span></th></tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <ProjectRow key={p.id} project={p} repos={repos.filter((r) => r.access === "read_write").map((r) => r.full_name)} canEdit={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
