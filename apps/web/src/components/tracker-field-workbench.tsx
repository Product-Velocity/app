"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { ChangeRowView, MappingView, NameRowView } from "@/lib/tracker-fields/view";
import { APPLY, FIELD, ON, PREFIX_ALL, RESET, TEXT } from "@/lib/tracker-fields/form";
import type { Direction } from "@/lib/tracker-fields/slots";
import { DEFAULT_FILTER, WB_FILTERS, changeFlags, filterCounts, flagMatches, staticFlags, textMatches, type UnlinkedField, type WbFilter } from "@/lib/tracker-fields/workbench";

// Settings, Integrations, <tracker>, Field mapping (decision 2026-11-16-tracker-settings-sections): ONE table for one project. Every Product Velocity field and
// where it goes, with its setting editable in the row, and (under the filter "fields not linked") the tracker's own fields that nothing uses. It opens on
// "Synced", the short list of what Sync really moves. Replaces the separate field list and the separate editor (2026-11-11-tracker-field-table).
// A form post is still the whole interface for saving: every editable row stays in the page whatever the filter says, so Save sends them all.

const DIRECTION = (tracker: string): Record<Direction, string> => ({ to_tracker: `Product Velocity to ${tracker}`, two_way: "Both ways", from_tracker: `${tracker} to Product Velocity, read only`, not_synced: "Not synced", never: "Never synced" });
const MOSCOW = ["Must", "Should", "Could", "Won't"] as const;
const PAGE = 50;

const LABEL = (tracker: string): Record<WbFilter, string> => ({
  synced: "Synced", changeable: "Can change", readonly: "Read only", notsynced: "Not synced", never: "Never synced", unlinked: `${tracker} fields not linked`, all: "All",
});

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
  if (c.type === "board") return <span className="muted">{c.note} Change it under Project boards on the Projects section.</span>;
  return <span className="muted">{c.reason}</span>;
}

