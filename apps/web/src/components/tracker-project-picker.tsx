// Which project the Field mapping section shows (one at a time). A plain GET form: it works without script and the address says which project is open.
export function TrackerProjectPicker({ projects, current, action }: { projects: { id: string; name: string }[]; current: string; action: string }) {
  if (projects.length <= 1) return <p>Project: <strong>{projects[0]?.name ?? "-"}</strong></p>;
  return (
    <form method="get" action={action} className="row-form" aria-label="Choose a project">
      <div className="field">
        <label htmlFor="mapping-project">Project</label>
        <select id="mapping-project" name="project" defaultValue={current}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <button className="btn" type="submit">Show</button>
    </form>
  );
}
