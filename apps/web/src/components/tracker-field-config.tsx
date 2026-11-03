import type { CatalogEntry, CatalogGroup, TrackerCatalog } from "@/lib/tracker-fields/catalog";

// Settings, Integrations, <tracker>, Connect and configure: "Field configuration" (decision 2026-11-03-tracker-field-config). The same card on
// GitHub and Jira. Presentational: the page supplies the data. Slice 2 = the read-only catalog; the mapping table follows in slice 3.

const fill = (e: CatalogEntry) => (e.filled === null || e.sampled === null || e.sampled === 0 ? "not sampled" : `${e.filled} of ${e.sampled}`);

function GroupTable({ g, tracker }: { g: CatalogGroup; tracker: string }) {
  return (
    <details className="stack" open={g.id === "fields" || g.id === "issue-fields"}>
      <summary>{g.title} <span className="muted">({g.entries.length})</span></summary>
      {g.error && <p role="alert" className="error">{g.error}</p>}
      {g.note && <p className="muted">{g.note}</p>}
      {g.entries.length > 0 && (
        <table className="table">
          <caption className="visually-hidden">{tracker} {g.title}</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Id</th><th scope="col">Type</th><th scope="col">Kind</th><th scope="col">Options</th><th scope="col">Filled in sample</th></tr></thead>
          <tbody>
            {g.entries.map((e) => (
              <tr key={`${e.source ?? ""}${e.id}`}>
                <td>{e.name}</td>
                <td><code>{e.id}</code></td>
                <td>{e.typeLabel}</td>
                <td>{e.custom ? "Custom" : "System"}</td>
                <td>{e.options.length > 0 ? e.options.join(", ") : <span className="muted">-</span>}</td>
                <td>{fill(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

export function FieldCatalogView({ catalogs, tracker, id }: { catalogs: TrackerCatalog[]; tracker: "GitHub" | "Jira"; id: string }) {
  if (catalogs.length === 0) return <p className="muted">Nothing to read yet: link a project first.</p>;
  return (
    <div className="stack">
      {catalogs.map((c) => (
        <section key={c.scope} className="stack" aria-labelledby={`${id}-${c.scope}`}>
          <h3 id={`${id}-${c.scope}`}>{tracker === "Jira" ? `Jira project ${c.scope}` : `GitHub organisation ${c.scope}`}</h3>
          <p className="muted">Read {new Date(c.readAt).toLocaleString("en-GB")}. Fields that are not mapped stay in this list and are ignored by the sync.</p>
          {c.groups.map((g) => <GroupTable key={g.id} g={g} tracker={tracker} />)}
        </section>
      ))}
    </div>
  );
}
