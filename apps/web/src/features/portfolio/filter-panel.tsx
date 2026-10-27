"use client";

import {
  customFilters, FIELDS, FIELD_BY_KEY, fieldOptions, opsFor, optionsFor, QUICK_FILTERS, quickFilterOn, toggleQuickFilter,
  type Filter, type FilterOp, type ListOption,
} from "@pv/domain";
import { SelectField } from "@/components/search-list";
import { Popover } from "./popover";
import { valueControl } from "./view-controls";
import type { Lookups } from "./types";

const FIELD_OPTIONS: ListOption[] = fieldOptions(FIELDS);
const ICON: Record<string, string> = {
  "created-today": "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4", "created-week": "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4", "created-month": "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  mine: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0", "high-impact": "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.4l6-.8z",
  attention: "M12 3 2 20h20zM12 10v5M12 18v.5", "in-progress": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
};

/** The choices a field offers for "is any of": its list, people (with "me"), projects or yes and no. */
function choicesFor(field: string, lookups: Lookups): { value: string; label: string }[] {
  const def = FIELD_BY_KEY[field];
  if (!def) return [];
  if (def.key === "home_project") return lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  if (def.type === "Person") return [{ value: "me", label: "me" }, ...lookups.members.map((m) => ({ value: m.user_id, label: m.email }))];
  return optionsFor(def.key);
}

/** Several values for one rule: tags with a ×, and a list to add another. */
function MultiValue({ filter, index, lookups, onChange }: { filter: Filter; index: number; lookups: Lookups; onChange: (values: string[]) => void }) {
  const all = choicesFor(filter.field, lookups);
  const values = filter.values ?? [];
  const label = (v: string) => all.find((o) => o.value === v)?.label ?? v;
  const left = all.filter((o) => !values.includes(o.value));
  return (
    <span className="multi" role="group" aria-label={`Values of filter ${index + 1}`}>
      {values.map((v) => (
        <span key={v} className="multi-tag">
          {label(v)}
          <button type="button" aria-label={`Remove ${label(v)}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg>
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select aria-label={`Add a value to filter ${index + 1}`} value="" onChange={(e) => { if (e.target.value) onChange([...values, e.target.value]); }}>
          <option value="">{values.length === 0 ? "Choose values…" : "Add…"}</option>
          {left.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </span>
  );
}

type Props = {
  filters: Filter[];
  onChange: (f: Filter[]) => void;
  lookups: Lookups;
  today: Date;
  /** How many initiatives match right now, and how many there are in all. */
  matching: number;
  total: number;
};

/**
 * Filters, as a panel that expands from the bar: one-click quick filters, and rules that must all match (AND). A rule has a field, an
 * operator that fits it and a value; several values in one rule match any of them. Filters apply as you go. Rules without a value are ignored.
 */
export function FilterPanel({ filters, onChange, lookups, today, matching, total }: Props) {
  const custom = customFilters(filters).map((f) => ({ f, i: filters.indexOf(f) })).filter((x) => x.i >= 0);
  const patch = (i: number, p: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const n = filters.length;
  return (
    <Popover wide label={n === 0 ? "Add filter" : `${n} ${n === 1 ? "filter" : "filters"}`} active={n > 0}>
      {(close) => (
        <div role="group" aria-label="Filters">
          <div className="panel-section">
            <div className="panel-head"><h2>Quick filters</h2><span className="panel-note">One click, combined with AND. Click again to remove.</span></div>
            <div className="qf-row">
              {QUICK_FILTERS.map((q) => {
                const on = quickFilterOn(filters, q);
                return (
                  <button key={q.id} type="button" className="qf" aria-pressed={on} title={q.hint} onClick={() => onChange(toggleQuickFilter(filters, q))}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={ICON[q.id]} /></svg>
                    {q.label}
                    {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}
                  </button>
                );
              })}
            </div>
            <p className="panel-note">{QUICK_FILTERS.map((q) => `${q.label}: ${q.hint}`).join(" · ")}.</p>
          </div>
          <hr className="panel-rule" />
          <div className="panel-section">
            <div className="panel-head"><h2>Custom rules</h2><span className="panel-note">An initiative must match every rule (AND). Several values in one rule match any of them.</span></div>
            {custom.length === 0 && <p className="panel-note">No custom rules yet.</p>}
            {custom.map(({ f, i }, k) => {
              const def = FIELD_BY_KEY[f.field];
              const ops = def ? opsFor(def) : [];
              return (
                <div key={i}>
                  {k > 0 && <p className="rule-and">AND</p>}
                  <div className="rule-row filter-row">
                    <span className="where">where</span>
                    <SelectField
                      label={`Field of filter ${i + 1}`} value={f.field} options={FIELD_OPTIONS}
                      onChange={(v) => { const d = FIELD_BY_KEY[v]!; patch(i, { field: d.key, op: opsFor(d)[0]!.op, value: "", value2: undefined, values: undefined }); }}
                    />
                    <select
                      aria-label={`Operator of filter ${i + 1}`} value={f.op}
                      onChange={(e) => {
                        const op = e.target.value as FilterOp;
                        const days = (o: string) => o === "in_last" || o === "in_next";
                        patch(i, { op, value2: undefined, ...(op === "any_of" ? { values: f.value ? [f.value] : f.values ?? [] } : { values: undefined }), ...(days(op) || days(f.op) ? { value: "" } : {}) });
                      }}
                    >
                      {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                    </select>
                    {f.op === "any_of"
                      ? <MultiValue filter={f} index={i} lookups={lookups} onChange={(values) => patch(i, { values })} />
                      : valueControl(f, lookups, today, (p) => patch(i, p))}
                    <button type="button" className="icon-btn" aria-label={`Remove filter ${i + 1}`} title="Remove this rule" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                    </button>
                  </div>
                </div>
              );
            })}
            <div>
              <button type="button" className="btn" onClick={() => onChange([...filters, { field: "moscow", op: "is", value: "" }])}>+ Add rule</button>
              <span className="panel-note"> A rule without a value is ignored.</span>
            </div>
          </div>
          <div className="panel-foot">
            <span><strong>{matching.toLocaleString("en-GB")}</strong> of {total.toLocaleString("en-GB")} initiatives match</span>
            <span className="panel-note">Applied as you go</span>
            <span className="grow" />
            {n > 0 && <button type="button" className="btn btn-link" onClick={() => onChange([])}>Clear all</button>}
            <button type="button" className="btn btn-primary" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </Popover>
  );
}
