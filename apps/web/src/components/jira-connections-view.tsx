import Link from "next/link";
import { AutoRefresh } from "@/app/(workspace)/settings/integrations/github/auto-refresh";
import { RefreshButton } from "@/app/(workspace)/settings/integrations/github/refresh-button";
import { JiraProjectRow, type JiraProjectChoice, type JiraRowLink } from "@/components/jira-project-row";
import { sourceLabel } from "@/lib/atlassian/jira-events";
import type { JiraConnectionRow } from "@/lib/atlassian/server";

export type JiraProjectInfo = { key: string; name: string; type: string; style: string | null };
export type JiraSiteProjects = { siteId: string; projects: JiraProjectInfo[] | null; error?: string };
export type JiraConnectionView = Pick<JiraConnectionRow, "id" | "state" | "sites" | "created_at" | "state_changed_at"> & { projects: JiraSiteProjects[]; scopes?: string };
export type JiraEventView = { id: string; at: string; source: "webhook" | "check" | "manual"; issue: string | null; summary: string; state: "processed" | "error"; error: string | null; attempts: number };
export type JiraSyncView = { linked: number; lastCheck: { at: string; summary: string } | null; events: JiraEventView[]; live: { enabled: boolean; registered: number; total: number; needsScope: boolean } };

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
  pulled: "Pulled in. The initiatives are in the roadmap and follow their Jira issues.",
  "pulled-some": "Some issues were pulled in; the others were skipped (already pulled in, or from another project).",
  "pull-failed": "Nothing was pulled in. The issues may already be initiatives.",
  ignored: "Ignored. They stay out of the roadmap; show ignored issues to bring them back.",
  restored: "Brought back to the list.",
  "review-none": "Select at least one issue first.",
  "review-denied": "Only creators and admins can decide what comes in from Jira.",
  checked: "Checked Jira. The result is under the button.",
  retried: "Run again: it worked.",
  "retry-failed": "It still failed. The reason is in the table below.",
  "link-unavailable": "That Jira connection or site is not available. Reload the page and try again.",
  "link-type": "Only software and business Jira projects can be linked for now. Product Discovery ideas come later.",
  "field-map-saved": "Field mapping saved. Nothing was written to Jira; the next Sync uses it.",
  "link-types": "Choose three different issue types of that Jira project; the initiative type is required.",
  "link-tracker": "That project already uses another tracker. Remove its links there first.",
  "link-taken": "That Jira project is already linked to another project of this workspace.",
};

const STATE: Record<JiraConnectionRow["state"], string> = { connected: "Connected", reconnect_needed: "Sign in again needed", disconnected: "Not connected" };
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export type JiraIssueView = { id: string; key: string; title: string; type: string | null; status: string | null; category: string | null; url: string | null };

export type JiraProjectOption = { value: string; label: string; group: string };
export type JiraProjectLinkView = {
  projectId: string;
  projectName: string;
  link: { jiraKey: string; jiraName: string; siteName: string; initiative: string; epic: string | null; task: string | null } | null;
  /** The last read of the linked Jira project (slice C1) and how many issues are in each state. */
  read?: { readAt: string; total: number; added: number; changed: number; truncated: boolean; error: string | null } | null;
  counts?: { not_pulled: number; pulled: number; ignored: number };
  /** Issues waiting for a decision (or the ignored ones when `showIgnored`), at most 100. */
  issues?: JiraIssueView[];
  showIgnored?: boolean;
  /** The tracker of the project (a project has one) and its current Jira link in the form of the Projects table row. */
  tracker: string | null;
  rowLink: JiraRowLink | null;
  /** The field mapping of this project (admins): what is mapped now and what the Jira site offers. */
  fieldMap?: null | { current: { startDate?: string; theme?: string; priorityByMoscow?: Partial<Record<"Must" | "Should" | "Could" | "Won't", string>> }; startDates: { id: string; name: string }[]; themes: { id: string; name: string }[]; priorities: { id: string; name: string }[]; proposal: Partial<Record<"Must" | "Should" | "Could" | "Won't", string>>; unreadable: boolean };
};

type Props = {
  connections: JiraConnectionView[];
  canAdmin: boolean;
  configured: boolean;
  status?: string | undefined;
  /** "Check Jira now" numbers carried in the address (checked, changed, not found). */
  checked?: { c: string; ch: string; m: string } | undefined;
  connectAction: () => void | Promise<void>;
  disconnectAction: (formData: FormData) => void | Promise<void>;
  projectLinks?: JiraProjectLinkView[];
  choices?: JiraProjectChoice[];
  sync?: JiraSyncView | null;
  basePath?: string;
  saveProjectAction?: (formData: FormData) => void | Promise<void>;
  readAction?: (formData: FormData) => void | Promise<void>;
  checkAction?: () => void | Promise<void>;
  retryAction?: (id: string) => void | Promise<void>;
  /** Creators and admins decide what comes in. */
  canEdit?: boolean;
  reviewAction?: (formData: FormData) => void | Promise<void>;
  fieldMapAction?: (formData: FormData) => void | Promise<void>;
};

