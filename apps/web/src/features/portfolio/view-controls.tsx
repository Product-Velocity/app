"use client";

import { useState } from "react";
import {
  FIELD_BY_KEY, fieldOptions, filterOptions, filterSummary, groupableFields, isOpenList, needsSearch, optionsFor, type Filter, type ListOption,
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
