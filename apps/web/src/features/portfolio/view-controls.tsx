"use client";

import { useState } from "react";
import {
  FIELD_BY_KEY, fieldOptions, filterOptions, filterSummary, groupableFields, isOpenList, needsSearch, optionsFor, sortableFields, sortDirectionLabels, type Filter, type ListOption, type SortDef,
} from "@pv/domain";
import { menuSearchKeys, NoResults, SearchInput, SelectField } from "@/components/search-list";
import { DateInput } from "@/components/date-input";
import { Popover } from "./popover";
import type { Lookups } from "./types";

// ------------------------------------------------------------------ filters
export function valueControl(f: Filter, lookups: Lookups, today: Date, patch: (p: Partial<Filter>) => void, quarters: Iterable<unknown> = [], openValues?: (key: string) => string[]) {
  const onValue = (v: string) => patch({ value: v });
  const def = FIELD_BY_KEY[f.field];
  if (!def || f.op === "empty" || f.op === "not_empty") return null;
  const label = `Value for ${def.name}`;
  let options: { value: string; label: string }[] | null = null;
  if (def.key === "home_project") options = lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  else if (def.type === "Person") options = [{ value: "me", label: "me" }, ...lookups.members.map((m) => ({ value: m.user_id, label: m.email }))];
  else if (def.type === "Boolean") options = [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }];
  else if (def.type === "Select" && def.allowed.length > 0) options = optionsFor(def.key, quarters);
  else if (isOpenList(def.key)) options = (openValues?.(def.key) ?? []).map((v) => ({ value: v, label: v })); // the values in use (Focus Area, Audience)
  if (options) return <SelectField label={label} value={f.value ?? ""} options={options} onChange={onValue} blank="Choose…" />;
  if (def.type === "Date") {
    if (f.op === "in_last" || f.op === "in_next") {
      return <span className="filter-date"><input type="number" min={0} max={3650} aria-label={`Number of days for ${def.name}`} value={f.value ?? ""} placeholder="days" onChange={(e) => onValue(e.target.value)} /> <span className="muted">days{f.op === "in_last" ? " back from today" : " from today"}</span></span>;
    }
    if (f.op === "between") {
      return (
        <span className="filter-date">
          <DateInput label={`${def.name} from`} value={f.value ?? ""} today={today} edge="start" onCommit={onValue} />
          <span className="muted">and</span>
          <DateInput label={`${def.name} until`} value={f.value2 ?? ""} today={today} edge="end" onCommit={(v) => patch({ value2: v })} />
        </span>
      );
    }
    return <DateInput label={label} value={f.value ?? ""} today={today} edge={f.op === "after" ? "end" : "start"} onCommit={onValue} />;
  }
  return <input aria-label={label} value={f.value ?? ""} placeholder={def.type === "Number" || def.type === "Currency" ? "a number" : "text"} onChange={(e) => onValue(e.target.value)} />;
}

/** Words for a chip row or the palette. */
export const summarize = (f: Filter, lookups: Lookups) =>
  filterSummary(f, {
    person: (id) => (id === "me" ? "me" : lookups.members.find((m) => m.user_id === id)?.email ?? id),
    project: (id) => lookups.projects.find((p) => p.id === id)?.name ?? id,
  });

// ----------------------------------------------------------------- grouping
export function GroupMenu({ groupBy, onChange }: { groupBy: string | null; onChange: (g: string | null) => void }) {
  return (
    <Popover label={<>Group by: <strong className="count-badge">{groupBy ? FIELD_BY_KEY[groupBy]?.name : "None"}</strong></>} active={!!groupBy}>
      {(close) => <GroupPanel groupBy={groupBy} onPick={(g) => { onChange(g); close(); }} />}
    </Popover>
  );
}

