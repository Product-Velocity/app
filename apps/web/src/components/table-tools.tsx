"use client";
import { useEffect, useId, useState } from "react";
import { visibleRows } from "@/lib/tracker-fields/row-filter";

// Search, "linked only" and "show more" for a long table whose rows are rendered by the server (decision 2026-11-16-tracker-settings-sections). The rows keep their
// own forms; this only hides and shows them. A row says whether it is "linked" with data-linked="1". Without script the whole table simply shows.

const PAGE = 25;

export function TableTools({ tableId, noun, linkedLabel }: { tableId: string; noun: string; /** The label of the "linked only" box; omitted = no such box. */ linkedLabel?: string }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [matched, setMatched] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const rows = [...document.querySelectorAll<HTMLTableRowElement>(`#${CSS.escape(tableId)} tbody > tr`)];
    const { show, matched: m } = visibleRows(rows.map((r) => ({ text: r.textContent ?? "", linked: r.dataset.linked === "1" })), { text, linkedOnly, limit });
    rows.forEach((r, i) => { r.hidden = !show[i]; });
    // the rows live in the server-rendered table, so what matched can only be read from the page after it is drawn
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatched(m);
    setTotal(rows.length);
  }, [tableId, text, linkedOnly, limit]);
  if (total <= 8 && !linkedLabel && text === "") return null;
  return (
    <div className="stack">
      <div className="table-tools" role="search" aria-label={`Search ${noun}`}>
        <div className="field">
          <label htmlFor={`${uid}-q`}>Search {noun}</label>
          <input id={`${uid}-q`} type="search" value={text} onChange={(e) => { setText(e.target.value); setLimit(PAGE); }} />
        </div>
        {linkedLabel && <label><input type="checkbox" checked={linkedOnly} onChange={(e) => { setLinkedOnly(e.target.checked); setLimit(PAGE); }} /> {linkedLabel}</label>}
        <p className="muted" role="status" aria-live="polite">{matched === null ? "" : `Showing ${Math.min(matched, limit)} of ${matched} ${noun}${matched !== total ? ` (${total} in all)` : ""}.`}</p>
      </div>
      {matched !== null && matched > limit && <div><button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, matched - limit)} more</button></div>}
    </div>
  );
}
