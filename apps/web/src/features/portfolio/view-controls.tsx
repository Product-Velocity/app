"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  FIELDS, FIELD_BY_KEY, filterSummary, groupableFields, opsFor, optionsFor, parseDate, type Filter, type FilterOp, type ViewDef, type ViewName,
} from "@pv/domain";
import { useWorkspace } from "../workspace/provider";
import type { SavedView } from "../workspace/store";
import { Popover } from "./popover";
import type { BaseView } from "./grid-view";
import type { Lookups } from "./types";

// ------------------------------------------------------------------ filters
function valueControl(f: Filter, lookups: Lookups, today: Date, onValue: (v: string) => void) {
  const def = FIELD_BY_KEY[f.field];
  if (!def || f.op === "empty" || f.op === "not_empty") return null;
  const label = `Value for ${def.name}`;
  let options: { value: string; label: string }[] | null = null;
  if (def.key === "home_project") options = lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  else if (def.type === "Person") options = [{ value: "me", label: "me" }, ...lookups.members.map((m) => ({ value: m.user_id, label: m.email }))];
  else if (def.type === "Boolean") options = [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }];
  else if (def.type === "Select" && def.allowed.length > 0) options = optionsFor(def.key);
  if (options) {
    return (
      <select aria-label={label} value={f.value ?? ""} onChange={(e) => onValue(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (def.type === "Date") return <DateValue label={label} value={f.value ?? ""} today={today} onValue={onValue} />;
  return <input aria-label={label} value={f.value ?? ""} placeholder={def.type === "Number" || def.type === "Currency" ? "a number" : "text"} onChange={(e) => onValue(e.target.value)} />;
}

/** A date typed in plain words (31 mar, q2, next friday); the filter stores the date. */
function DateValue({ label, value, today, onValue }: { label: string; value: string; today: Date; onValue: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="filter-date">
      <input
        aria-label={label}
        value={text}
        placeholder="31 mar, q2, next friday"
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === "") { setError(null); onValue(""); return; }
          const r = parseDate(e.target.value, today, { edge: "start" });
          if (r.ok) { setError(null); onValue(r.iso ?? ""); } else setError(r.error ?? "Could not read that date.");
        }}
      />
      {error ? <span className="quick-add-error">{error}</span> : value && <span className="muted"> = {value}</span>}
    </span>
  );
}

