"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  FIELD_BY_KEY, fieldOptions, filterOptions, filterSummary, groupableFields, needsSearch, optionsFor, type Filter, type ListOption, type ViewDef, type ViewName,
} from "@pv/domain";
import { menuSearchKeys, NoResults, SearchInput, SelectField } from "@/components/search-list";
import { DateInput } from "@/components/date-input";
import { useWorkspace } from "../workspace/provider";
import type { SavedView } from "../workspace/store";
import { Popover } from "./popover";
import type { BaseView } from "./grid-view";
import type { Lookups } from "./types";

// ------------------------------------------------------------------ filters
export function valueControl(f: Filter, lookups: Lookups, today: Date, patch: (p: Partial<Filter>) => void) {
  const onValue = (v: string) => patch({ value: v });
  const def = FIELD_BY_KEY[f.field];
  if (!def || f.op === "empty" || f.op === "not_empty") return null;
  const label = `Value for ${def.name}`;
  let options: { value: string; label: string }[] | null = null;
  if (def.key === "home_project") options = lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  else if (def.type === "Person") options = [{ value: "me", label: "me" }, ...lookups.members.map((m) => ({ value: m.user_id, label: m.email }))];
  else if (def.type === "Boolean") options = [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }];
  else if (def.type === "Select" && def.allowed.length > 0) options = optionsFor(def.key);
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

// -------------------------------------------------------------------- views
export function NameDialog({ title, initial, action, onClose, onSubmit, offerCustomerSafe = false }: { title: string; initial: string; action: string; onClose: () => void; onSubmit: (name: string, customerSafe: boolean) => Promise<string | null>; offerCustomerSafe?: boolean }) {
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

/** The saved views to open, with a search box once there are more than 8 (its text resets when the menu closes). */
function ViewsList({ views, base, onOpen, children }: { views: SavedView[]; base: BaseView; onOpen: (b: BaseView) => void; children?: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const shown = filterOptions(views.map((v) => ({ view: v, label: v.name })), query);
  return (
    <>
      {needsSearch(views.length) && <SearchInput value={query} onChange={setQuery} label="Search saved views" onKeyDown={menuSearchKeys} />}
      <div role="menu" aria-label="Saved views">
      <p className="scope-head">Saved views</p>
      {views.length === 0 && <p className="scope-empty">None yet. Set up columns, filters and grouping, then save them.</p>}
      {shown.map(({ view: v }) => (
        <button key={v.id} type="button" role="menuitemradio" aria-checked={base.kind === "saved" && base.id === v.id} className="scope-item" onClick={() => onOpen({ kind: "saved", id: v.id })}>
          <span>{v.name}{v.customerSafe && <span className="muted"> · customer-safe</span>}</span><span className="scope-meta">{base.kind === "saved" && base.id === v.id ? "✓" : ""}</span>
        </button>
      ))}
      {views.length > 0 && shown.length === 0 && <NoResults query={query} />}
      {children}
      </div>
    </>
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
          <div className="views-panel">
            <ViewsList views={views} base={base} onOpen={(b) => { onOpen(b); close(); }}>
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
            </ViewsList>
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

/**
 * Saving the current columns, filters and grouping from a panel (filters, columns): the same choices as the Views menu, so every panel that
 * changes the view can end with "Save to this view". `save(def)` writes the given definition (the columns panel passes its staged one).
 */
export function useViewSaver(base: BaseView, views: SavedView[], onOpen: (b: BaseView) => void) {
  const { store, reload, canEdit } = useWorkspace();
  const [dialog, setDialog] = useState<null | ViewDef>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = base.kind === "saved" ? views.find((v) => v.id === base.id) : undefined;
  const builtin = base.kind === "builtin" ? base.name : null;
  const dialogs = dialog ? (
    <NameDialog
      title="Save view" initial="" action="Save view" onClose={() => setDialog(null)} offerCustomerSafe
      onSubmit={async (name, customerSafe) => {
        const r = await store.createView(name, { ...dialog, customerSafe });
        if (!r.ok) return r.error;
        await reload();
        onOpen({ kind: "saved", id: r.value.id });
        return null;
      }}
    />
  ) : null;
  return {
    canSave: canEdit,
    /** The name of the saved view that "Save to this view" overwrites, if the view in use is a saved one. */
    currentName: current?.name ?? null,
    builtinName: builtin,
    message,
    dialogs,
    saveAsNew: (def: ViewDef) => { setMessage(null); setDialog(def); },
    /** Overwrites the saved view in use, or the workspace's default view of that name, with `def`. */
    saveHere: async (def: ViewDef): Promise<boolean> => {
      const r = current ? await store.updateView(current.id, def) : builtin ? await store.saveDefaultView(builtin, def) : null;
      if (!r) return false;
      if (r.ok) { await reload(); setMessage(null); return true; }
      setMessage(r.error);
      return false;
    },
  };
}
