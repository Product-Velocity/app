"use client";

import { METHODS, STATE_LABEL, STATES } from "@/lib/alignment";
import { ALIGN_GROUP_BYS, NEED_LABEL, NO_FILTERS, alignGroupSummary, filterCount, type AlignGroupBy, type Filters, type Need } from "@/lib/alignment-list";
import { Popover } from "../portfolio/popover";
import { FoldAllButton } from "../portfolio/fold-all-button";
import { ColumnsPanel, GroupPanel, tick, type ChangeColumn } from "../reports/changes-bar";

/**
 * The action bar of the Alignment tab: Filter, Columns, Group by, fold all, Search, Refresh and Export, built from the same parts as the Roadmap grid's bar and the Changes report.
 * Groupings are by what a session is (status, method, quarter, month, applied, what needs you), never by person.
 */
const NEEDS: Need[] = ["no-participants", "confirm-mailing", "closing-soon", "not-applied"];

function Pills({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="panel-section"><div className="panel-head"><h2>{label}</h2></div><div className="qf-row" role="group" aria-label={label}>{children}</div></div>;
}

function FilterPanel({ filters, onChange, isAdmin, quarters, creators, people, matching, total, close }: {
  filters: Filters; onChange: (f: Filters) => void; isAdmin: boolean; quarters: string[]; creators: string[]; people: Record<string, string>; matching: number; total: number; close: () => void;
}) {
  const n = filterCount(filters);
  const pill = (on: boolean, text: string, click: () => void, key = text) => <button key={key} type="button" className="qf" aria-pressed={on} onClick={click}>{text}{on && tick}</button>;
  const one = <K extends "need" | "status" | "method" | "quarter" | "applied" | "createdBy">(k: K, v: Filters[K]) => onChange({ ...filters, [k]: filters[k] === v ? NO_FILTERS[k] : v });
  return (
    <div role="group" aria-label="Filters">
      {isAdmin && <Pills label="Needs you">{NEEDS.map((x) => pill(filters.need === x, NEED_LABEL[x], () => one("need", x)))}</Pills>}
      <hr className="panel-rule" />
      <Pills label="Status">{STATES.filter((s) => isAdmin || (s !== "draft" && s !== "open")).map((s) => pill(filters.status === s, STATE_LABEL[s], () => one("status", s)))}</Pills>
      <Pills label="Method">{METHODS.map((m) => pill(filters.method === m.value, m.label, () => one("method", m.value)))}</Pills>
      {quarters.length > 0 && <Pills label="Planned quarter">{quarters.map((q) => pill(filters.quarter === q, q, () => one("quarter", q)))}</Pills>}
      {isAdmin && <Pills label="Applied to Stack Rank">{(["applied", "not-applied", "undone"] as const).map((a) => pill(filters.applied === a, a === "applied" ? "Applied" : a === "undone" ? "Undone" : "Not applied", () => one("applied", a)))}</Pills>}
      {isAdmin && creators.length > 1 && <Pills label="Created by">{creators.map((c) => pill(filters.createdBy === c, people[c] ?? c, () => one("createdBy", c), c))}</Pills>}
      <Pills label="Archive">{pill(filters.showArchived, "Show archived sessions", () => onChange({ ...filters, showArchived: !filters.showArchived }))}</Pills>
      <div className="panel-foot">
        <span><strong>{matching}</strong> of {total} sessions match</span>
        <span className="panel-note">Applied as you go. One choice per list; click it again to remove it.</span>
        <span className="grow" />
        {n > 0 && <button type="button" className="btn btn-link" onClick={() => onChange({ ...NO_FILTERS, q: filters.q })}>Clear all</button>}
        <button type="button" className="btn btn-primary" onClick={close}>Done</button>
      </div>
    </div>
  );
}

export function AlignmentBar(p: {
  filters: Filters; onFilters: (f: Filters) => void; isAdmin: boolean; quarters: string[]; creators: string[]; people: Record<string, string>; matching: number; total: number;
  allColumns: readonly ChangeColumn[]; columns: readonly string[]; defaultColumns: readonly string[]; onColumns: (ids: string[]) => void;
  by: AlignGroupBy | null; then: AlignGroupBy | null; onGroup: (by: AlignGroupBy | null, then: AlignGroupBy | null) => void;
  groupKeys: readonly string[]; collapsed: ReadonlySet<string>; onCollapse: (next: Set<string>) => void;
  onRefresh: () => void; onExport: () => void; refreshing: boolean;
}) {
  const n = filterCount(p.filters);
  const options = ALIGN_GROUP_BYS.filter((g) => p.isAdmin || !g.admin);
  return (
    <div className="pvbar" role="region" aria-label="Alignment tools">
      <div className="pvbar-s1">
        <Popover wide staged label={<>Filter: <strong className="count-badge">{n === 0 ? "None" : `${n} active`}</strong></>} active={n > 0}>
          {(close) => <FilterPanel filters={p.filters} onChange={p.onFilters} isAdmin={p.isAdmin} quarters={p.quarters} creators={p.creators} people={p.people} matching={p.matching} total={p.total} close={close} />}
        </Popover>
        <Popover wide staged label={<>Columns: <strong className="count-badge">{p.columns.length} of {p.allColumns.length} shown</strong></>}>
          {(close) => <ColumnsPanel all={p.allColumns} shown={p.columns} defaults={p.defaultColumns} onApply={p.onColumns} close={close} heading="Session columns" />}
        </Popover>
        <Popover wide staged label={<>Group by: <strong className="count-badge">{alignGroupSummary(p.by, p.then)}</strong></>} active={!!p.by}>
          {(close) => <GroupPanel<AlignGroupBy> by={p.by} then={p.then} onApply={p.onGroup} close={close} options={options} summary={alignGroupSummary} note="Sessions are grouped by what they are or when they happened. Never by person." />}
        </Popover>
        <FoldAllButton keys={p.groupKeys} collapsed={p.collapsed} onChange={p.onCollapse} />
        <label className="pvbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6272" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="search" aria-label="Search" placeholder="Session or initiative" value={p.filters.q} onChange={(e) => p.onFilters({ ...p.filters, q: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") p.onFilters({ ...p.filters, q: "" }); }} />
        </label>
        <span className="pvbar-spacer" />
        <button type="button" className="btn" onClick={p.onExport} title="Download the sessions shown, with the columns shown, as a CSV file">Export CSV</button>
        <button type="button" className="btn pvbar-undo" aria-label="Refresh" disabled={p.refreshing} onClick={p.onRefresh} title="Refresh: read the sessions again">
          <svg className={p.refreshing ? "spin" : undefined} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
        </button>
      </div>
    </div>
  );
}

/** The chips under the bar: each filter on, with a cross. */
export function AlignmentChips({ filters, people, onChange }: { filters: Filters; people: Record<string, string>; onChange: (f: Filters) => void }) {
  const chips: { key: string; text: string; off: Filters }[] = [];
  const add = (key: string, text: string, off: Partial<Filters>) => chips.push({ key, text, off: { ...filters, ...off } });
  if (filters.need) add("need", NEED_LABEL[filters.need], { need: "" });
  if (filters.status) add("status", `Status: ${STATE_LABEL[filters.status]}`, { status: "" });
  if (filters.method) add("method", `Method: ${METHODS.find((m) => m.value === filters.method)?.label}`, { method: "" });
  if (filters.quarter) add("quarter", `Planned quarter: ${filters.quarter}`, { quarter: "" });
  if (filters.applied) add("applied", `Applied: ${filters.applied === "not-applied" ? "Not applied" : filters.applied === "undone" ? "Undone" : "Applied"}`, { applied: "" });
  if (filters.createdBy) add("by", `Created by: ${people[filters.createdBy] ?? filters.createdBy}`, { createdBy: "" });
  if (filters.showArchived) add("archived", "Archived shown", { showArchived: false });
  if (chips.length === 0) return null;
  return (
    <div className="filter-chips" role="group" aria-label="Active filters">
      {chips.map((c) => <span key={c.key} className="token-chip">{c.text} <button type="button" className="chip-x" aria-label={`Remove filter ${c.text}`} onClick={() => onChange(c.off)}>×</button></span>)}
    </div>
  );
}
