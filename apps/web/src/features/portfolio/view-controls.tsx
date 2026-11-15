"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  FIELD_BY_KEY, fieldOptions, filterOptions, filterSummary, groupPickerSections, groupSummary, isOpenList, needsSearch, optionsFor, type Filter,
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
/** What the Group by panel edits: two grouping levels, and the tracker issues shown under each initiative (which types, and whether finished ones are hidden). */
export type GroupState = { groupBy: string | null; thenBy: string | null; showIssues: boolean; /** null: every type */ issueTypes: string[] | null; hideDone: boolean };
export type IssueTypeCount = { type: string; count: number };

/** "Group by: Build Status › Sponsor": the state of the grouping on the button, like Filter and Columns. */
export function GroupMenu({ state, customerSafe = false, issueTypes = [], issuesLoading = false, onOpenIssues, onChange }: {
  state: GroupState; customerSafe?: boolean;
  /** The issue types among the linked issues of the initiatives shown, with counts. */ issueTypes?: IssueTypeCount[]; issuesLoading?: boolean;
  /** The panel opened: the grid reads the issues so the types can be counted. */ onOpenIssues?: () => void;
  onChange: (s: GroupState) => void;
}) {
  return (
    <Popover wide staged label={<>Group by: <strong className="count-badge">{groupSummary(state.groupBy, state.thenBy)}</strong>{state.showIssues ? <span className="muted"> · with issues</span> : null}</>} active={!!state.groupBy || state.showIssues}>
      {(close) => <GroupPanel state={state} customerSafe={customerSafe} issueTypes={issueTypes} issuesLoading={issuesLoading} {...(onOpenIssues ? { onOpenIssues } : {})} onChange={onChange} close={close} />}
    </Popover>
  );
}

const LEVEL_NAME = ["Group by", "Then by"] as const;
const ALL_TAB = "All";

/** Keeps a panel inside what is visible: when the on-screen keyboard opens (iPad), the panel gets shorter and scrolls, so its footer stays in reach. */
function useFitToViewport(ref: RefObject<HTMLElement | null>) {
  const [max, setMax] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current, vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!el) return;
    const fit = () => {
      const height = vv?.height ?? window.innerHeight, offset = vv?.offsetTop ?? 0;
      setMax(Math.max(320, Math.floor(height - (el.getBoundingClientRect().top - offset) - 12)));
    };
    fit();
    vv?.addEventListener("resize", fit); vv?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit); window.addEventListener("scroll", fit, true);
    return () => { vv?.removeEventListener("resize", fit); vv?.removeEventListener("scroll", fit); window.removeEventListener("resize", fit); window.removeEventListener("scroll", fit, true); };
  }, [ref]);
  return max;
}

