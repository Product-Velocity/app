"use client";

import { useState } from "react";
import {
  CHANGE_GROUP_BYS, CHANGE_QUICK, CHANGE_RULE_FIELDS, changeFieldChoices, changeFilterCount, changeGroupSummary, changeValueLabel,
  type ChangeFilters, type ChangeGroupBy, type ChangeQuick, type ChangeRowData, type ChangeRule, type ChangeRuleField,
} from "@pv/domain";
import { Popover } from "../portfolio/popover";

/**
 * The action bar of the Changes report (issue #472, Ashu 2026-11-17: "use the action bar from the main grid ... adapt for the change log grid"): Filter, Columns,
 * Group by and Search, built from the same parts and classes as the Roadmap grid's bar (Popover, panel sections, quick-filter pills, panel footer), with the
 * filters, columns and groupings of a change log. Never a grouping or a count by person (rule 8).
 */
export type ChangeColumn = { id: string; name: string };
const tick = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;

// ---------------------------------------------------------------------------------------------------- Filter
function FilterPanel({ filters, onChange, rows, matching, total, close }: { filters: ChangeFilters; onChange: (f: ChangeFilters) => void; rows: readonly ChangeRowData[]; matching: number; total: number; close: () => void }) {
  const n = changeFilterCount(filters);
  const quickOn = (q: ChangeQuick) => filters.quick.includes(q);
  const setRule = (i: number, rule: ChangeRule) => onChange({ ...filters, rules: filters.rules.map((r, j) => (j === i ? rule : r)) });
  const nextField = (): ChangeRuleField => CHANGE_RULE_FIELDS.find((f) => !filters.rules.some((r) => r.field === f.id))?.id ?? "type";
  return (
    <div role="group" aria-label="Filters">
      <div className="panel-section">
        <div className="panel-head"><h2>Quick filters</h2><span className="panel-note">One click, combined with AND. Click again to remove.</span></div>
        <div className="qf-row">
          {CHANGE_QUICK.map((q) => (
            <button key={q.id} type="button" className="qf" aria-pressed={quickOn(q.id)} title={q.hint} onClick={() => onChange({ ...filters, quick: quickOn(q.id) ? filters.quick.filter((x) => x !== q.id) : [...filters.quick, q.id] })}>
              {q.id === "flagged" ? "⚑ " : ""}{q.label}{quickOn(q.id) && tick}
            </button>
          ))}
        </div>
        <p className="panel-note">{CHANGE_QUICK.map((q) => `${q.label}: ${q.hint}`).join(" ")}</p>
      </div>
      <hr className="panel-rule" />
      <div className="panel-section">
        <div className="panel-head"><h2>Custom rules</h2><span className="panel-note">A change must match every rule (AND). Several values in one rule match any of them.</span></div>
        {filters.rules.length === 0 && <p className="panel-note">No custom rules yet.</p>}
        {filters.rules.map((rule, i) => {
          const choices = changeFieldChoices(rows, rule.field);
          return (
            <div key={i}>
              {i > 0 && <p className="rule-and">AND</p>}
              <div className="rule-row filter-row">
                <span className="where">where</span>
                <select aria-label={`Field of rule ${i + 1}`} value={rule.field} onChange={(e) => setRule(i, { field: e.target.value as ChangeRuleField, values: [] })}>
                  {CHANGE_RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <span className="where">is any of</span>
                <span className="qf-row" role="group" aria-label={`Values of rule ${i + 1}`}>
                  {choices.length === 0 && <span className="panel-note">No values in this period</span>}
                  {choices.map((c) => {
                    const on = rule.values.includes(c.value);
                    return <button key={c.value} type="button" className="qf" aria-pressed={on} onClick={() => setRule(i, { ...rule, values: on ? rule.values.filter((v) => v !== c.value) : [...rule.values, c.value] })}>{c.label}{on && tick}</button>;
                  })}
                </span>
                <button type="button" className="icon-btn" aria-label={`Remove rule ${i + 1}`} title="Remove this rule" onClick={() => onChange({ ...filters, rules: filters.rules.filter((_, j) => j !== i) })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
              </div>
            </div>
          );
        })}
        <div>
          <button type="button" className="btn" onClick={() => onChange({ ...filters, rules: [...filters.rules, { field: nextField(), values: [] }] })}>+ Add rule</button>
          <span className="panel-note"> A rule without a value is ignored.</span>
        </div>
      </div>
      <div className="panel-foot">
        <span><strong>{matching.toLocaleString("en-GB")}</strong> of {total.toLocaleString("en-GB")} changes match</span>
        <span className="panel-note">Applied as you go</span>
        <span className="grow" />
        {n > 0 && <button type="button" className="btn btn-link" onClick={() => onChange({ ...filters, quick: [], rules: [] })}>Clear all</button>}
        <button type="button" className="btn btn-primary" onClick={close}>Done</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- Columns
function ColumnsPanel({ all, shown, defaults, onApply, close }: { all: readonly ChangeColumn[]; shown: readonly string[]; defaults: readonly string[]; onApply: (ids: string[]) => void; close: () => void }) {
  const [cols, setCols] = useState<string[]>([...shown]);
  const name = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const toggle = (id: string) => setCols((c) => (c.includes(id) ? (c.length > 1 ? c.filter((x) => x !== id) : c) : [...c, id])); // at least one column stays
  const move = (id: string, d: -1 | 1) => setCols((c) => { const i = c.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= c.length) return c; const n = [...c]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  return (
    <div role="group" aria-label="Choose columns">
      <div className="panel-section" style={{ paddingBottom: 12 }}>
        <div className="panel-head"><h2>Columns</h2><span className="panel-note">Nothing changes in the grid until you press Apply. You can also drag a column header to move it.</span></div>
      </div>
      <hr className="panel-rule" />
      <div className="cp cp-body">
        <div className="cp-mid">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="panel-head" style={{ padding: 0 }}><h2>Change log columns</h2></legend>
            <div className="cp-list">
              {all.map((c) => (
                <label key={c.id} className="cp-field">
                  <input type="checkbox" checked={cols.includes(c.id)} disabled={cols.length === 1 && cols.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="cp-order">
          <div className="panel-head"><h2>Selected columns ({cols.length})</h2></div>
          <p className="panel-note" style={{ margin: "4px 0 8px" }}>Use the arrows to reorder, or remove a column with the cross.</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Selected columns in order">
            {cols.map((id, i) => (
              <li key={id} data-column={id} className="cp-card">
                <span className="name">{name(id)}</span>
                <button type="button" className="icon-btn" aria-label={`Move ${name(id)} up`} disabled={i === 0} onClick={() => move(id, -1)}>▲</button>
                <button type="button" className="icon-btn" aria-label={`Move ${name(id)} down`} disabled={i === cols.length - 1} onClick={() => move(id, 1)}>▼</button>
                <button type="button" className="icon-btn" aria-label={`Remove ${name(id)}`} disabled={cols.length === 1} onClick={() => toggle(id)}>
                  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="panel-foot">
        <button type="button" className="btn btn-link" onClick={() => setCols([...defaults])}>Reset to default</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => { onApply(cols); close(); }}>Apply columns ({cols.length})</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- Group by
const LEVEL = ["Group by", "Then by"] as const;
function GroupPanel({ by, then, onApply, close }: { by: ChangeGroupBy | null; then: ChangeGroupBy | null; onApply: (by: ChangeGroupBy | null, then: ChangeGroupBy | null) => void; close: () => void }) {
  const [draft, setDraft] = useState<{ by: ChangeGroupBy | null; then: ChangeGroupBy | null }>({ by, then });
  const [level, setLevel] = useState<0 | 1>(by && !then ? 1 : 0);
  const active = draft.by ? level : 0;
  const pick = (g: ChangeGroupBy) => {
    if (active === 0) {
      if (draft.by === g) setDraft({ by: draft.then, then: null });
      else { setDraft({ by: g, then: draft.then === g ? null : draft.then }); setLevel(1); }
    } else setDraft(draft.then === g ? { ...draft, then: null } : { ...draft, then: g });
  };
  const label = (g: ChangeGroupBy | null) => (g ? CHANGE_GROUP_BYS.find((x) => x.id === g)!.label : null);
  const mark = (g: ChangeGroupBy) => (draft.by === g ? "Group by" : draft.then === g ? "Then by" : null);
  return (
    <div role="group" aria-label="Group by" className="gp gp-wide">
      <div className="gp-body">
        <div className="panel-section">
          <div className="panel-head gp-head"><h2>Group by</h2><span className="panel-note" aria-live="polite">{draft.by ? `Grouped by ${changeGroupSummary(draft.by, draft.then).replace(" › ", ", then ")}` : "Not grouped"}</span></div>
          <div className="gp-slots" role="group" aria-label="Grouping levels">
            {([0, 1] as const).map((l) => {
              const value = l === 0 ? draft.by : draft.then;
              const off = l === 1 && !draft.by;
              return (
                <div key={l} className="gp-slot" data-active={!off && active === l} data-empty={!value}>
                  <button type="button" className="gp-slot-main" aria-label={`Choose the grouping for ${LEVEL[l]}: ${label(value) ?? "none yet"}`} aria-pressed={!off && active === l} disabled={off} onClick={() => setLevel(l)}>
                    <span className="gp-slot-n" aria-hidden="true">{l + 1}</span>
                    <span className="gp-slot-text"><span className="gp-slot-label">{LEVEL[l]}</span><span className="gp-slot-val">{label(value) ?? (off ? "—" : "Pick one below")}</span></span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="qf-row" role="group" aria-label="Group by options" style={{ marginTop: 10 }}>
            {CHANGE_GROUP_BYS.filter((g) => (active === 0 ? g.id !== draft.then : g.id !== draft.by)).map((g) => (
              <button key={g.id} type="button" className="qf" aria-pressed={mark(g.id) !== null} onClick={() => pick(g.id)}>
                {g.label}{mark(g.id) && <span className="muted"> · {mark(g.id)}</span>}{mark(g.id) && tick}
              </button>
            ))}
          </div>
          <p className="panel-note">Changes are grouped by what changed, where it came from or when. Never by person.</p>
        </div>
      </div>
      <div className="panel-foot">
        <button type="button" className="btn btn-link" onClick={() => setDraft({ by: null, then: null })}>Clear</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => { onApply(draft.by, draft.then); close(); }}>Apply</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------- the bar
export function ChangesBar(p: {
  filters: ChangeFilters; onFilters: (f: ChangeFilters) => void; rows: readonly ChangeRowData[]; matching: number;
  allColumns: readonly ChangeColumn[]; columns: readonly string[]; defaultColumns: readonly string[]; onColumns: (ids: string[]) => void;
  by: ChangeGroupBy | null; then: ChangeGroupBy | null; onGroup: (by: ChangeGroupBy | null, then: ChangeGroupBy | null) => void;
  /** Expand or collapse every group: the keys of all the group rows, and which are collapsed now. */
  groupKeys: readonly string[]; collapsed: ReadonlySet<string>; onCollapse: (keys: string[]) => void;
  /** Reload the changes and the roadmap; `updatedAt` is when they were last read. */
  onRefresh: () => void; refreshing: boolean; updatedAt: Date | null;
}) {
  const allCollapsed = p.groupKeys.length > 0 && p.groupKeys.every((k) => p.collapsed.has(k));
  const n = changeFilterCount(p.filters);
  return (
    <div className="pvbar" role="region" aria-label="Changes tools">
      <div className="pvbar-s1">
        <Popover wide label={<>Filter: <strong className="count-badge">{n === 0 ? "None" : `${n} active`}</strong></>} active={n > 0}>
          {(close) => <FilterPanel filters={p.filters} onChange={p.onFilters} rows={p.rows} matching={p.matching} total={p.rows.length} close={close} />}
        </Popover>
        <Popover wide staged label={<>Columns: <strong className="count-badge">{p.columns.length} of {p.allColumns.length} shown</strong></>}>
          {(close) => <ColumnsPanel all={p.allColumns} shown={p.columns} defaults={p.defaultColumns} onApply={p.onColumns} close={close} />}
        </Popover>
        <Popover wide staged label={<>Group by: <strong className="count-badge">{changeGroupSummary(p.by, p.then)}</strong></>} active={!!p.by}>
          {(close) => <GroupPanel by={p.by} then={p.then} onApply={p.onGroup} close={close} />}
        </Popover>
        <button type="button" className="tool-btn" disabled={p.groupKeys.length === 0} aria-pressed={allCollapsed}
          title={p.groupKeys.length === 0 ? "Group the changes to fold their lines" : allCollapsed ? "Show the lines of every group" : "Fold the lines of every group away"}
          onClick={() => p.onCollapse(allCollapsed ? [] : [...p.groupKeys])}>{allCollapsed ? "▸ Expand all" : "▾ Collapse all"}</button>
        <label className="pvbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6272" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" aria-label="Search changes" placeholder="Search changes" value={p.filters.search} onChange={(e) => p.onFilters({ ...p.filters, search: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") p.onFilters({ ...p.filters, search: "" }); }} />
        </label>
        <button type="button" className="tool-btn" disabled={p.refreshing} onClick={p.onRefresh}
          title={p.updatedAt ? `Read the changes and the roadmap again. Last read ${p.updatedAt.toLocaleTimeString("en-GB")}.` : "Read the changes and the roadmap again"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" /></svg>
          {p.refreshing ? " Refreshing…" : " Refresh"}
        </button>
        {p.updatedAt && <span className="muted pvbar-updated" role="status">Updated {p.updatedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
      </div>
    </div>
  );
}

/** The chips under the bar: what is filtered, each with a cross (like the Roadmap grid). */
export function ChangeFilterChips({ filters, rows, onChange }: { filters: ChangeFilters; rows: readonly ChangeRowData[]; onChange: (f: ChangeFilters) => void }) {
  const rules = filters.rules.filter((r) => r.values.length > 0);
  if (filters.quick.length + rules.length === 0) return null;
  return (
    <div className="filter-chips" role="group" aria-label="Active filters">
      {filters.quick.map((q) => {
        const t = CHANGE_QUICK.find((x) => x.id === q)!.label;
        return <span key={q} className="token-chip">{t} <button type="button" className="chip-x" aria-label={`Remove filter ${t}`} onClick={() => onChange({ ...filters, quick: filters.quick.filter((x) => x !== q) })}>×</button></span>;
      })}
      {rules.map((r) => {
        const f = CHANGE_RULE_FIELDS.find((x) => x.id === r.field)!.label;
        const t = `${f}: ${r.values.map((v) => changeValueLabel(r.field, v, rows)).join(", ")}`;
        return <span key={r.field} className="token-chip">{t} <button type="button" className="chip-x" aria-label={`Remove filter ${t}`} onClick={() => onChange({ ...filters, rules: filters.rules.filter((x) => x !== r) })}>×</button></span>;
      })}
    </div>
  );
}
