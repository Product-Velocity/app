"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CLAUDE_OPTIONS, CLAUDE_PROMPTS, CLAUDE_PROMPT_TIPS, CLAUDE_RULES, COLUMNS_NOTE, COLUMN_ROWS, FLOW_CREATE, FLOW_LIFECYCLE, FLOW_READ, LIFECYCLE_NOTES,
  COLUMN_GROUPS, type Table,
} from "./help-content";

const TABS = [
  { id: "columns", label: "Columns" },
  { id: "flow", label: "How content flows" },
  { id: "claude", label: "Using Claude" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function SimpleTable({ caption, table }: { caption: string; table: Table }) {
  return (
    <table className="help-table">
      <caption>{caption}</caption>
      <thead><tr>{table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{table.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
    </table>
  );
}

/** Help in the top bar: what each column is and where it syncs, how content flows through the product, and how to use Claude. */
export function HelpGuide() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("columns");
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = COLUMN_ROWS.filter((r) => { const hay = `${r.column} ${r.what} ${r.github} ${r.jira} ${r.access} ${r.group} ${r.key}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  return (
    <>
      <button type="button" className="help-btn" aria-haspopup="dialog" onClick={() => setOpen(true)} title="Columns, how content flows, using Claude">Help</button>
      {open && (
        <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dialog help-guide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <h2 id={titleId}>Help</h2>
            <div className="help-tabs" role="tablist" aria-label="Help topics">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" id={`help-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`help-panel-${t.id}`} className={`help-tab${tab === t.id ? " is-active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {tab === "columns" && (
              <div role="tabpanel" id="help-panel-columns" aria-labelledby="help-tab-columns">
                <label className="help-filter">
                  <span className="visually-hidden">Filter columns</span>
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter columns, e.g. status, GitHub, read-only" />
                </label>
                <p className="muted" role="status">{shown.length} of {COLUMN_ROWS.length} columns. {COLUMNS_NOTE} A lock icon in a header means the value comes from the tracker.</p>
                <table className="help-table help-columns">
                  <caption className="visually-hidden">Columns, and how each one relates to GitHub and Jira</caption>
                  <thead><tr><th scope="col">Column</th><th scope="col">What it is</th><th scope="col">GitHub</th><th scope="col">Jira (planned)</th><th scope="col">Access</th></tr></thead>
                  {COLUMN_GROUPS.map((g) => {
                    const rows = shown.filter((r) => r.group === g);
                    if (rows.length === 0) return null;
                    return (
                      <tbody key={g}>
                        <tr className="help-group"><th colSpan={5} scope="colgroup">{g}</th></tr>
                        {rows.map((r) => (
                          <tr key={r.key}><th scope="row">{r.column}</th><td>{r.what}</td><td>{r.github}</td><td>{r.jira}</td><td>{r.access}</td></tr>
                        ))}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            )}

            {tab === "flow" && (
              <div role="tabpanel" id="help-panel-flow" aria-labelledby="help-tab-flow">
                <SimpleTable caption="1. Start from GitHub or Jira: read, clean up, take ownership" table={FLOW_READ} />
                <SimpleTable caption="2. Create initiatives directly or with Claude" table={FLOW_CREATE} />
                <SimpleTable caption="3. How an initiative moves through its lifecycle" table={FLOW_LIFECYCLE} />
                <ul className="help-notes">{LIFECYCLE_NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            )}

            {tab === "claude" && (
              <div role="tabpanel" id="help-panel-claude" aria-labelledby="help-tab-claude">
                <SimpleTable caption="What Claude can write for you" table={CLAUDE_OPTIONS} />
                <ul className="help-notes">{CLAUDE_RULES.map((n) => <li key={n}>{n}</li>)}</ul>
                <table className="help-table">
                  <caption>Prompts that work well</caption>
                  <thead><tr><th scope="col">When</th><th scope="col">Prompt</th></tr></thead>
                  <tbody>{CLAUDE_PROMPTS.map((p) => <tr key={p.when}><th scope="row">{p.when}</th><td>{p.prompt}</td></tr>)}</tbody>
                </table>
                <p className="muted">{CLAUDE_PROMPT_TIPS}</p>
              </div>
            )}

            <div className="dialog-actions"><button ref={closeRef} type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
