"use client";

import { useId, useState } from "react";
import { FIELDS, arrivesLabel } from "@pv/domain";
import { CORE_COLUMNS } from "./columns";

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
