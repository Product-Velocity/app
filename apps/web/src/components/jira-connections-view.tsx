import type { JiraConnectionRow } from "@/lib/atlassian/server";

export type JiraProjectInfo = { key: string; name: string; type: string; style: string | null };
export type JiraSiteProjects = { siteId: string; projects: JiraProjectInfo[] | null; error?: string };
export type JiraConnectionView = Pick<JiraConnectionRow, "id" | "state" | "sites" | "created_at" | "state_changed_at"> & { projects: JiraSiteProjects[] };

export const JIRA_NOTICE: Record<string, string> = {
  connected: "Connected.",
  disconnected: "Disconnected. The saved sign-in was deleted. You can also remove Product Velocity under connected apps in your Atlassian account.",
  "bad-link": "That link is no longer valid or belongs to someone else. Start the connection again.",
  "not-admin": "Only admins can connect Jira.",
  denied: "Atlassian did not give access, so nothing was connected.",
  "no-site": "That sign-in does not reach any Jira site. Choose a Jira site on Atlassian's screen and try again.",
  "not-configured": "Jira is not set up for this deployment yet.",
  error: "Something went wrong. Try again.",
};

const STATE: Record<JiraConnectionRow["state"], string> = { connected: "Connected", reconnect_needed: "Sign in again needed", disconnected: "Not connected" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

type Props = {
  connections: JiraConnectionView[];
  canAdmin: boolean;
  configured: boolean;
  status?: string | undefined;
  connectAction: () => void | Promise<void>;
  disconnectAction: (formData: FormData) => void | Promise<void>;
};

/** Settings → Integrations → Jira (issue #67, slice A). Presentational: the page supplies the data and the actions. */
export function JiraConnectionsView({ connections, canAdmin, configured, status, connectAction, disconnectAction }: Props) {
  const needsSignIn = connections.some((c) => c.state === "reconnect_needed");
  return (
    <div className="page-narrow">
      <h1>Jira</h1>
      <p className="muted">
        Connect this workspace to Jira Cloud. Product Velocity never copies commercial fields (value, confidence, customers, decisions) to Jira. A project links to one Jira project later; here you only sign in.
      </p>
      {status && JIRA_NOTICE[status] && <p role="status" className="notice">{JIRA_NOTICE[status]}</p>}
      {needsSignIn && <p role="alert" className="notice">Atlassian no longer accepts the saved sign-in for at least one site. Sign in again to keep it working.</p>}
      {!configured && <p role="alert" className="notice">Jira is not set up for this deployment: the platform owner has to set the Atlassian app variables.</p>}

      <div className="card stack">
        <h2>Connections</h2>
        {connections.length === 0 && <p className="muted">Not connected yet.</p>}
        {connections.map((c) => (
          <section key={c.id} className="stack" aria-labelledby={`jira-${c.id}`}>
            <h3 id={`jira-${c.id}`}>{c.sites.map((s) => s.name).join(", ") || "Jira"}</h3>
            <p>
              <strong>{STATE[c.state]}</strong> · since {date(c.created_at)}
              {c.state === "reconnect_needed" ? <> · stopped {date(c.state_changed_at)}</> : null}
            </p>
            {c.projects.map((p) => {
              const site = c.sites.find((s) => s.id === p.siteId);
              return (
                <div key={p.siteId}>
                  {p.projects ? (
                    <table className="table">
                      <caption className="visually-hidden">Jira projects of {site?.name ?? "this site"}</caption>
                      <thead><tr><th scope="col">Key</th><th scope="col">Project</th><th scope="col">Type</th></tr></thead>
                      <tbody>
                        {p.projects.length === 0 && <tr><td colSpan={3} className="muted">No projects visible to this sign-in.</td></tr>}
                        {p.projects.map((j) => (
                          <tr key={j.key}><td>{j.key}</td><td>{j.name}</td><td>{j.type === "product_discovery" ? "Product Discovery" : j.type === "software" ? "Software" : j.type === "business" ? "Business" : j.type}{j.style === "next-gen" ? " (team-managed)" : ""}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted">Projects could not be read: {p.error ?? "unknown reason"}.</p>
                  )}
                </div>
              );
            })}
            {canAdmin && c.state !== "disconnected" && (
              <form action={disconnectAction} className="row-form">
                <input type="hidden" name="id" value={c.id} />
                <button className="btn" type="submit">Disconnect {c.sites[0]?.name ?? "Jira"}</button>
              </form>
            )}
          </section>
        ))}
        {canAdmin ? (
          <form action={connectAction} className="stack">
            <p className="muted">
              You will be sent to Atlassian to approve Product Velocity for the Jira site you choose. It asks to read and write Jira work and to read users, and to stay signed in. It never asks to change a site&rsquo;s settings.
            </p>
            <div>
              <button className="btn btn-primary" type="submit" disabled={!configured}>{needsSignIn ? "Sign in to Jira again" : connections.length ? "Connect another Jira site" : "Connect Jira"}</button>
            </div>
          </form>
        ) : (
          <p className="muted">An admin can connect Jira.</p>
        )}
      </div>
    </div>
  );
}
