import { saveEpicRepos } from "./actions";

/**
 * "Repositories to check for epics" (issue #465, the GitHub twin of Jira's "Projects to check for epics"): the repositories whose open parent issues
 * (issues with sub-issues, the epics) the Epics list on Incoming reads, to show which are linked to initiatives and which are not. Reading is read only.
 * Until someone saves, the default repositories of the GitHub projects and the repositories that already hold epics under our initiatives are
 * pre-ticked as a suggestion; nothing is read until the choice is saved.
 */
export function EpicReposCard({ repos, ticked, suggested }: { repos: string[]; ticked: string[]; suggested: string[] }) {
  const saved = ticked.length > 0;
  return (
    <form action={saveEpicRepos} className="card stack epic-projects" aria-labelledby="epic-repos-h">
      <h2 id="epic-repos-h">Repositories to check for epics</h2>
      <p className="muted">Tick the repositories whose open parent issues (issues with sub-issues) Product Velocity should list under Incoming, GitHub, Epics, so you can see which epics are linked to initiatives and which are not. Only these repositories are read, and nothing is written to GitHub.</p>
      {!saved && suggested.length > 0 && <p className="muted">Suggested: {suggested.join(", ")} (the default repositories of your projects and repositories that already have epics under your initiatives).</p>}
      <ul className="epic-projects-list">
        {repos.map((r) => (
          <li key={r}>
            <label><input type="checkbox" name="repo" value={r} defaultChecked={saved ? ticked.includes(r) : suggested.includes(r)} /> {r}</label>
          </li>
        ))}
      </ul>
      <div><button className="btn" type="submit">Save repositories</button></div>
    </form>
  );
}
