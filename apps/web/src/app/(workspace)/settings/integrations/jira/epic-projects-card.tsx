import { saveEpicProjects } from "./epic-projects";

export type EpicProjectSite = { connectionId: string; siteId: string; siteName: string; projects: { key: string; name: string }[]; ticked: string[]; suggested: string[] };

/**
 * "Projects to check for epics" (issue #464): the Jira projects whose open epics the Epics list on Incoming reads, to show which are linked to initiatives
 * and which are not. Reading is read only. Until someone saves, the linked project and the projects that already have epics under our Initiatives are
 * pre-ticked as a suggestion; nothing is read until the choice is saved.
 */
export function EpicProjectsCard({ sites, status, saved }: { sites: EpicProjectSite[]; status?: string; saved: boolean }) {
  if (sites.length === 0) return null;
  return (
    <section className="card" aria-labelledby="epic-projects-h">
      <h2 id="epic-projects-h">Projects to check for epics</h2>
      <p className="muted">Tick the Jira projects whose open epics Product Velocity should list under Incoming, Jira, Epics, so you can see which epics are linked to initiatives and which are not. Only these projects are read, and nothing is written to Jira.</p>
      {status === "epics-saved" && <p role="status">Saved. Open Incoming, Jira, Epics and choose Read epics now.</p>}
      {(status === "epics-error" || status === "not-admin") && <p role="alert">{status === "not-admin" ? "Only a workspace admin can choose these projects." : "The projects could not be saved. Try again."}</p>}
      {sites.map((s) => (
        <form key={`${s.connectionId}|${s.siteId}`} action={saveEpicProjects} className="epic-projects">
          <input type="hidden" name="connection" value={s.connectionId} />
          <input type="hidden" name="site" value={s.siteId} />
          <h3>{s.siteName}</h3>
          {!saved && s.ticked.length === 0 && s.suggested.length > 0 && <p className="muted">Suggested: {s.suggested.join(", ")} (the linked project and projects that already have epics under your Initiatives).</p>}
          <ul className="epic-projects-list">
            {s.projects.map((p) => (
              <li key={p.key}>
                <label><input type="checkbox" name="key" value={p.key} defaultChecked={s.ticked.length > 0 ? s.ticked.includes(p.key) : s.suggested.includes(p.key)} /> {p.key} · {p.name}</label>
              </li>
            ))}
          </ul>
          <button className="btn" type="submit">Save projects</button>
        </form>
      ))}
    </section>
  );
}
