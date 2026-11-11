"use client";
import { useId, useMemo, useState } from "react";
import type { FieldLink, RowDirection, TableRow } from "@/lib/tracker-fields/links";
import { EMPTY_QUERY, applyQuery, isFiltered, nextSort, type Query, type SortKey } from "@/lib/tracker-fields/table-query";

// The fields a tracker reports, with search, filter and sort, and for each the Product Velocity field it is linked to and the sync direction
// (decision 2026-11-11-tracker-field-table). The same table on GitHub and Jira. Nothing here saves anything: the settings are in the form below it.

const fill = (e: TableRow) => (e.filled === null || e.sampled === null || e.sampled === 0 ? "not sampled" : `${e.filled} of ${e.sampled}`);

export const DIRECTION_WORDS = (tracker: string): Record<RowDirection, string> => ({
  to_tracker: `Product Velocity to ${tracker}`,
  from_tracker: `${tracker} to Product Velocity (read only)`,
  two_way: "Both ways",
  none: "Not synced",
});
const SHORT = (tracker: string): Record<FieldLink["direction"], string> => ({ to_tracker: `to ${tracker}`, from_tracker: `from ${tracker}`, two_way: "both ways" });
const STATE: Record<FieldLink["state"], string> = { on: "", off: "switched off", unset: "not set up yet", partly: "" };

function Links({ links, tracker }: { links: FieldLink[]; tracker: string }) {
  if (links.length === 0) return <span className="muted">Not linked: ignored by Sync</span>;
  const mixed = new Set(links.map((l) => l.direction)).size > 1;
  return (
    <ul className="plain-list">
      {links.map((l) => {
        const notes = [mixed ? SHORT(tracker)[l.direction] : "", STATE[l.state], l.detail ?? ""].filter(Boolean).join(", ");
        return <li key={`${l.pvKey}-${l.direction}`}>{l.label}{notes && <span className="muted"> ({notes})</span>}</li>;
      })}
    </ul>
  );
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" }, { key: "id", label: "Id" }, { key: "type", label: "Type" }, { key: "kind", label: "Kind" },
];

export function TrackerFieldTable({ rows, tracker, caption, showFill, options: showOptions }: { rows: TableRow[]; tracker: "GitHub" | "Jira"; caption: string; showFill: boolean; options: boolean }) {
  const uid = useId();
  const [q, setQ] = useState<Query>(EMPTY_QUERY);
  const words = DIRECTION_WORDS(tracker);
  const shown = useMemo(() => applyQuery(rows, q), [rows, q]);
  const types = useMemo(() => [...new Set(rows.map((r) => r.typeLabel))].sort((a, b) => a.localeCompare(b)), [rows]);
  const interactive = rows.length > 8;
  const th = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={q.sort === key ? (q.desc ? "descending" : "ascending") : undefined}>
      {interactive ? (
        <button type="button" className="th-sort" onClick={() => setQ((p) => nextSort(p, key))}>
          {label}{q.sort === key && <span aria-hidden="true"> {q.desc ? "▼" : "▲"}</span>}
        </button>
      ) : label}
    </th>
  );
  return (
    <div className="stack">
      {interactive && (
        <div className="row-form" role="search" aria-label={`Search and filter ${caption}`}>
          <div className="field">
            <label htmlFor={`${uid}-q`}>Search</label>
            <input id={`${uid}-q`} type="search" value={q.text} placeholder="Name, id, option or Product Velocity field" onChange={(e) => setQ({ ...q, text: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-type`}>Type</label>
            <select id={`${uid}-type`} value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })}>
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-kind`}>Kind</label>
            <select id={`${uid}-kind`} value={q.kind} onChange={(e) => setQ({ ...q, kind: e.target.value as Query["kind"] })}>
              <option value="all">System and custom</option><option value="system">System</option><option value="custom">Custom</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-dir`}>Sync</label>
            <select id={`${uid}-dir`} value={q.direction} onChange={(e) => setQ({ ...q, direction: e.target.value as Query["direction"] })}>
              <option value="all">All fields</option><option value="used">Used by Sync</option>
              <option value="to_tracker">{words.to_tracker}</option><option value="from_tracker">{words.from_tracker}</option>
              <option value="two_way">{words.two_way}</option><option value="none">{words.none}</option>
            </select>
          </div>
          {isFiltered(q) && <button type="button" className="btn" onClick={() => setQ({ ...EMPTY_QUERY, sort: q.sort, desc: q.desc })}>Clear filters</button>}
        </div>
      )}
      <p className="muted" role="status" aria-live="polite">{interactive ? `Showing ${shown.length} of ${rows.length} fields.` : `${rows.length} fields.`}</p>
      {shown.length === 0 ? <p>No field matches. Clear the filters to see all {rows.length}.</p> : (
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => th(c.key, c.label))}
              {showOptions && <th scope="col">Options</th>}
              {showFill && th("filled", "Filled in sample")}
              {th("linked", "Linked to Product Velocity field")}
              {th("direction", "Sync direction")}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={`${e.source ?? ""}${e.id}`}>
                <td>{e.name}</td>
                <td><code>{e.id}</code></td>
                <td>{e.typeLabel}</td>
                <td>{e.custom ? "Custom" : "System"}</td>
                {showOptions && <td>{e.options.length > 0 ? e.options.join(", ") : <span className="muted">-</span>}</td>}
                {showFill && <td>{fill(e)}</td>}
                <td><Links links={e.links} tracker={tracker} /></td>
                <td>{words[e.direction]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
