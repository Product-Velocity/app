"use client";

import { useId, useState } from "react";
import { DEFAULT_VIEWS, FIELDS, VIEW_NAMES, arrivesLabel, type ViewName } from "@pv/domain";
import { CORE_COLUMNS } from "./columns";

type Props = {
  view: ViewName | "All columns";
  visible: ReadonlySet<string>;
  onView: (v: ViewName | "All columns") => void;
  onToggle: (key: string) => void;
};

/** Pick a default view and show or hide single columns. Reordering, pinning and saving views come with the saved-views issue. */
export function ColumnsPicker({ view, visible, onView, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const shown = FIELDS.filter((f) => visible.has(f.key) || (CORE_COLUMNS as readonly string[]).includes(f.key)).length;

  return (
    <div className="columns-bar">
      <label className="columns-view">
        View{" "}
        <select value={view} onChange={(e) => onView(e.target.value as ViewName | "All columns")}>
          {VIEW_NAMES.map((v) => <option key={v} value={v}>{v} ({DEFAULT_VIEWS[v].length} columns)</option>)}
          <option value="All columns">All columns ({FIELDS.length})</option>
        </select>
      </label>
      <button type="button" className="btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        Columns ({shown} of {FIELDS.length})
      </button>
      {open && (
        <div id={panelId} className="columns-panel" role="group" aria-label="Choose columns">
          {groups.map((g) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              {FIELDS.filter((f) => f.group === g).map((f) => {
                const core = (CORE_COLUMNS as readonly string[]).includes(f.key);
                return (
                  <label key={f.key} className="columns-item">
                    <input type="checkbox" checked={core || visible.has(f.key)} disabled={core} onChange={() => onToggle(f.key)} />
                    {f.name}
                    {arrivesLabel(f) && <span className="columns-later"> · {arrivesLabel(f)!.toLowerCase()}</span>}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}
