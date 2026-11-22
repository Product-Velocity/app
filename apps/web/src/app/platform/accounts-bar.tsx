"use client";

import { useState } from "react";
import { Popover } from "@/features/portfolio/popover";
import { FoldAllButton } from "@/features/portfolio/fold-all-button";
import type { AccountRow } from "./accounts-model";
import { GROUP_BYS, QUICK, RULE_FIELDS, fieldChoices, filterCount, groupSummary, type AccountFilters, type GroupBy, type Rule, type RuleField } from "./accounts-view";

/**
 * The action bar of the All accounts grid: Filter, Columns, Group by, fold all and Search, built from the same parts and classes as the Roadmap and
 * Changes grids (Popover, panel sections, quick-filter pills, panel footer), with the filters, columns and groupings of an account list.
 */
export type AccountColumn = { id: string; name: string };
const tick = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>;

function FilterPanel({ filters, onChange, rows, matching, close }: { filters: AccountFilters; onChange: (f: AccountFilters) => void; rows: readonly AccountRow[]; matching: number; close: () => void }) {
  const n = filterCount(filters);
  const setRule = (i: number, rule: Rule) => onChange({ ...filters, rules: filters.rules.map((r, j) => (j === i ? rule : r)) });
  const nextField = (): RuleField => RULE_FIELDS.find((f) => !filters.rules.some((r) => r.field === f.id))?.id ?? "status";
  return (
    <div role="group" aria-label="Filters">
      <div className="panel-section">
        <div className="panel-head"><h2>Quick filters</h2><span className="panel-note">One click, combined with AND. Click again to remove.</span></div>
        <div className="qf-row">
          {QUICK.map((q) => {
            const on = filters.quick.includes(q.id);
            return <button key={q.id} type="button" className="qf" aria-pressed={on} title={q.hint} onClick={() => onChange({ ...filters, quick: on ? filters.quick.filter((x) => x !== q.id) : [...filters.quick, q.id] })}>{q.label}{on && tick}</button>;
          })}
        </div>
        <p className="panel-note">{QUICK.map((q) => `${q.label}: ${q.hint}`).join(" ")}</p>
      </div>
      <hr className="panel-rule" />
      <div className="panel-section">
        <div className="panel-head"><h2>Custom rules</h2><span className="panel-note">An account must match every rule (AND). Several values in one rule match any of them.</span></div>
        {filters.rules.length === 0 && <p className="panel-note">No custom rules yet.</p>}
        {filters.rules.map((rule, i) => (
          <div key={i}>
            {i > 0 && <p className="rule-and">AND</p>}
            <div className="rule-row filter-row">
              <span className="where">where</span>
              <select aria-label={`Field of rule ${i + 1}`} value={rule.field} onChange={(e) => setRule(i, { field: e.target.value as RuleField, values: [] })}>
                {RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
              <span className="where">is any of</span>
              <span className="qf-row" role="group" aria-label={`Values of rule ${i + 1}`}>
                {fieldChoices(rows, rule.field).map((c) => {
                  const on = rule.values.includes(c.value);
                  return <button key={c.value} type="button" className="qf" aria-pressed={on} onClick={() => setRule(i, { ...rule, values: on ? rule.values.filter((v) => v !== c.value) : [...rule.values, c.value] })}>{c.label}{on && tick}</button>;
                })}
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove rule ${i + 1}`} title="Remove this rule" onClick={() => onChange({ ...filters, rules: filters.rules.filter((_, j) => j !== i) })}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
            </div>
          </div>
        ))}
        <div>
          <button type="button" className="btn" onClick={() => onChange({ ...filters, rules: [...filters.rules, { field: nextField(), values: [] }] })}>+ Add rule</button>
          <span className="panel-note"> A rule without a value is ignored.</span>
        </div>
      </div>
      <div className="panel-foot">
        <span><strong>{matching.toLocaleString("en-GB")}</strong> of {rows.length.toLocaleString("en-GB")} accounts match</span>
        <span className="panel-note">Applied as you go</span>
        <span className="grow" />
        {n > 0 && <button type="button" className="btn btn-link" onClick={() => onChange({ ...filters, quick: [], rules: [] })}>Clear all</button>}
        <button type="button" className="btn btn-primary" onClick={close}>Done</button>
      </div>
    </div>
  );
}

function ColumnsPanel({ all, shown, defaults, onApply, close }: { all: readonly AccountColumn[]; shown: readonly string[]; defaults: readonly string[]; onApply: (ids: string[]) => void; close: () => void }) {
  const [cols, setCols] = useState<string[]>([...shown]);
  const name = (id: string) => all.find((c) => c.id === id)?.name ?? id;
  const toggle = (id: string) => setCols((c) => (c.includes(id) ? (c.length > 1 ? c.filter((x) => x !== id) : c) : [...c, id]));
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
            <legend className="panel-head" style={{ padding: 0 }}><h2>Account columns</h2></legend>
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

const LEVEL = ["Group by", "Then by"] as const;
function GroupPanel({ by, then, onApply, close }: { by: GroupBy | null; then: GroupBy | null; onApply: (by: GroupBy | null, then: GroupBy | null) => void; close: () => void }) {
  const [draft, setDraft] = useState<{ by: GroupBy | null; then: GroupBy | null }>({ by, then });
  const [level, setLevel] = useState<0 | 1>(by && !then ? 1 : 0);
  const active = draft.by ? level : 0;
  const pick = (g: GroupBy) => {
    if (active === 0) {
      if (draft.by === g) setDraft({ by: draft.then, then: null });
      else { setDraft({ by: g, then: draft.then === g ? null : draft.then }); setLevel(1); }
    } else setDraft(draft.then === g ? { ...draft, then: null } : { ...draft, then: g });
  };
  const label = (g: GroupBy | null) => (g ? GROUP_BYS.find((x) => x.id === g)!.label : null);
  const mark = (g: GroupBy) => (draft.by === g ? "Group by" : draft.then === g ? "Then by" : null);
  return (
    <div role="group" aria-label="Group by" className="gp gp-wide">
      <div className="gp-body">
        <div className="panel-section">
          <div className="panel-head gp-head"><h2>Group by</h2><span className="panel-note" aria-live="polite">{draft.by ? `Grouped by ${groupSummary(draft.by, draft.then).replace(" › ", ", then ")}` : "Not grouped"}</span></div>
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
            {GROUP_BYS.filter((g) => (active === 0 ? g.id !== draft.then : g.id !== draft.by)).map((g) => (
              <button key={g.id} type="button" className="qf" aria-pressed={mark(g.id) !== null} onClick={() => pick(g.id)}>
                {g.label}{mark(g.id) && <span className="muted"> · {mark(g.id)}</span>}{mark(g.id) && tick}
              </button>
            ))}
          </div>
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

export function AccountsBar(p: {
  filters: AccountFilters; onFilters: (f: AccountFilters) => void; rows: readonly AccountRow[]; matching: number;
  allColumns: readonly AccountColumn[]; columns: readonly string[]; defaultColumns: readonly string[]; onColumns: (ids: string[]) => void;
  by: GroupBy | null; then: GroupBy | null; onGroup: (by: GroupBy | null, then: GroupBy | null) => void;
  groupKeys: readonly string[]; collapsed: ReadonlySet<string>; onCollapse: (next: Set<string>) => void;
  onExport: () => void;
}) {
  const n = filterCount(p.filters);
  return (
    <div className="pvbar" role="region" aria-label="Accounts tools">
      <div className="pvbar-s1">
        <Popover wide staged label={<>Filter: <strong className="count-badge">{n === 0 ? "None" : `${n} active`}</strong></>} active={n > 0}>
          {(close) => <FilterPanel filters={p.filters} onChange={p.onFilters} rows={p.rows} matching={p.matching} close={close} />}
        </Popover>
        <Popover wide staged label={<>Columns: <strong className="count-badge">{p.columns.length} of {p.allColumns.length} shown</strong></>}>
          {(close) => <ColumnsPanel all={p.allColumns} shown={p.columns} defaults={p.defaultColumns} onApply={p.onColumns} close={close} />}
        </Popover>
        <Popover wide staged label={<>Group by: <strong className="count-badge">{groupSummary(p.by, p.then)}</strong></>} active={!!p.by}>
          {(close) => <GroupPanel by={p.by} then={p.then} onApply={p.onGroup} close={close} />}
        </Popover>
        <FoldAllButton keys={p.groupKeys} collapsed={p.collapsed} onChange={p.onCollapse} />
        <label className="pvbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6272" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" aria-label="Search accounts" placeholder="Search accounts" value={p.filters.search} onChange={(e) => p.onFilters({ ...p.filters, search: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") p.onFilters({ ...p.filters, search: "" }); }} />
        </label>
        <span className="grow" />
        <button type="button" className="btn" onClick={p.onExport}>Export CSV</button>
      </div>
    </div>
  );
}

/** The chips under the bar: what is filtered, each with a cross (like the Roadmap grid). */
export function AccountFilterChips({ filters, onChange }: { filters: AccountFilters; onChange: (f: AccountFilters) => void }) {
  const rules = filters.rules.filter((r) => r.values.length > 0);
  if (filters.quick.length + rules.length === 0) return null;
  return (
    <div className="filter-chips" role="group" aria-label="Active filters">
      {filters.quick.map((q) => {
        const t = QUICK.find((x) => x.id === q)!.label;
        return <span key={q} className="token-chip">{t} <button type="button" className="chip-x" aria-label={`Remove filter ${t}`} onClick={() => onChange({ ...filters, quick: filters.quick.filter((x) => x !== q) })}>×</button></span>;
      })}
      {rules.map((r) => {
        const t = `${RULE_FIELDS.find((x) => x.id === r.field)!.label}: ${r.values.join(", ")}`;
        return <span key={r.field} className="token-chip">{t} <button type="button" className="chip-x" aria-label={`Remove filter ${t}`} onClick={() => onChange({ ...filters, rules: filters.rules.filter((x) => x !== r) })}>×</button></span>;
      })}
    </div>
  );
}