export function FiltersMenu({ filters, onChange, lookups, today }: { filters: Filter[]; onChange: (f: Filter[]) => void; lookups: Lookups; today: Date }) {
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const patch = (i: number, p: Partial<Filter>) => onChange(filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <Popover label={<>Filters{filters.length > 0 && <strong className="count-badge"> {filters.length}</strong>}</>} active={filters.length > 0}>
      {() => (
        <div className="filters-panel" role="group" aria-label="Filters">
          {filters.length === 0 && <p className="muted">No filters. Items must match all filters you add.</p>}
          {filters.map((f, i) => {
            const ops = FIELD_BY_KEY[f.field] ? opsFor(FIELD_BY_KEY[f.field]!) : [];
            return (
              <div key={i} className="filter-row">
                <select
                  aria-label={`Field of filter ${i + 1}`}
                  value={f.field}
                  onChange={(e) => { const d = FIELD_BY_KEY[e.target.value]!; patch(i, { field: d.key, op: opsFor(d)[0]!.op, value: "" }); }}
                >
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>{FIELDS.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</optgroup>
                  ))}
                </select>
                <select aria-label={`Operator of filter ${i + 1}`} value={f.op} onChange={(e) => patch(i, { op: e.target.value as FilterOp })}>
                  {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select>
                {valueControl(f, lookups, today, (v) => patch(i, { value: v }))}
                <button type="button" className="tool-btn" aria-label={`Remove filter ${i + 1}`} onClick={() => onChange(filters.filter((_, j) => j !== i))}>Remove</button>
              </div>
            );
          })}
          <div className="filters-actions">
            <button type="button" className="tool-btn" onClick={() => onChange([...filters, { field: "moscow", op: "is", value: "" }])}>+ Add filter</button>
            {filters.length > 0 && <button type="button" className="tool-btn" onClick={() => onChange([])}>Clear filters</button>}
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Words for a chip row or the palette. */
export const summarize = (f: Filter, lookups: Lookups) =>
  filterSummary(f, {
    person: (id) => (id === "me" ? "me" : lookups.members.find((m) => m.user_id === id)?.email ?? id),
    project: (id) => lookups.projects.find((p) => p.id === id)?.name ?? id,
  });

// ----------------------------------------------------------------- grouping
export function GroupMenu({ groupBy, onChange }: { groupBy: string | null; onChange: (g: string | null) => void }) {
  const fields = groupableFields();
  return (
    <Popover label={<>Group by{groupBy && <strong className="count-badge"> {FIELD_BY_KEY[groupBy]?.name}</strong>}</>} active={!!groupBy}>
      {(close) => (
        <div className="group-panel" role="menu" aria-label="Group by">
          <button type="button" role="menuitemradio" aria-checked={groupBy === null} className="scope-item" onClick={() => { onChange(null); close(); }}>No grouping</button>
          {fields.map((f) => (
            <button key={f.key} type="button" role="menuitemradio" aria-checked={groupBy === f.key} className="scope-item" onClick={() => { onChange(f.key); close(); }}>
              {f.name}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

// -------------------------------------------------------------------- views
function NameDialog({ title, initial, action, onClose, onSubmit, offerCustomerSafe = false }: { title: string; initial: string; action: string; onClose: () => void; onSubmit: (name: string, customerSafe: boolean) => Promise<string | null>; offerCustomerSafe?: boolean }) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [safe, setSafe] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = async () => {
    if (busy || name.trim() === "") return;
    setBusy(true);
    const err = await onSubmit(name, safe);
    setBusy(false);
    if (err) setError(err); else onClose();
  };
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>{title}</h2>
        <label htmlFor={`${id}-n`} className="dialog-label">Name</label>
        <input id={`${id}-n`} ref={ref} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        {offerCustomerSafe && (
          <label className="columns-item dialog-check">
            <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />
            Customer-safe view
            <span className="muted"> — only fields allowed in customer reports (never value, confidence, customers, decisions, key results, outcomes or markets). Other columns, filters and grouping are left out.</span>
          </label>
        )}
        {error && <p role="alert" className="quick-add-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || name.trim() === ""} onClick={() => void submit()}>{action}</button>
        </div>
      </div>
    </div>
  );
}

type ViewsProps = {
  base: BaseView;
  views: SavedView[];
  defaults: Partial<Record<ViewName, SavedView>>;
  def: ViewDef;
  dirty: boolean;
  onOpen: (b: BaseView) => void;
};

/** Saved views: open one, save the current columns, filters and grouping as a new view, update, rename or delete. */
export function ViewsMenu({ base, views, defaults, def, dirty, onOpen }: ViewsProps) {
  const { store, reload, canEdit } = useWorkspace();
  const [dialog, setDialog] = useState<null | "new" | "rename">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = base.kind === "saved" ? views.find((v) => v.id === base.id) : undefined;
  const builtin = base.kind === "builtin" ? base.name : null;
  const customised = builtin ? defaults[builtin] : undefined;

  return (
    <>
      <Popover label={<>Views{current && <strong className="count-badge"> {current.name}</strong>}</>} active={!!current} align="right">
        {(close) => (
          <div className="views-panel" role="menu" aria-label="Saved views">
            <p className="scope-head">Saved views</p>
            {views.length === 0 && <p className="scope-empty">None yet. Set up columns, filters and grouping, then save them.</p>}
            {views.map((v) => (
              <button key={v.id} type="button" role="menuitemradio" aria-checked={base.kind === "saved" && base.id === v.id} className="scope-item" onClick={() => { onOpen({ kind: "saved", id: v.id }); close(); }}>
                <span>{v.name}{v.customerSafe && <span className="muted"> · customer-safe</span>}</span><span className="scope-meta">{base.kind === "saved" && base.id === v.id ? "✓" : ""}</span>
              </button>
            ))}
            {canEdit && (
              <div className="views-actions">
                <button type="button" role="menuitem" className="scope-item" onClick={() => { close(); setDialog("new"); }}>Save current view as new…</button>
                {builtin && (
                  <>
                    <button type="button" role="menuitem" className="scope-item" disabled={!dirty} onClick={async () => {
                      const r = await store.saveDefaultView(builtin, def);
                      close();
                      if (r.ok) { await reload(); setMessage(null); } else setMessage(r.error);
                    }}>Change the default “{builtin}” for everyone</button>
                    {customised && (
                      <button type="button" role="menuitem" className="scope-item" onClick={async () => {
                        const r = await store.restoreDefaultView(builtin);
                        close();
                        if (r.ok) { await reload(); setMessage(null); } else setMessage(r.error);
                      }}>Restore the original “{builtin}”</button>
                    )}
                  </>
                )}
                {current && (
                  <>
                    <button type="button" role="menuitem" className="scope-item" disabled={!dirty} onClick={async () => {
                      const r = await store.updateView(current.id, def);
                      close();
                      if (r.ok) { await reload(); setMessage(null); } else setMessage(r.error);
                    }}>Update “{current.name}” with the current view</button>
                    <button type="button" role="menuitem" className="scope-item" onClick={() => { close(); setDialog("rename"); }}>Rename “{current.name}”…</button>
                    <button type="button" role="menuitem" className="scope-item" onClick={() => { close(); setConfirmDelete(true); }}>Delete “{current.name}”…</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Popover>
      {message && <span role="alert" className="quick-add-error"> {message}</span>}
      {dialog === "new" && (
        <NameDialog
          title="Save view" initial="" action="Save view" onClose={() => setDialog(null)} offerCustomerSafe
          onSubmit={async (name, customerSafe) => {
            const r = await store.createView(name, { ...def, customerSafe });
            if (!r.ok) return r.error;
            await reload();
            onOpen({ kind: "saved", id: r.value.id });
            return null;
          }}
        />
      )}
      {dialog === "rename" && current && (
        <NameDialog
          title="Rename view" initial={current.name} action="Rename" onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const r = await store.updateView(current.id, { name });
            if (!r.ok) return r.error;
            await reload();
            return null;
          }}
        />
      )}
      {confirmDelete && current && (
        <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") setConfirmDelete(false); }}>
          <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-label="Delete view">
            <h2>Delete “{current.name}”?</h2>
            <p className="muted">The view is removed for everyone in the workspace. Items are not affected.</p>
            <div className="dialog-actions">
              <button type="button" className="btn" autoFocus onClick={() => setConfirmDelete(false)}>Keep it</button>
              <button type="button" className="btn btn-danger" onClick={async () => {
                const r = await store.deleteView(current.id);
                setConfirmDelete(false);
                if (r.ok) { await reload(); onOpen({ kind: "builtin", name: "Prioritisation" }); } else setMessage(r.error);
              }}>Yes, delete view</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
