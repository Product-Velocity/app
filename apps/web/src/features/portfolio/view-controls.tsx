"use client";

import { useMemo, useState } from "react";
import {
  FIELD_BY_KEY, fieldOptions, filterOptions, filterSummary, groupPickerSections, groupSummary, INITIATIVE_GROUP, isOpenList, needsSearch, optionsFor, type Filter,
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
/** What the Group by panel edits: two grouping levels. One of them can be "Initiative, with its issues". */
export type GroupState = { groupBy: string | null; thenBy: string | null };

/** "Group by: Build Status › Sponsor": the state of the grouping on the button, like Filter and Columns. */
export function GroupMenu({ state, customerSafe = false, onChange }: { state: GroupState; customerSafe?: boolean; onChange: (s: GroupState) => void }) {
  return (
    <Popover label={<>Group by: <strong className="count-badge">{groupSummary(state.groupBy, state.thenBy)}</strong></>} active={!!state.groupBy}>
      {(close) => <GroupPanel state={state} customerSafe={customerSafe} onChange={onChange} close={close} />}
    </Popover>
  );
}

const LEVEL_NAME = ["Group by", "Then by"] as const;

function GroupPanel({ state, customerSafe, onChange, close }: { state: GroupState; customerSafe: boolean; onChange: (s: GroupState) => void; close: () => void }) {
  const [query, setQuery] = useState("");
  // which level the next pick fills: the first empty one, else the main one
  const [target, setTarget] = useState<0 | 1>(state.groupBy && !state.thenBy ? 1 : 0);
  const level = state.groupBy && state.groupBy !== INITIATIVE_GROUP ? target : 0;
  const names = [state.groupBy, state.thenBy] as const;
  const nameOf = (k: string | null) => (k ? groupSummary(k) : null);
  const sections = useMemo(() => groupPickerSections({ customerSafe, taken: level === 0 ? state.thenBy : state.groupBy }), [customerSafe, level, state.thenBy, state.groupBy]);
  const all = useMemo(() => fieldOptions(sections.flatMap((x) => x.fields)), [sections]);
  const searching = query.trim() !== "";
  const matching = new Set(filterOptions(all, query).map((o) => o.value));
  const shown = sections
    .map((x) => ({ ...x, fields: x.fields.filter((f) => !searching || matching.has(f.key)) })).filter((x) => x.fields.length > 0);
  const none = searching && shown.length === 0;

  // a choice applies at once and closes the panel (open it again for the other level: it opens on the empty "Then by")
  const set = (next: Partial<GroupState>) => { onChange({ ...state, ...next }); close(); };
  const pick = (key: string) => {
    if (level === 0) {
      if (state.groupBy === key) { clear(0); return; }
      set({ groupBy: key, thenBy: key === INITIATIVE_GROUP || state.thenBy === key ? null : state.thenBy }); // nothing follows the initiative level
    } else if (state.thenBy === key) clear(1);
    else set({ thenBy: key });
  };
  /** Removing the main level promotes the second one. */
  const clear = (l: 0 | 1) => { if (l === 1) set({ thenBy: null }); else set({ groupBy: state.thenBy, thenBy: null }); };
  const swap = () => set({ groupBy: state.thenBy, thenBy: state.groupBy });

  return (
    <div role="group" aria-label="Group by" className="gp">
      <div className="gp-slots" role="group" aria-label="Grouping levels">
        {([0, 1] as const).map((l) => {
          const value = names[l];
          const off = l === 1 && (!state.groupBy || state.groupBy === INITIATIVE_GROUP);
          return (
            <div key={l} className="gp-slot" data-active={!off && level === l} data-empty={!value}>
              <button type="button" className="gp-slot-main" aria-label={`Choose the field for ${LEVEL_NAME[l]}: ${nameOf(value) ?? "none yet"}`} aria-pressed={!off && level === l} disabled={off} onClick={() => setTarget(l)} title={off ? (state.groupBy ? "Nothing can follow “Initiative, with its issues”" : "Choose the main grouping first") : `Pick the field for “${LEVEL_NAME[l]}” below`}>
                <span className="gp-slot-label">{LEVEL_NAME[l]}</span>
                <span className="gp-slot-val">{nameOf(value) ?? (off ? "—" : "Pick a field below")}</span>
              </button>
              {value && <button type="button" className="icon-btn" aria-label={`Remove ${LEVEL_NAME[l]} ${nameOf(value)}`} onClick={() => clear(l)}><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg></button>}
            </div>
          );
        })}
        {state.groupBy && state.thenBy && <button type="button" className="btn btn-link" onClick={swap} aria-label={`Swap: group by ${nameOf(state.thenBy)}, then by ${nameOf(state.groupBy)}`}>Swap order</button>}
      </div>
      {needsSearch(all.length) && <SearchInput value={query} onChange={setQuery} label="Search group by options" placeholder={`Search the ${all.length} fields…`} onKeyDown={menuSearchKeys} />}
      <div className="gp-list" role="menu" aria-label={`Choose the field for ${LEVEL_NAME[level]}`}>
        {shown.map((sec) => (
          <div key={sec.category} role="group" aria-label={sec.category}>
            <div className="gp-cat" aria-hidden="true">{sec.category}</div>
            {sec.fields.map((f) => {
              const mark = state.groupBy === f.key ? "Group by" : state.thenBy === f.key ? "Then by" : null;
              return (
                <button key={f.key} type="button" role="menuitemradio" aria-checked={mark !== null} className="scope-item" onClick={() => pick(f.key)}>
                  <span>{f.name}</span>
                  {mark && <span className="gp-mark">{mark}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {none && <NoResults query={query} />}
      {state.groupBy && (
        <div className="gp-foot">
          <button type="button" className="btn btn-link" onClick={() => set({ groupBy: null, thenBy: null })}>Clear grouping</button>
        </div>
      )}
    </div>
  );
}