const GROUP_OPTIONS: ListOption[] = [{ value: "", label: "No grouping" }, ...fieldOptions(groupableFields())];
function GroupPanel({ groupBy, onPick }: { groupBy: string | null; onPick: (g: string | null) => void }) {
  const [query, setQuery] = useState("");
  const shown = filterOptions(GROUP_OPTIONS, query);
  return (
    <>
      {needsSearch(GROUP_OPTIONS.length) && <SearchInput value={query} onChange={setQuery} label="Search group by options" onKeyDown={menuSearchKeys} />}
      <div className="group-panel" role="menu" aria-label="Group by">
        {shown.map((o) => (
          <button key={o.value || "none"} type="button" role="menuitemradio" aria-checked={(groupBy ?? "") === o.value} className="scope-item" onClick={() => onPick(o.value || null)}>
            {o.label}
          </button>
        ))}
      </div>
      {shown.length === 0 && <NoResults query={query} />}
    </>
  );
}

// --------------------------------------------------------------------- sort
const SORT_OPTIONS: ListOption[] = fieldOptions(sortableFields());
/**
 * One sort for the grid (and for a saved view), in two steps like the other toolbar panels: pick a column, then a direction and Apply.
 * Nothing changes in the grid before Apply. No sort means the global Stack Rank order.
 */
export function SortMenu({ sort, columns, onChange }: { sort: SortDef | null; /** The columns the view shows: only these can be sorted, so what you pick always applies. */ columns: readonly string[]; onChange: (s: SortDef | null) => void }) {
  const text = sort && FIELD_BY_KEY[sort.field] ? `${FIELD_BY_KEY[sort.field]!.name}, ${sortDirectionLabels(sort.field)[sort.dir]}` : "Stack Rank";
  return (
    <Popover label={<>Sort: <strong className="count-badge">{text}</strong></>} active={!!sort}>
      {(close) => <SortPanel sort={sort} columns={columns} onApply={(s) => { onChange(s); close(); }} />}
    </Popover>
  );
}
function SortPanel({ sort, columns, onApply }: { sort: SortDef | null; columns: readonly string[]; onApply: (s: SortDef | null) => void }) {
  const [query, setQuery] = useState("");
  const [field, setField] = useState<string | null>(null); // step 2 once a column is picked
  const [dir, setDir] = useState<SortDef["dir"]>("asc");
  const shown = filterOptions(SORT_OPTIONS.filter((o) => columns.includes(o.value)), query);
  if (field) {
    const words = sortDirectionLabels(field);
    return (
      <div className="sort-step" role="group" aria-label={`Sort by ${FIELD_BY_KEY[field]?.name}`}>
        <p className="scope-head">Sort by {FIELD_BY_KEY[field]?.name}</p>
        <div role="radiogroup" aria-label="Direction">
          {(["asc", "desc"] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={dir === d} className="scope-item" onClick={() => setDir(d)}>{words[d]}{dir === d && <span className="scope-meta" aria-hidden="true"> ✓</span>}</button>
          ))}
        </div>
        <div className="sort-actions">
          <button type="button" className="tool-btn" onClick={() => setField(null)}>Back</button>
          <button type="button" className="tool-btn tool-btn-on" onClick={() => onApply({ field, dir })}>Apply</button>
        </div>
      </div>
    );
  }
  return (
    <>
      {needsSearch(columns.length) && <SearchInput value={query} onChange={setQuery} label="Search sort fields" onKeyDown={menuSearchKeys} />}
      <p className="panel-note">Columns shown in this view. Add a column to sort by it.</p>
      <div className="group-panel" role="menu" aria-label="Sort by">
        {shown.map((o) => (
          <button key={o.value} type="button" role="menuitemradio" aria-checked={sort?.field === o.value} className="scope-item" onClick={() => { setField(o.value); setDir(sort?.field === o.value ? sort.dir : "asc"); }}>
            {o.label}{sort?.field === o.value && <span className="scope-meta"> current</span>}
          </button>
        ))}
      </div>
      {shown.length === 0 && <NoResults query={query} />}
      <div className="sort-actions">
        <button type="button" className="tool-btn" disabled={!sort} onClick={() => onApply(null)}>Clear sort</button>
      </div>
    </>
  );
}
