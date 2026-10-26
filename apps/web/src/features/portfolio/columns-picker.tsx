"use client";

import { useId, useRef, useState } from "react";
import { FIELDS, arrivesLabel, fieldOptions, filterOptions, isCustomerSafe, needsSearch } from "@pv/domain";
import { NoResults, SearchInput } from "@/components/search-list";
import { CORE_COLUMNS } from "./columns";
import { useDismiss } from "./use-dismiss";

const ALL_FIELDS = fieldOptions(FIELDS);

/** Show or hide single columns. Reordering, pinning and saved views come with the saved-views issue. */
export function ColumnsPicker({ visible, onToggle, customerSafe = false }: { visible: ReadonlySet<string>; onToggle: (key: string) => void; customerSafe?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const matching = new Set(filterOptions(ALL_FIELDS, query).map((o) => o.value));
  const groups = [...new Set(FIELDS.filter((f) => matching.has(f.key)).map((f) => f.group))];
  const shown = FIELDS.filter((f) => visible.has(f.key) || (CORE_COLUMNS as readonly string[]).includes(f.key)).length;

  return (
    <span className="columns-anchor" ref={ref}>
      <button type="button" className="tool-btn" aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen((o) => !o); setQuery(""); }}>
        Columns ({shown} of {FIELDS.length})
      </button>
      {open && (
        <div id={panelId} className="columns-panel" role="group" aria-label="Choose columns" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          {needsSearch(FIELDS.length) && (
            <div className="columns-search">
              <SearchInput value={query} onChange={setQuery} label="Search columns" placeholder={`Search the ${FIELDS.length} fields…`} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
            </div>
          )}
          {groups.length === 0 && <NoResults query={query} />}
          {groups.map((g) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              {FIELDS.filter((f) => f.group === g && matching.has(f.key)).map((f) => {
                const core = (CORE_COLUMNS as readonly string[]).includes(f.key);
                const blocked = customerSafe && !isCustomerSafe(f.key) && !core;
                return (
                  <label key={f.key} className="columns-item">
                    <input type="checkbox" checked={core || (!blocked && visible.has(f.key))} disabled={core || blocked} onChange={() => onToggle(f.key)} />
                    {f.name}
                    {arrivesLabel(f) && <span className="columns-later"> · {arrivesLabel(f)!.toLowerCase()}</span>}
                    {blocked && <span className="columns-later"> · not customer-safe</span>}
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