export function FieldWorkbench({ tracker, projectId, projectName, view, action, unlinked, unlinkedError, unlinkedNotes = [] }: {
  tracker: "GitHub" | "Jira";
  projectId: string;
  projectName: string;
  view: MappingView;
  action: (formData: FormData) => void | Promise<void>;
  /** The tracker's own fields that no Product Velocity field uses (the catalog of the project's connection). */
  unlinked: UnlinkedField[];
  /** Set when the tracker's fields could not be read just now. */
  unlinkedError?: string | null;
  /** What a part with nothing to list says, for example a missing App permission. */
  unlinkedNotes?: string[];
}) {
  const uid = useId();
  const dir = DIRECTION(tracker);
  const [filter, setFilter] = useState<WbFilter>(DEFAULT_FILTER);
  const [text, setText] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const changeFlagsOf = useMemo(() => view.changeable.map(changeFlags), [view.changeable]);
  const fixedFlagsOf = useMemo(() => view.fixed.map(staticFlags), [view.fixed]);
  const counts = useMemo(() => filterCounts([...changeFlagsOf, ...fixedFlagsOf], unlinked.length), [changeFlagsOf, fixedFlagsOf, unlinked.length]);

  const changeShown = view.changeable.map((r, i) => flagMatches(changeFlagsOf[i]!, filter) && textMatches(`${r.label} ${r.target} ${r.key}`, text));
  const fixedRows = view.fixed.filter((r, i) => flagMatches(fixedFlagsOf[i]!, filter) && textMatches(`${r.label} ${r.target} ${r.reason} ${r.key}`, text));
  const showUnlinked = filter === "unlinked" || filter === "all";
  const unlinkedRows = showUnlinked ? unlinked.filter((u) => textMatches(`${u.name} ${u.id} ${u.typeLabel} ${u.source ?? ""} ${u.options.join(" ")}`, text)) : [];
  const total = changeShown.filter(Boolean).length + fixedRows.length + unlinkedRows.length;
  const pick = (f: WbFilter) => { setFilter(f); setShown(PAGE); };
  const fixedVisible = fixedRows.slice(0, shown);
  const unlinkedVisible = unlinkedRows.slice(0, Math.max(0, shown - fixedVisible.length));
  const more = fixedRows.length + unlinkedRows.length > shown;

  return (
    <div className="stack" role="group" aria-label={`Field mapping of ${projectName}`}>
      {view.unreadable && <p role="alert" className="error">The fields of this {tracker} connection could not be read just now. You can still switch things on and off; choosing another field needs the list. Try again in a minute.</p>}
      <div className="table-tools" role="search" aria-label="Search and filter the fields">
        <div className="field">
          <label htmlFor={`${uid}-q`}>Search</label>
          <input id={`${uid}-q`} type="search" value={text} placeholder={`Product Velocity or ${tracker} field, id, option`} onChange={(e) => { setText(e.target.value); setShown(PAGE); }} />
        </div>
        <div className="filter-chips" role="group" aria-label="Show">
          {WB_FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? "chip chip-on" : "chip"} aria-pressed={filter === f} onClick={() => pick(f)}>
              {LABEL(tracker)[f]} <span className="muted">({counts[f]})</span>
            </button>
          ))}
        </div>
      </div>
      {unlinkedError && showUnlinked && <p role="alert" className="error">{unlinkedError}</p>}
      {showUnlinked && unlinkedNotes.map((n) => <p key={n} className="muted">{n}</p>)}
      <p className="muted" role="status" aria-live="polite">
        {filter === "synced" ? "The fields Sync moves between Product Velocity and " + tracker + ". " : ""}Showing {Math.min(total, changeShown.filter(Boolean).length + fixedVisible.length + unlinkedVisible.length)} of {total}.
      </p>
      <form action={action} className="stack" aria-label={`Field configuration of ${projectName}`} onChange={() => setDirty(true)}>
        <input type="hidden" name="project" value={projectId} />
        <div className="table-wrap">
          <table className="table mapping-table">
            <caption className="visually-hidden">Product Velocity fields of {projectName}, where each goes in {tracker} and its setting</caption>
            <thead><tr><th scope="col">Product Velocity field</th><th scope="col">Direction</th><th scope="col">{tracker} field</th><th scope="col">Your setting</th><th scope="col"><span className="visually-hidden">Reset</span></th></tr></thead>
            <tbody>
              {view.changeable.map((r, i) => (
                <tr key={r.id} hidden={!changeShown[i]}>
                  <th scope="row">{r.label}</th>
                  <td>{dir[r.direction]}</td>
                  <td>{r.target}</td>
                  <td className="setting"><Setting r={r} tracker={tracker} /></td>
                  <td>{!r.isDefault && r.control.type !== "board" && <button className="btn" type="submit" name={RESET} value={r.id} aria-label={`Reset ${r.label} (${r.target}) to the default`}>Reset</button>}</td>
                </tr>
              ))}
              {fixedVisible.map((r, n) => (
                <tr key={`${r.key}-${n}`}>
                  <th scope="row">{r.label}</th>
                  <td>{dir[r.direction]}</td>
                  <td>{r.target}</td>
                  <td className="muted">{r.reason || "Fixed"}</td>
                  <td />
                </tr>
              ))}
              {unlinkedVisible.map((u) => (
                <tr key={u.key}>
                  <th scope="row" className="muted">Not linked</th>
                  <td>Not synced</td>
                  <td>{u.name} <code>{u.id}</code><br /><span className="muted">{u.typeLabel}{u.custom ? ", custom" : ""}{u.source ? `, ${u.source}` : ""}{u.options.length > 0 ? `: ${u.options.slice(0, 6).join(", ")}${u.options.length > 6 ? "…" : ""}` : ""}{u.filled !== null && u.sampled ? `; filled in ${u.filled} of ${u.sampled} sampled` : ""}</span></td>
                  <td className="muted">Ignored by Sync. To use it, pick it for a field marked “Can change”.</td>
                  <td />
                </tr>
              ))}
              {total === 0 && <tr><td colSpan={5}>No field matches. Choose “All” or clear the search.</td></tr>}
            </tbody>
          </table>
        </div>
        {more && <div><button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, fixedRows.length + unlinkedRows.length - shown)} more</button></div>}
        <details className="stack">
          <summary id={`${uid}-names`}>Names in {tracker} (stealth mode)</summary>
          <p className="muted">Everything Product Velocity writes to {tracker} is named here. The defaults start with <code>pv:</code> and mention Product Velocity. Change them so nothing does. Labels already sent under another name are taken off the issue at the next Sync.</p>
          <div className="row-form">
            <label>Prefix for all labels <input type="text" name={PREFIX_ALL} placeholder="e.g. acme: (empty = no prefix)" maxLength={20} size={22} aria-label="Prefix for all labels; empty means no prefix" /></label>
            <button className="btn" type="submit" name={APPLY} value="prefix" aria-label={`Apply to all labels and save, ${projectName}`}>Apply to all labels and save</button>
          </div>
          <table className="table" aria-labelledby={`${uid}-names`}>
            <thead><tr><th scope="col">Name</th><th scope="col">Your setting</th><th scope="col">Default</th></tr></thead>
            <tbody>{view.names.map((n) => <NameRow key={n.id} n={n} />)}</tbody>
          </table>
        </details>
        <div className={dirty ? "sticky-save sticky-save-dirty" : "sticky-save"}>
          <span role="status" aria-live="polite"><strong>{dirty ? "Unsaved changes" : "No unsaved changes"}</strong>{" "}<span className="muted">Nothing is written to {tracker}: the next Sync uses what you save.</span></span>
          <button className="btn btn-primary" type="submit" aria-label={`Save field configuration of ${projectName}`}>Save field configuration</button>
          <button className="btn" type="submit" name={RESET} value="all" aria-label={`Reset all to default for ${projectName}`}>Reset all to default</button>
        </div>
      </form>
      <p className="muted">{view.counts.never} fields are never synced (commercial: value, confidence, customers, decisions, key results, outcomes), {view.counts.from_tracker} are read from {tracker} and read-only in the app. These can not be changed. Initiative Status is never set from {tracker}.</p>
    </div>
  );
}
