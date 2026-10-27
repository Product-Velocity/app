"use client";

import { useMemo, useState } from "react";
import { arrivesLabel, columnsFor, CORE_COLUMN_KEYS, FIELDS, FIELD_BY_KEY, fieldOptions, filterOptions, isCustomerSafe, MAX_PINNED, needsSearch, type ViewDef } from "@pv/domain";
import { NoResults, SearchInput } from "@/components/search-list";
import { Popover } from "./popover";

const ALL_FIELDS = fieldOptions(FIELDS);
const GROUPS = [...new Set(FIELDS.map((f) => f.group))];
const ALL = "__all__";

type Props = {
  def: ViewDef;
  /** What "Reset to view default" goes back to: the view as it was saved or built in. */
  defaultDef: ViewDef;
  customerSafe: boolean;
  onApply: (columns: string[], pinned: string[]) => void;
};

function Body({ def, defaultDef, customerSafe, onApply, close }: Props & { close: () => void }) {
  const core = useMemo(() => columnsFor(CORE_COLUMN_KEYS, customerSafe), [customerSafe]);
  const [columns, setColumns] = useState<string[]>(def.columns);
  const [pinned, setPinned] = useState<string[]>(def.pinned ?? []);
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [tip, setTip] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ key: string | null; over: string | null }>({ key: null, over: null });

  const isCore = (k: string) => core.includes(k);
  const blocked = (k: string) => customerSafe && !isCustomerSafe(k) && !isCore(k);
  const on = new Set(columns);
  // a pin only counts while the column still sits in the places left of the fourth
  const effectivePinned = pinned.filter((k) => { const i = columns.indexOf(k); return i >= core.length && i < MAX_PINNED; });
  const matching = new Set(filterOptions(ALL_FIELDS, query).map((o) => o.value));
  const searching = query.trim() !== "";
  const shownGroups = searching ? GROUPS.filter((g) => FIELDS.some((f) => f.group === g && matching.has(f.key))) : category === ALL ? GROUPS : [category];
  const countIn = (g: string) => FIELDS.filter((f) => f.group === g && on.has(f.key)).length;
  const totalIn = (g: string) => FIELDS.filter((f) => f.group === g).length;

  const toggle = (k: string) => { if (!isCore(k) && !blocked(k)) setColumns((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k])); };
  const setMany = (keys: string[], show: boolean) => setColumns((c) => {
    const rest = c.filter((x) => isCore(x) || !keys.includes(x));
    return show ? [...rest, ...keys.filter((k) => !blocked(k) && !isCore(k))] : rest;
  });
  const move = (k: string, delta: number) => setColumns((c) => {
    const i = c.indexOf(k), j = i + delta;
    if (i < 0 || j < core.length || j >= c.length) return c;
    const n = [...c]; [n[i], n[j]] = [n[j]!, n[i]!]; return n;
  });
  const drop = (target: string) => {
    const k = drag.key;
    setDrag({ key: null, over: null });
    if (!k || k === target || isCore(k)) return;
    setColumns((c) => {
      const without = c.filter((x) => x !== k);
      const at = Math.max(core.length, without.indexOf(target) + (c.indexOf(k) < c.indexOf(target) ? 1 : 0));
      return [...without.slice(0, at), k, ...without.slice(at)];
    });
  };
  const lock = (k: string) => {
    const i = columns.indexOf(k);
    if (isCore(k)) { setTip("The first columns (rank, ID, name) are always pinned."); return; }
    if (i >= MAX_PINNED) { setTip(`Only the first ${MAX_PINNED} columns can be pinned to the left.`); return; }
    setTip(null);
    setPinned((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  };
  const reset = () => { setColumns(defaultDef.columns); setPinned(defaultDef.pinned ?? []); setTip(null); };

  return (
    <div role="group" aria-label="Choose columns">
      <div className="panel-section" style={{ paddingBottom: 12 }}>
        <div className="panel-head"><h2>Columns</h2><span className="panel-note">Nothing changes in the grid until you press Apply. The first columns stay on the left; one more can be pinned in the fourth place.</span></div>
      </div>
      <hr className="panel-rule" />
      <div className="cp cp-body">
        <nav className="cp-cats" aria-label="Column categories">
          <button type="button" className="cp-cat" aria-current={!searching && category === ALL} onClick={() => { setCategory(ALL); setQuery(""); }}>
            <span>All columns</span><span className="muted">{columns.length}/{FIELDS.length}</span>
          </button>
          {GROUPS.map((g) => (
            <button key={g} type="button" className="cp-cat" aria-current={!searching && category === g} onClick={() => { setCategory(g); setQuery(""); }}>
              <span>{g}</span><span className="muted">{countIn(g)}/{totalIn(g)}</span>
            </button>
          ))}
        </nav>
        <div className="cp-mid">
          <div className="cp-tools">
            {needsSearch(FIELDS.length) && (
              <SearchInput value={query} onChange={setQuery} label="Search columns" placeholder={`Search the ${FIELDS.length} fields…`} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
            )}
            {!searching && category !== ALL && (
              <>
                <button type="button" className="btn btn-link" onClick={() => setMany(FIELDS.filter((f) => f.group === category).map((f) => f.key), true)}>Show all in {category}</button>
                <button type="button" className="btn btn-link" onClick={() => setMany(FIELDS.filter((f) => f.group === category).map((f) => f.key), false)}>Hide all in {category}</button>
              </>
            )}
          </div>
          {searching && shownGroups.length === 0 && <NoResults query={query} />}
          {shownGroups.map((g) => (
            <fieldset key={g} style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="panel-head" style={{ padding: 0 }}><h2>{g}</h2></legend>
              <div className="cp-list">
                {FIELDS.filter((f) => f.group === g && (!searching || matching.has(f.key))).map((f) => {
                  const coreCol = isCore(f.key);
                  const block = blocked(f.key);
                  return (
                    <label key={f.key} className="cp-field">
                      <input type="checkbox" checked={coreCol || (!block && on.has(f.key))} disabled={coreCol || block} onChange={() => toggle(f.key)} />
                      <span>
                        {f.name}
                        {arrivesLabel(f) && <span className="columns-later"> · {arrivesLabel(f)!.toLowerCase()}</span>}
                        {block && <span className="columns-later"> · not customer-safe</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="cp-order">
          <div className="panel-head"><h2>Selected columns ({columns.length})</h2></div>
          <p className="panel-note" style={{ margin: "4px 0 8px" }}>Drag to reorder, or use the arrows. The lock pins a column to the left while you scroll.</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Selected columns in order">
            {columns.map((k, i) => {
              const f = FIELD_BY_KEY[k];
              const coreCol = isCore(k);
              const pinnedNow = coreCol || effectivePinned.includes(k);
              return (
                <li
                  key={k}
                  className="cp-card"
                  data-locked={pinnedNow}
                  data-over={drag.over === k && drag.key !== k}
                  draggable={!coreCol}
                  onDragStart={(e) => { if (coreCol) return; e.dataTransfer.effectAllowed = "move"; setDrag({ key: k, over: null }); }}
                  onDragOver={(e) => { if (drag.key && !coreCol) { e.preventDefault(); if (drag.over !== k) setDrag((d) => ({ ...d, over: k })); } }}
                  onDrop={(e) => { e.preventDefault(); drop(k); }}
                  onDragEnd={() => setDrag({ key: null, over: null })}
                >
                  <span className="cp-handle" aria-hidden="true">{coreCol ? "" : "⠿"}</span>
                  <span className="name">{f?.name ?? k}</span>
                  {!coreCol && (
                    <>
                      <button type="button" className="icon-btn" aria-label={`Move ${f?.name} up`} disabled={i <= core.length} onClick={() => move(k, -1)}>▲</button>
                      <button type="button" className="icon-btn" aria-label={`Move ${f?.name} down`} disabled={i >= columns.length - 1} onClick={() => move(k, 1)}>▼</button>
                    </>
                  )}
                  <button type="button" className={pinnedNow ? "icon-btn lock-on" : "icon-btn"} aria-pressed={pinnedNow} aria-label={`${pinnedNow ? "Unpin" : "Pin"} ${f?.name}${coreCol ? " (always pinned)" : ""}`} onClick={() => lock(k)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d={pinnedNow ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"} /></svg>
                  </button>
                  {!coreCol && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${f?.name}`} onClick={() => toggle(k)}>
                      <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          {tip && <p className="cp-tip" role="status">{tip}</p>}
        </div>
      </div>
      <div className="panel-foot">
        <button type="button" className="btn btn-link" onClick={reset}>Reset to view default</button>
        <span className="grow" />
        <span className="panel-note">{effectivePinned.length + core.length} pinned</span>
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => { onApply(columns, effectivePinned); close(); }}>Apply columns ({columns.length})</button>
      </div>
    </div>
  );
}

/** "14 of 166 columns shown": expands a panel to choose, order and pin the columns of the view. */
export function ColumnsPanel(props: Props & { shown: number }) {
  return (
    <Popover wide label={`${props.shown} of ${FIELDS.length} columns shown`}>
      {(close) => <Body {...props} close={close} />}
    </Popover>
  );
}