/** Staged like the Columns panel: choices are made on a draft, nothing changes in the grid until Apply, and the panel stays open until Apply or Cancel. */
function GroupPanel({ state, customerSafe, issueTypes, issuesLoading, onOpenIssues, onChange, close }: {
  state: GroupState; customerSafe: boolean; issueTypes: IssueTypeCount[]; issuesLoading: boolean; onOpenIssues?: () => void; onChange: (s: GroupState) => void; close: () => void;
}) {
  const [draft, setDraft] = useState<GroupState>({ ...state });
  const [query, setQuery] = useState("");
  // opens on the first category (a few rows), not on all 46 fields, so the issues card below stays in sight
  const [tab, setTab] = useState<string>(() => groupPickerSections({ customerSafe }).find((x) => x.category !== "Common")?.category ?? ALL_TAB);
  // which level the next pick fills: the first empty one, else the main one
  const [target, setTarget] = useState<0 | 1>(state.groupBy && !state.thenBy ? 1 : 0);
  const panelRef = useRef<HTMLDivElement>(null);
  const maxHeight = useFitToViewport(panelRef);
  useEffect(() => { onOpenIssues?.(); }, [onOpenIssues]);
  const level = draft.groupBy ? target : 0;
  const names = [draft.groupBy, draft.thenBy] as const;
  const nameOf = (k: string | null) => (k ? groupSummary(k) : null);
  const sections = useMemo(() => groupPickerSections({ customerSafe, taken: level === 0 ? draft.thenBy : draft.groupBy }), [customerSafe, level, draft.thenBy, draft.groupBy]);
  const common = sections.find((x) => x.category === "Common")?.fields ?? [];
  const categories = sections.filter((x) => x.category !== "Common");
  const searching = query.trim() !== "";
  const all = useMemo(() => fieldOptions(sections.flatMap((x) => x.fields)), [sections]);
  const matching = new Set(filterOptions(all, query).map((o) => o.value));
  // searching looks through every field (the Common ones too); otherwise the grid shows the chosen category, the Common ones being the chips above
  const listed = searching ? sections.flatMap((x) => x.fields).filter((f) => matching.has(f.key)) : (tab === ALL_TAB ? categories : categories.filter((x) => x.category === tab)).flatMap((x) => x.fields);
  const mark = (key: string) => (draft.groupBy === key ? "Group by" : draft.thenBy === key ? "Then by" : null);

  const pick = (key: string) => {
    if (level === 0) {
      if (draft.groupBy === key) { clear(0); return; }
      setDraft({ ...draft, groupBy: key, thenBy: draft.thenBy === key ? null : draft.thenBy });
      setTarget(1);
    } else if (draft.thenBy === key) clear(1);
    else setDraft({ ...draft, thenBy: key });
  };
  /** Removing the main level promotes the second one. */
  const clear = (l: 0 | 1) => { if (l === 1) setDraft({ ...draft, thenBy: null }); else { setDraft({ ...draft, groupBy: draft.thenBy, thenBy: null }); setTarget(0); } };
  const swap = () => setDraft({ ...draft, groupBy: draft.thenBy, thenBy: draft.groupBy });

  // ---- the issues
  const present = issueTypes.map((t) => t.type);
  const selected = draft.issueTypes ?? present;
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const setTypes = (types: string[]) => setDraft({ ...draft, issueTypes: types.length === 0 || sameSet(types, present) ? null : types });
  const toggleType = (t: string) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    if (next.length > 0) setTypes(next); // at least one type stays
  };
  const presets: { label: string; types: string[] | null }[] = [
    { label: "Everything", types: null },
    ...(present.includes("Epic") ? [{ label: "Epics only", types: ["Epic"] }] : []),
    ...(present.includes("Bug") && present.length > 1 ? [{ label: "Without bugs", types: present.filter((t) => t !== "Bug") }] : []),
  ];
  const isPreset = (types: string[] | null) => sameSet(types ?? present, selected);
  const typesText = draft.issueTypes === null ? "all issue types" : draft.issueTypes.join(", ");
  const summary = `${draft.groupBy ? `Grouped by ${groupSummary(draft.groupBy, draft.thenBy)}` : "Not grouped"}${draft.showIssues ? ` · showing ${typesText}${draft.hideDone ? ", hiding Done and Cancelled" : ""}` : ""}`;

  return (
    <div ref={panelRef} role="group" aria-label="Group by" className="gp gp-wide" style={maxHeight ? { maxHeight } : undefined}>
      <div className="gp-head"><b>Group and show</b><span className="panel-note" aria-live="polite">{summary}</span></div>
      <div className="gp-body">
        <div className="gp-slots" role="group" aria-label="Grouping levels">
          {([0, 1] as const).map((l) => {
            const value = names[l];
            const off = l === 1 && !draft.groupBy;
            return (
              <div key={l} className="gp-slot" data-active={!off && level === l} data-empty={!value}>
                <button type="button" className="gp-slot-main" aria-label={`Choose the field for ${LEVEL_NAME[l]}: ${nameOf(value) ?? "none yet"}`} aria-pressed={!off && level === l} disabled={off} onClick={() => setTarget(l)} title={off ? "Choose the main grouping first" : `Pick the field for “${LEVEL_NAME[l]}” below`}>
                  <span className="gp-slot-n" aria-hidden="true">{l + 1}</span>
                  <span className="gp-slot-text">
                    <span className="gp-slot-label">{LEVEL_NAME[l]}</span>
                    <span className="gp-slot-val">{nameOf(value) ?? (off ? "—" : "Pick a field below")}</span>
                  </span>
                </button>
                {value && <button type="button" className="icon-btn" aria-label={`Remove ${LEVEL_NAME[l]} ${nameOf(value)}`} onClick={() => clear(l)}><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg></button>}
              </div>
            );
          })}
          {draft.groupBy && draft.thenBy && <button type="button" className="btn btn-link" onClick={swap} aria-label={`Swap: group by ${nameOf(draft.thenBy)}, then by ${nameOf(draft.groupBy)}`}>Swap order</button>}
        </div>

        <div className="gp-picker">
          {!searching && common.length > 0 && (
            <div role="group" aria-label="Common fields">
              <p className="gp-label">Common</p>
              <div className="gp-chips">
                {common.map((f) => (
                  <button key={f.key} type="button" role="menuitemradio" aria-checked={mark(f.key) !== null} className="gp-chip" data-on={mark(f.key) !== null} onClick={() => pick(f.key)}>{f.name}</button>
                ))}
              </div>
            </div>
          )}
          {needsSearch(all.length) && <SearchInput value={query} onChange={setQuery} label="Search group by options" placeholder={`Search the ${all.length} fields…`} onKeyDown={menuSearchKeys} />}
          {!searching && (
            <div className="gp-tabs" role="group" aria-label="Field categories">
              {[...categories.map((x) => x.category), ALL_TAB].map((c) => (
                <button key={c} type="button" className="gp-tab" aria-pressed={tab === c} onClick={() => setTab(c)}>{c}</button>
              ))}
            </div>
          )}
          <div className="gp-fields" role="group" aria-label={searching ? "Matching fields" : tab === ALL_TAB ? "All fields" : tab}>
            {listed.map((f) => {
              const m = mark(f.key);
              return (
                <button key={f.key} type="button" role="menuitemradio" aria-checked={m !== null} className="gp-field" onClick={() => pick(f.key)}>
                  <span>{f.name}</span>{m && <span className="gp-mark">{m}</span>}
                </button>
              );
            })}
          </div>
          {searching && listed.length === 0 && <NoResults query={query} />}
        </div>

        {!customerSafe && (
          <div className="gp-card" data-on={draft.showIssues}>
            <label className="gp-switch-row">
              <input type="checkbox" role="switch" className="sw-input" checked={draft.showIssues} onChange={(e) => setDraft({ ...draft, showIssues: e.target.checked })} />
              <span><b>Show issues under each initiative</b><span className="gp-sub">Epics, stories and tasks from Jira or GitHub</span></span>
            </label>
            {draft.showIssues && (
              <div className="gp-card-body">
                <div>
                  <p className="gp-label">Show these types</p>
                  {issueTypes.length === 0 ? (
                    <p className="panel-note" role="status">{issuesLoading ? "Reading the linked issues…" : "No linked issues found for the initiatives shown."}</p>
                  ) : (
                    <div className="gp-chips" role="group" aria-label="Issue types">
                      {issueTypes.map((t) => (
                        <button key={t.type} type="button" className="gp-chip" aria-pressed={selected.includes(t.type)} data-on={selected.includes(t.type)} onClick={() => toggleType(t.type)}>
                          {selected.includes(t.type) ? <span aria-hidden="true">✓ </span> : null}{t.type} <span className="gp-n">{t.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="gp-card-row">
                  {issueTypes.length > 0 && (
                    <div className="gp-chips" role="group" aria-label="Presets">
                      {presets.map((p) => <button key={p.label} type="button" className="gp-chip gp-preset" aria-pressed={isPreset(p.types)} data-on={isPreset(p.types)} onClick={() => setDraft({ ...draft, issueTypes: p.types })}>{p.label}</button>)}
                    </div>
                  )}
                  <label className="gp-switch-row gp-switch-inline">
                    <span>Hide Done and Cancelled</span>
                    <input type="checkbox" role="switch" className="sw-input" checked={draft.hideDone} onChange={(e) => setDraft({ ...draft, hideDone: e.target.checked })} />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="gp-foot">
        <button type="button" className="btn btn-link" onClick={() => { setDraft({ groupBy: null, thenBy: null, showIssues: false, issueTypes: null, hideDone: false }); setTarget(0); }}>Clear</button>
        <span className="panel-note grow">Nothing changes in the grid until you press Apply.</span>
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => { onChange(draft); close(); }}>Apply</button>
      </div>
    </div>
  );
}
