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

// ---- the mapping table (slice 3 and 4) ----
import type { ChangeRowView, MappingView, NameRowView, StaticRowView } from "@/lib/tracker-fields/view";
import { APPLY, FIELD, ON, PREFIX_ALL, RESET, TEXT } from "@/lib/tracker-fields/form";
import type { Direction } from "@/lib/tracker-fields/slots";

const DIRECTION = (tracker: string): Record<Direction, string> => ({ to_tracker: `Product Velocity to ${tracker}`, two_way: "Both ways", from_tracker: `${tracker} to Product Velocity, read only`, not_synced: "Not synced", never: "Never synced" });
const MOSCOW = ["Must", "Should", "Could", "Won't"] as const;

function NameRow({ n }: { n: NameRowView }) {
  return (
    <tr>
      <th scope="row">{n.label}<br /><span className="muted">{n.help}</span></th>
      <td>
        {n.type !== "text" && <label><input type="checkbox" name={ON(n.id)} defaultChecked={n.on} aria-label={n.type === "flag" ? n.label : `Send the ${n.label.toLowerCase()}`} /> {n.type === "flag" ? "Hide it" : "Send"}</label>}
        {n.type !== "flag" && <input type="text" name={TEXT(n.id)} defaultValue={n.value} placeholder={n.default} maxLength={50} size={20} aria-label={`${n.label}; empty means ${n.default}`} />}
      </td>
      <td>{n.type !== "flag" && <span className="muted">Default: <code>{n.default}</code></span>}</td>
    </tr>
  );
}

function Setting({ r, tracker }: { r: ChangeRowView; tracker: string }) {
  const c = r.control;
  const name = `${r.label}: ${r.target}`;
  if (c.type === "toggle")
    return (
      <div className="stack">
        <label><input type="checkbox" name={ON(r.id)} defaultChecked={c.on} aria-label={`Send ${name}`} /> Send</label>
        {c.text && <label>Label text <input type="text" name={TEXT(r.id)} defaultValue={c.text.value} placeholder={c.text.default} maxLength={30} size={16} aria-label={`Label text for ${r.label}, ends in a slash; empty means ${c.text.default}`} /><code>&lt;value&gt;</code></label>}
      </div>
    );
  if (c.type === "select")
    return (
      <select name={FIELD(r.id)} defaultValue={c.value} aria-label={name}>
        <option value="">{c.blank}</option>
        {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  if (c.type === "priority")
    return (
      <div className="stack">
        {MOSCOW.map((m) => (
          <label key={m}>{m}{" "}
            <select name={`priority_${m}`} defaultValue={c.values[m] ?? ""} aria-label={`${tracker} priority for MoSCoW “${m}”`}>
              <option value="">Not mapped (not sent)</option>
              {c.options.map((o) => <option key={o.id} value={o.id}>{o.name}{c.proposal[m] === o.id ? " (suggested)" : ""}</option>)}
            </select>
          </label>
        ))}
      </div>
    );
  if (c.type === "board") return <span className="muted">{c.note} Change it under Project boards above.</span>;
  return <span className="muted">{c.reason}</span>;
}

/**
 * The default list of Product Velocity fields and where each goes, with the person's own setting, for ONE project (decision
 * 2026-11-03-tracker-field-config). The same form on GitHub and Jira. Rows that can change come first; everything else (fixed, read-only, not synced,
 * never synced) follows in a folded list with the reason. A form post is the whole interface: no script is needed to save or reset.
 */
export function FieldMappingForm({ tracker, projectId, projectName, view, action }: { tracker: "GitHub" | "Jira"; projectId: string; projectName: string; view: MappingView; action: (formData: FormData) => void | Promise<void> }) {
  const dir = DIRECTION(tracker);
  const rest = (rows: StaticRowView[]) => rows;
  return (
    <div className="stack" role="group" aria-labelledby={`map-${projectId}`}>
      <h3 id={`map-${projectId}`}>{projectName}</h3>
      {view.unreadable && <p role="alert" className="error">The fields of this {tracker} connection could not be read just now. You can still switch things on and off; choosing another field needs the list. Try again in a minute.</p>}
      <form action={action} className="stack" aria-label={`Field configuration of ${projectName}`}>
        <input type="hidden" name="project" value={projectId} />
        <table className="table">
          <caption className="visually-hidden">Product Velocity fields that can be changed for {projectName}</caption>
          <thead><tr><th scope="col">Product Velocity field</th><th scope="col">Direction</th><th scope="col">Goes to by default</th><th scope="col">Your setting</th><th scope="col"><span className="visually-hidden">Reset</span></th></tr></thead>
          <tbody>
            {view.changeable.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                <td>{dir[r.direction]}</td>
                <td>{r.target}</td>
                <td><Setting r={r} tracker={tracker} /></td>
                <td>{!r.isDefault && r.control.type !== "board" && <button className="btn" type="submit" name={RESET} value={r.id} aria-label={`Reset ${r.label} (${r.target}) to the default`}>Reset</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4 id={`names-${projectId}`}>Names in {tracker} (stealth mode)</h4>
        <p className="muted">Everything Product Velocity writes to {tracker} is named here. The defaults start with <code>pv:</code> and mention Product Velocity. Change them so nothing does. Labels already sent under another name are taken off the issue at the next Sync.</p>
        <div className="row-form">
          <label>Prefix for all labels <input type="text" name={PREFIX_ALL} placeholder="e.g. acme: (empty = no prefix)" maxLength={20} size={22} aria-label="Prefix for all labels; empty means no prefix" /></label>
          <button className="btn" type="submit" name={APPLY} value="prefix" aria-label={`Apply the prefix to every label of ${projectName} and save`}>Apply to all labels and save</button>
        </div>
        <table className="table" aria-labelledby={`names-${projectId}`}>
          <thead><tr><th scope="col">Name</th><th scope="col">Your setting</th><th scope="col">Default</th></tr></thead>
          <tbody>{view.names.map((n) => <NameRow key={n.id} n={n} />)}</tbody>
        </table>
        <div className="row-form">
          <button className="btn btn-primary" type="submit" aria-label={`Save field configuration of ${projectName}`}>Save field configuration</button>
          <button className="btn" type="submit" name={RESET} value="all" aria-label={`Reset all to default for ${projectName}`}>Reset all to default</button>
        </div>
      </form>
      <details className="stack">
        <summary>Other fields ({view.fixed.length}): fixed, read only, not synced, never synced</summary>
        <p className="muted">
          {view.counts.never} never synced (commercial: value, confidence, customers, decisions, key results, outcomes), {view.counts.from_tracker} read from {tracker} and read-only in the app, {view.counts.not_synced} not synced. These can not be changed. Initiative Status is never set from {tracker}.
        </p>
        <table className="table">
          <caption className="visually-hidden">Product Velocity fields that can not be changed for {projectName}</caption>
          <thead><tr><th scope="col">Product Velocity field</th><th scope="col">Direction</th><th scope="col">{tracker} field</th><th scope="col">Why it can not change</th></tr></thead>
          <tbody>
            {rest(view.fixed).map((r, n) => (
              <tr key={`${r.key}-${n}`}>
                <th scope="row">{r.label}</th>
                <td>{dir[r.direction]}</td>
                <td>{r.target}</td>
                <td className="muted">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
