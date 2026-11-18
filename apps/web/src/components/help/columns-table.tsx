"use client";

import { useState } from "react";
import { COLUMN_GROUPS, COLUMN_ROWS, COLUMNS_NOTE, UPDATE_LEGEND } from "../help-content";

/** Every column of the roadmap, with a filter. The rows come from the field dictionary (help-content.ts), so a new column appears here by itself. */
export function ColumnsTable() {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = COLUMN_ROWS.filter((r) => {
    const hay = `${r.column} ${r.what} ${r.github} ${r.jira} ${r.access} ${r.updated} ${r.group} ${r.key}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return (
    <div>
      <label className="help-filter">
        <span className="visually-hidden">Filter columns</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter columns, e.g. status, GitHub, read-only" />
      </label>
      <p className="muted" role="status">{shown.length} of {COLUMN_ROWS.length} columns. {COLUMNS_NOTE} A lock icon in a header means the value comes from the tracker.</p>
      <p className="muted">{UPDATE_LEGEND}</p>
      <div className="hp-table-wrap">
        <table className="hp-table help-columns">
          <caption className="visually-hidden">Columns, and how each one relates to GitHub and Jira</caption>
          <thead><tr><th scope="col">Column</th><th scope="col">What it is</th><th scope="col">GitHub</th><th scope="col">Jira</th><th scope="col">Access</th><th scope="col">Updated by</th></tr></thead>
          {COLUMN_GROUPS.map((g) => {
            const rows = shown.filter((r) => r.group === g);
            if (rows.length === 0) return null;
            return (
              <tbody key={g}>
                <tr className="help-group"><th colSpan={6} scope="colgroup">{g}</th></tr>
                {rows.map((r) => (
                  <tr key={r.key}><th scope="row">{r.column}</th><td>{r.what}</td><td>{r.github}</td><td>{r.jira}</td><td>{r.access}</td><td>{r.updated}</td></tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