/**
 * Settings → Integrations → Jira, laid out like the GitHub page (decision 2026-11-03-tracker-parity): Status, Sync (what happens by itself, check
 * now, recent events), the Jira projects, Projects (one table, one Save), then the Jira-only extras. Presentational: the page supplies data and actions.
 */
export function JiraConnectionsView({ connections, canAdmin, configured, status, checked, connectAction, disconnectAction, projectLinks = [], choices = [], sync = null, basePath = "/settings/integrations/jira", saveProjectAction, readAction, checkAction, retryAction, canEdit = false, reviewAction, fieldMapAction }: Props) {
  const needsSignIn = connections.some((c) => c.state === "reconnect_needed");
  const connected = connections.filter((c) => c.state === "connected");
  const missingHookScope = Boolean(sync?.live.enabled) && connected.some((c) => c.scopes !== undefined && !c.scopes.split(" ").includes("manage:jira-webhook"));
  const linked = projectLinks.filter((p) => p.link);
  return (
    <div className="page-narrow">
      <h1>Jira</h1>
      <p className="muted">Connect this workspace to Jira Cloud. Product Velocity never copies commercial fields (value, confidence, customers, decisions) to Jira.</p>
      {status && JIRA_NOTICE[status] && <p role="status" className="notice">{JIRA_NOTICE[status]}</p>}
      {status === "checked" && checked && <p role="status" className="notice">Checked {checked.c} linked item(s) against Jira: {checked.ch} changed, {checked.m} issue(s) not found.</p>}
      {needsSignIn && <p role="alert" className="notice">Atlassian no longer accepts the saved sign-in for at least one site. Sign in again to keep it working.</p>}
      {missingHookScope && <p role="alert" className="notice">Live updates need one more permission. Sign in to Jira again to allow it; until then the daily check and Check Jira now keep initiatives current.</p>}
      {!configured && <p role="alert" className="notice">Jira is not set up for this deployment: the platform owner has to set the Atlassian app variables.</p>}

      <div className="card stack">
        <h2>Status</h2>
        {connections.length === 0 && <p><strong>Not connected</strong></p>}
        {connections.map((c) => (
          <section key={c.id} className="stack" aria-labelledby={`jira-${c.id}`}>
            <p id={`jira-${c.id}`}>
              <strong>{STATE[c.state]}</strong> · {c.sites.map((s) => s.name).join(", ") || "Jira"} · since {date(c.created_at)}
              {c.state === "reconnect_needed" ? <> · stopped {date(c.state_changed_at)}</> : null}
            </p>
            {canAdmin && c.state !== "disconnected" && (
              <div className="row-form">
                {c.state === "connected" && <Link className="btn" href={`${basePath}/test`}>Test connection</Link>}
                <form action={connectAction}><button className="btn" type="submit" disabled={!configured}>Sign in to Jira again</button></form>
                <form action={disconnectAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn" type="submit">Disconnect</button>
                </form>
              </div>
            )}
          </section>
        ))}
        {canAdmin ? (
          <form action={connectAction} className="stack">
            <p className="muted">
              You will be sent to Atlassian to approve Product Velocity for the Jira site you choose. It asks to read and write Jira work and to read users, and to stay signed in. It never asks to change a site&rsquo;s settings.
            </p>
            {connections.length === 0 && <div><button className="btn btn-primary" type="submit" disabled={!configured}>Connect Jira</button></div>}
            {connections.length > 0 && <div><button className="btn" type="submit" disabled={!configured}>Connect another Jira site</button></div>}
          </form>
        ) : (
          <p className="muted">An admin can connect Jira.</p>
        )}
      </div>

      {connected.length > 0 && sync && (
        <div className="card stack">
          <h2>Sync</h2>
          <p className="muted">
            {sync.linked} initiative(s) are linked to a Jira issue. When one of those issues changes status, {sync.live.enabled && sync.live.registered > 0 ? "Jira tells the app and" : "the app reads it (live updates are not switched on) and"} the initiative&rsquo;s Build Status follows (Not started, In progress, Done, from the Jira status category).
            A daily check repairs anything missed.
          </p>
          <p className="muted" role="status">
            Live updates: {!sync.live.enabled ? "not switched on" : sync.live.total === 0 ? "nothing registered yet (the daily check registers them)" : `${sync.live.registered} of ${sync.live.total} linked project(s) registered${sync.live.needsScope ? "; sign in to Jira again to allow them" : ""}`}.
          </p>
          {canAdmin && (
            <div className="row-form">
              <RefreshButton label="Refresh the list" />
              {checkAction && <form action={checkAction}><button className="btn" type="submit">Check Jira now</button></form>}
            </div>
          )}
          {sync.lastCheck && <p className="muted" role="status">Last check {new Date(sync.lastCheck.at).toLocaleString("en-GB")}: {sync.lastCheck.summary}</p>}
          {canAdmin && status === "checked" && <AutoRefresh everyMs={3000} maxTries={3} />}
          {canAdmin && (
            <table className="table">
              <caption className="visually-hidden">Latest changes from Jira</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Issue</th><th scope="col">What happened</th><th scope="col">Result</th><th scope="col"><span className="visually-hidden">Retry</span></th></tr></thead>
              <tbody>
                {sync.events.length === 0 && <tr><td colSpan={5} className="muted">Nothing yet. Change the status of a linked issue in Jira, or press &ldquo;Check Jira now&rdquo;.</td></tr>}
                {sync.events.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.at).toLocaleString()}</td>
                    <td>{e.issue ?? "-"}</td>
                    <td>{sourceLabel(e)}: {e.summary}</td>
                    <td>{e.state === "error" ? `Failed: ${e.error ?? "unknown"} (${e.attempts} tr${e.attempts === 1 ? "y" : "ies"})` : "Applied"}</td>
                    <td>{e.state === "error" && e.issue && retryAction && <form action={retryAction.bind(null, e.id)}><button className="btn" type="submit">Run again</button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {canAdmin && connected.some((c) => c.projects.length > 0) && (
        <div className="card stack">
          <h2>Jira projects</h2>
          <p className="muted">The projects this sign-in can see. Only software and business projects can be linked for now; Product Discovery ideas come later.</p>
          {connected.flatMap((c) => c.projects.map((p) => {
            const site = c.sites.find((x) => x.id === p.siteId);
            return p.projects ? (
              <table className="table" key={`${c.id}-${p.siteId}`}>
                <caption className="visually-hidden">Jira projects of {site?.name ?? "this site"}</caption>
                <thead><tr><th scope="col">Key</th><th scope="col">Project</th><th scope="col">Type</th></tr></thead>
                <tbody>
                  {p.projects.length === 0 && <tr><td colSpan={3} className="muted">No projects visible to this sign-in.</td></tr>}
                  {p.projects.map((j) => (
                    <tr key={j.key}><td>{j.key}</td><td>{j.name}</td><td>{j.type === "product_discovery" ? "Product Discovery" : j.type === "software" ? "Software" : j.type === "business" ? "Business" : j.type}{j.style === "next-gen" ? " (team-managed)" : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted" key={`${c.id}-${p.siteId}`}>Projects could not be read: {p.error ?? "unknown reason"}.</p>;
          }))}
        </div>
      )}

      {connected.length > 0 && projectLinks.length > 0 && (
        <div className="card stack">
          <h2>Projects</h2>
          <p className="muted">
            A project has exactly one delivery tracker, and every initiative in it syncs with that tracker only. Pick it here, then the Jira project and which of that Jira project&rsquo;s own issue types are an initiative, an epic and a task
            (Jira projects differ, so each choice offers that project&rsquo;s types). Reading Jira fills a list of open issues; nothing is created in the roadmap and nothing is written to Jira by linking.
          </p>
          {choices.length === 0 && <p className="muted">No software or business Jira project is visible to the connection.</p>}
          {saveProjectAction && (
            <table className="table">
              <caption className="visually-hidden">Delivery tracker per project</caption>
              <thead><tr><th scope="col">Project</th><th scope="col">Delivery tracker</th><th scope="col">Jira project</th><th scope="col">Initiative is</th><th scope="col">Epic is</th><th scope="col">Task is, and Save</th></tr></thead>
              <tbody>
                {projectLinks.map((p) => <JiraProjectRow key={p.projectId} project={{ id: p.projectId, name: p.projectName }} tracker={p.tracker} link={p.rowLink} choices={choices} canEdit={canAdmin} action={saveProjectAction} />)}
              </tbody>
            </table>
          )}
        </div>
      )}

      {connected.length > 0 && linked.length > 0 && (
        <div className="card stack">
          <h2>Jira issues and field mapping</h2>
          <p className="muted">Reading Jira fills a list of open issues; nothing is in the roadmap until it is pulled in. The field mapping tells Sync which Jira fields to fill; saving writes nothing to Jira.</p>
          {linked.map((p) => (
            <section key={p.projectId} className="stack" aria-labelledby={`pl-${p.projectId}`}>
              <h3 id={`pl-${p.projectId}`}>{p.projectName}</h3>
              <p>Linked to <strong>{p.link!.jiraKey}</strong> · {p.link!.jiraName} ({p.link!.siteName}). Initiative is <strong>{p.link!.initiative}</strong>{p.link!.epic ? <>, epic is <strong>{p.link!.epic}</strong></> : null}{p.link!.task ? <>, task is <strong>{p.link!.task}</strong></> : null}.</p>
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
              {p.link && p.issues && p.issues.length > 0 && (
                <form action={reviewAction} className="stack" aria-label={`${p.showIgnored ? "Ignored" : "New"} Jira issues of ${p.projectName}`}>
                  <input type="hidden" name="project" value={p.projectId} />
                  <table className="table">
                    <caption className="visually-hidden">{p.showIgnored ? "Ignored" : "Not pulled in"} Jira issues of {p.projectName}</caption>
                    <thead><tr>{canEdit && <th scope="col"><span className="visually-hidden">Select</span></th>}<th scope="col">Issue</th><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                      {p.issues.map((i) => (
                        <tr key={i.id}>
                          {canEdit && <td><input type="checkbox" name="ids" value={i.id} aria-label={`Select ${i.key}`} /></td>}
                          <td>{i.url ? <a href={i.url} target="_blank" rel="noreferrer">{i.key}</a> : i.key}</td>
                          <td>{i.title}</td>
                          <td>{i.type ?? "-"}</td>
                          <td>{i.status ?? "-"}{i.category ? ` (${i.category === "new" ? "to do" : i.category === "indeterminate" ? "in progress" : "done"})` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {canEdit && reviewAction && (
                    <div className="row-form">
                      {!p.showIgnored && (
                        <>
                          <div className="field">
                            <label htmlFor={`mode-${p.projectId}`}>Who owns what comes in</label>
                            <select id={`mode-${p.projectId}`} name="mode" defaultValue="follow">
                              <option value="follow">Read only (follows the Jira issue)</option>
                              <option value="push">Product Velocity takes ownership</option>
                            </select>
                          </div>
                          <button className="btn btn-primary" type="submit" name="intent" value="pull">Pull in selected</button>
                          <button className="btn" type="submit" name="intent" value="ignore">Ignore selected</button>
                        </>
                      )}
                      {p.showIgnored && <button className="btn" type="submit" name="intent" value="restore">Bring back selected</button>}
                    </div>
                  )}
                </form>
              )}
              {p.link && p.counts && (
                <p>
                  {p.showIgnored ? <a href={basePath}>Back to the new issues</a> : p.counts.ignored > 0 ? <a href={`${basePath}?ignored=${p.projectId}`}>Show {p.counts.ignored} ignored</a> : null}
                </p>
              )}
              {canAdmin && p.link && p.fieldMap && fieldMapAction && (
                <details className="stack">
                  <summary>Field mapping</summary>
                  <form action={fieldMapAction} className="stack" aria-label={`Field mapping of ${p.projectName}`}>
                    <input type="hidden" name="project" value={p.projectId} />
                    <p className="muted">Sync can fill these Jira fields. Names, ids and priorities differ per Jira site, so you choose; an empty choice means Sync leaves that field out and says so in the preview. Nothing is written to Jira by saving.</p>
                    {p.fieldMap.unreadable && <p role="alert" className="error">The fields of this Jira site could not be read just now. Try again in a minute.</p>}
                    <div className="field">
                      <label htmlFor={`sd-${p.projectId}`}>Start date field (filled from Planned Start)</label>
                      <select id={`sd-${p.projectId}`} name="startDate" defaultValue={p.fieldMap.current.startDate ?? ""}>
                        <option value="">Not mapped</option>
                        {p.fieldMap.startDates.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`th-${p.projectId}`}>Theme field (filled with the Initiative Group name)</label>
                      <select id={`th-${p.projectId}`} name="theme" defaultValue={p.fieldMap.current.theme ?? ""}>
                        <option value="">Not mapped</option>
                        {p.fieldMap.themes.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <p className="muted">Single-line text fields only. The group is always sent as the label pv:group/&lt;name; this also writes its name into the field.</p>
                    </div>
                    {(["Must", "Should", "Could", "Won't"] as const).map((m) => (
                      <div className="field" key={m}>
                        <label htmlFor={`pr-${p.projectId}-${m}`}>Jira priority for MoSCoW “{m}”</label>
                        <select id={`pr-${p.projectId}-${m}`} name={`priority_${m}`} defaultValue={p.fieldMap!.current.priorityByMoscow?.[m] ?? ""}>
                          <option value="">Not mapped</option>
                          {p.fieldMap!.priorities.map((f) => <option key={f.id} value={f.id}>{f.name}{p.fieldMap!.proposal[m] === f.id ? " (suggested)" : ""}</option>)}
                        </select>
                      </div>
                    ))}
                    <div className="row-form"><button className="btn" type="submit" aria-label={`Save the field mapping of ${p.projectName}`}>Save field mapping</button></div>
                  </form>
                </details>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
