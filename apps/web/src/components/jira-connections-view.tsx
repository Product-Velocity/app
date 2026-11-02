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
  linked: "Linked. The project now uses Jira as its tracker.",
  unlinked: "Unlinked. The project has no tracker again.",
  read: "Read Jira. The result is under the project.",
  "read-failed": "Jira could not be read. The reason is under the project.",
  "read-reconnect": "Jira no longer accepts the saved sign-in. Sign in again.",
  "link-unavailable": "That Jira connection or site is not available. Reload the page and try again.",
  "link-type": "Only software and business Jira projects can be linked for now. Product Discovery ideas come later.",
  "link-types": "Choose three different issue types of that Jira project; the initiative type is required.",
  "link-tracker": "That project already uses another tracker. Remove its links there first.",
  "link-taken": "That Jira project is already linked to another project of this workspace.",
};

const STATE: Record<JiraConnectionRow["state"], string> = { connected: "Connected", reconnect_needed: "Sign in again needed", disconnected: "Not connected" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export type JiraProjectOption = { value: string; label: string; group: string };
export type JiraProjectLinkView = {
  projectId: string;
  projectName: string;
  link: { jiraKey: string; jiraName: string; siteName: string; initiative: string; epic: string | null; task: string | null } | null;
  /** The last read of the linked Jira project (slice C1) and how many issues are in each state. */
  read?: { readAt: string; total: number; added: number; changed: number; truncated: boolean; error: string | null } | null;
  counts?: { not_pulled: number; pulled: number; ignored: number };
  /** Step 2: the Jira project was chosen; its own issue types and the proposal. */
  mapping: null | { connection: string; site: string; key: string; jiraName: string; types: { id: string; name: string }[]; proposal: { initiative: string | null; epic: string | null; task: string | null } };
  /** The admin pressed Change, or there is no link yet: show step 1. */
  choosing: boolean;
};

type Props = {
  connections: JiraConnectionView[];
  canAdmin: boolean;
  configured: boolean;
  status?: string | undefined;
  connectAction: () => void | Promise<void>;
  disconnectAction: (formData: FormData) => void | Promise<void>;
  projectLinks?: JiraProjectLinkView[];
  jiraOptions?: JiraProjectOption[];
  /** Address of this page, for the "choose a Jira project" step (a plain GET form, no script needed). */
  basePath?: string;
  linkAction?: (formData: FormData) => void | Promise<void>;
  unlinkAction?: (formData: FormData) => void | Promise<void>;
  readAction?: (formData: FormData) => void | Promise<void>;
};

/** Settings → Integrations → Jira (issue #67, slice A). Presentational: the page supplies the data and the actions. */
export function JiraConnectionsView({ connections, canAdmin, configured, status, connectAction, disconnectAction, projectLinks = [], jiraOptions = [], basePath = "/settings/integrations/jira", linkAction, unlinkAction, readAction }: Props) {
  const needsSignIn = connections.some((c) => c.state === "reconnect_needed");
  return (
    <div className="page-narrow">
      <h1>Jira</h1>
      <p className="muted">
        Connect this workspace to Jira Cloud. Product Velocity never copies commercial fields (value, confidence, customers, decisions) to Jira. Sign in below, then link each project to the Jira project it uses.
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

      {connections.some((c) => c.state === "connected") && projectLinks.length > 0 && (
        <div className="card stack">
          <h2>Project links</h2>
          <p className="muted">
            A project uses one tracker. Link a project to a Jira project and say which of that Jira project&rsquo;s own issue types are an initiative, an epic and a task; Jira projects differ, so the choice is made per project.
            Reading Jira fills a list of open issues; nothing is created in the roadmap and nothing is written to Jira.
          </p>
          {projectLinks.map((p) => (
            <section key={p.projectId} className="stack" aria-labelledby={`pl-${p.projectId}`}>
              <h3 id={`pl-${p.projectId}`}>{p.projectName}</h3>
              {p.link && !p.mapping && (
                <p>
                  Linked to <strong>{p.link.jiraKey}</strong> · {p.link.jiraName} ({p.link.siteName}). Initiative is <strong>{p.link.initiative}</strong>
                  {p.link.epic ? <>, epic is <strong>{p.link.epic}</strong></> : null}
                  {p.link.task ? <>, task is <strong>{p.link.task}</strong></> : null}.
                </p>
              )}
              {p.link && !p.mapping && (
                <div className="stack">
                  {p.read ? (
                    p.read.error ? (
                      <p>Last read {new Date(p.read.readAt).toLocaleString("en-GB")} failed: {p.read.error}</p>
                    ) : (
                      <p>
                        Last read {new Date(p.read.readAt).toLocaleString("en-GB")}: {p.read.total} open {p.read.total === 1 ? "issue" : "issues"}
                        {p.read.added || p.read.changed ? ` (${p.read.added} new, ${p.read.changed} changed)` : ""}.
                        {p.read.truncated ? " More than the first 1,000 exist; only the newest were read." : ""}
                      </p>
                    )
                  ) : (
                    <p className="muted">Not read yet.</p>
                  )}
                  {p.counts && (p.counts.not_pulled + p.counts.pulled + p.counts.ignored > 0) && (
                    <p className="muted">{p.counts.not_pulled} not pulled in, {p.counts.pulled} pulled in, {p.counts.ignored} ignored. Nothing is in the roadmap until it is pulled in.</p>
                  )}
                  {canAdmin && readAction && (
                    <form action={readAction}>
                      <input type="hidden" name="project" value={p.projectId} />
                      <button className="btn" type="submit" aria-label={`Read Jira now for ${p.projectName}`}>Read Jira now</button>
                    </form>
                  )}
                </div>
              )}
              {!p.link && !p.mapping && !canAdmin && <p className="muted">Not linked to Jira.</p>}
              {canAdmin && p.link && !p.choosing && !p.mapping && (
                <div className="row-form">
                  <a className="btn" href={`${basePath}?pv=${p.projectId}`} aria-label={`Change the Jira link of ${p.projectName}`}>Change</a>
                  {unlinkAction && (
                    <form action={unlinkAction}>
                      <input type="hidden" name="project" value={p.projectId} />
                      <button className="btn" type="submit" aria-label={`Unlink ${p.projectName} from Jira`}>Unlink</button>
                    </form>
                  )}
                </div>
              )}
              {canAdmin && p.choosing && !p.mapping && (
                <form method="get" action={basePath} className="stack">
                  <input type="hidden" name="pv" value={p.projectId} />
                  <div className="field">
                    <label htmlFor={`jp-${p.projectId}`}>Jira project for {p.projectName}</label>
                    <select id={`jp-${p.projectId}`} name="jp" required defaultValue="">
                      <option value="" disabled>Choose a Jira project…</option>
                      {[...new Set(jiraOptions.map((o) => o.group))].map((g) => (
                        <optgroup key={g} label={g}>
                          {jiraOptions.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="row-form">
                    <button className="btn" type="submit" disabled={jiraOptions.length === 0}>Choose</button>
                    {p.link && <a className="btn" href={basePath}>Cancel</a>}
                  </div>
                  {jiraOptions.length === 0 && <p className="muted">No software or business Jira project is visible to the connection.</p>}
                </form>
              )}
              {canAdmin && p.mapping && linkAction && (
                <form action={linkAction} className="stack">
                  <input type="hidden" name="project" value={p.projectId} />
                  <input type="hidden" name="connection" value={p.mapping.connection} />
                  <input type="hidden" name="site" value={p.mapping.site} />
                  <input type="hidden" name="key" value={p.mapping.key} />
                  <p>Jira project <strong>{p.mapping.key}</strong> · {p.mapping.jiraName}. Its issue types:</p>
                  {([["initiative", "An initiative is the Jira issue type", true], ["epic", "An epic is", false], ["task", "A task is", false]] as const).map(([name, label, required]) => (
                    <div className="field" key={name}>
                      <label htmlFor={`${name}-${p.projectId}`}>{label}{required ? "" : " (optional)"}</label>
                      <select id={`${name}-${p.projectId}`} name={name} required={required} defaultValue={p.mapping?.proposal[name] ?? ""}>
                        {!required && <option value="">None</option>}
                        {required && !p.mapping?.proposal[name] && <option value="" disabled>Choose an issue type…</option>}
                        {p.mapping?.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  ))}
                  <div className="row-form">
                    <button className="btn btn-primary" type="submit">Link {p.projectName} to {p.mapping.key}</button>
                    <a className="btn" href={basePath}>Cancel</a>
                  </div>
                </form>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
