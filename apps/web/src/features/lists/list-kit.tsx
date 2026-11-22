"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * The parts Needs attention and Decisions share (issue: both screens as AG Grid lists, Ashu 2026-11-22): remembered choices, a search box, filter pop-ups with counts,
 * a column picker, saved views and a CSV download. What a person chooses is kept in their own browser (a convenience, not shared), so every access to storage is
 * guarded and the screens work without it.
 */
export function usePersisted<T>(key: string, fallback: T, valid: (v: unknown) => v is T = (v): v is T => v !== undefined): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const v = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown; return v !== null && valid(v) ? v : fallback; } catch { return fallback; }
  });
  const set = useCallback((u: T | ((p: T) => T)) => {
    setValue((prev) => {
      const next = typeof u === "function" ? (u as (p: T) => T)(prev) : u;
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window or blocked storage: the choice is just not remembered */ }
      return next;
    });
  }, [key]);
  return [value, set];
}

/** Gives the person a text file (a CSV of what they see). Nothing is uploaded. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A button that opens a small panel under it; closes on Escape or a click outside. */
export function Popover({ label, active, children, align = "left" }: { label: ReactNode; active?: boolean; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className="lst-pop" ref={box}>
      <button type="button" className={`lst-btn${active ? " is-on" : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{label} <span aria-hidden="true">▾</span></button>
      {open && <div id={id} role="group" className={`lst-panel${align === "right" ? " lst-panel-right" : ""}`}>{children}</div>}
    </div>
  );
}

/** A filter with the values it can take and how many rows each has: pick any number. */
export function MultiFilter<T extends string>({ label, options, selected, onChange }: { label: string; options: readonly { value: T; label?: string; count?: number }[]; selected: readonly T[]; onChange: (v: T[]) => void }) {
  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover label={<>{label}{selected.length > 0 && <span className="lst-count"> ({selected.length})</span>}</>} active={selected.length > 0}>
      {options.length === 0 ? <p className="muted lst-empty">Nothing to filter by.</p> : (
        <ul className="lst-options">
          {options.map((o) => (
            <li key={o.value}>
              <label><input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} /> <span>{o.label ?? o.value}</span>{o.count !== undefined && <span className="muted lst-n">{o.count}</span>}</label>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && <button type="button" className="link-button" onClick={() => onChange([])}>Clear {label.toLowerCase()}</button>}
    </Popover>
  );
}

/** Show or hide columns. `fixed` columns (the name, the buttons) are not offered. */
export function ColumnPicker({ columns, hidden, onChange, onReset }: { columns: readonly { id: string; name: string }[]; hidden: readonly string[]; onChange: (hidden: string[]) => void; onReset: () => void }) {
  return (
    <Popover label="Columns" align="right" active={hidden.length > 0}>
      <ul className="lst-options">
        {columns.map((c) => (
          <li key={c.id}><label><input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => onChange(hidden.includes(c.id) ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} /> <span>{c.name}</span></label></li>
        ))}
      </ul>
      <button type="button" className="link-button" onClick={onReset}>Show the default columns</button>
    </Popover>
  );
}

export type SavedView<T> = { name: string; state: T };
/** Named sets of filters kept in this browser. `current` is what is applied now; choosing a view applies it. */
export function SavedViews<T>({ storeKey, current, onApply, builtIn = [] }: { storeKey: string; current: T; onApply: (s: T) => void; builtIn?: readonly SavedView<T>[] }) {
  const [views, setViews] = usePersisted<SavedView<T>[]>(storeKey, [], (v): v is SavedView<T>[] => Array.isArray(v));
  const [name, setName] = useState("");
  const save = () => {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    setViews((vs) => [...vs.filter((v) => v.name !== n), { name: n, state: current }]);
    setName("");
  };
  return (
    <Popover label="Views">
      <ul className="lst-options lst-views">
        {builtIn.map((v) => <li key={`b-${v.name}`}><button type="button" className="link-button" onClick={() => onApply(v.state)}>{v.name}</button></li>)}
        {views.map((v) => (
          <li key={v.name}>
            <button type="button" className="link-button" onClick={() => onApply(v.state)}>{v.name}</button>
            <button type="button" className="lst-x" aria-label={`Delete the view ${v.name}`} onClick={() => setViews((vs) => vs.filter((x) => x.name !== v.name))}>×</button>
          </li>
        ))}
      </ul>
      {views.length === 0 && builtIn.length === 0 && <p className="muted lst-empty">No saved views yet.</p>}
      <form className="lst-save" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="Name for the view" maxLength={40} />
        <button type="submit" className="btn" disabled={!name.trim()}>Save</button>
      </form>
      <p className="muted lst-empty">Saved in this browser: filters, search and columns.</p>
    </Popover>
  );
}

/** The search box: `/` focuses it from anywhere on the screen. */
export function ListSearch({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault(); ref.current?.focus();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="lst-search">
      <input ref={ref} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} onKeyDown={(e) => { if (e.key === "Escape") { onChange(""); e.currentTarget.blur(); } }} />
    </div>
  );
}
