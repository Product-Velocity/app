"use client";

import { useId, useState } from "react";
import { DEFAULT_VIEWS, FIELDS, VIEW_NAMES, arrivesLabel, type ViewName } from "@pv/domain";
import { CORE_COLUMNS } from "./columns";

export type ViewChoice = ViewName | "All columns";

/** The default views of the field dictionary as chips (the saved views of issue #9 will join them). */
export function ViewChips({ view, onView }: { view: ViewChoice; onView: (v: ViewChoice) => void }) {
  const choices: ViewChoice[] = [...VIEW_NAMES, "All columns"];
  return (
    <div className="view-chips" role="group" aria-label="View">
      {choices.map((v) => (
        <button
          key={v}
          type="button"
          className={v === view ? "view-chip view-chip-on" : "view-chip"}
          aria-pressed={v === view}
          title={v === "All columns" ? `All ${FIELDS.length} fields` : `${DEFAULT_VIEWS[v].length} columns`}
          onClick={() => onView(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/** Show or hide single columns. Reordering, pinning and saved views come with the saved-views issue. */
export function ColumnsPicker({ visible, onToggle }: { visible: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const shown = FIELDS.filter((f) => visible.has(f.key) || (CORE_COLUMNS as readonly string[]).includes(f.key)).length;

  return (
    <span className="columns-anchor">
      <button type="button" className="tool-btn" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        Columns ({shown} of {FIELDS.length})
      </button>
      {open && (
        <div id={panelId} className="columns-panel" role="group" aria-label="Choose columns" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
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
    </span>
  );
}
