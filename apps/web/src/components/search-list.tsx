"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { filterOptions, needsSearch, type ListOption } from "@pv/domain";
import { useMenuBlur } from "@/features/portfolio/use-menu-blur";
import { useDismiss } from "@/features/portfolio/use-dismiss";

/**
 * Search box for any long list (R-018): focused when the list opens, filters as you type. The caller decides what the
 * Arrow and Enter keys do; `listId` and `activeId` make it a combobox over a listbox for screen readers.
 */
export function SearchInput({ value, onChange, label, placeholder = "Search…", onKeyDown, listId, activeId, inputRef }: {
  value: string; onChange: (v: string) => void; label: string; placeholder?: string; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  listId?: string; activeId?: string; inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  useEffect(() => { ref.current?.focus(); }, [ref]);
  return (
    <input
      ref={ref}
      type="text"
      className="search-input"
      {...(listId ? { role: "combobox", "aria-expanded": true, "aria-controls": listId, "aria-autocomplete": "list" as const, "aria-activedescendant": activeId } : { role: "searchbox" })}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/** Said in words when nothing matches. */
export function NoResults({ query }: { query: string }) {
  return <p role="status" className="search-empty">No results{query.trim() ? ` for “${query.trim()}”` : ""}</p>;
}

/**
 * A list of options to choose one from. With more than 8 options a search box sits on top (focused, filters as you type,
 * case-insensitive, anywhere in the name and its aliases); Up and Down move, Enter picks, Escape is left to the parent.
 */
export function SearchableList({ label, options, value, onPick }: { label: string; options: ListOption[]; value?: string; onPick: (o: ListOption) => void }) {
  const id = useId();
  const search = needsSearch(options.length);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterOptions(options, query), [options, query]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const at = Math.min(active, Math.max(0, shown.length - 1));
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!search) listRef.current?.focus();
  }, [search]);
  useEffect(() => {
    document.getElementById(`${id}-${at}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, at]);

  const move = (to: number, dir: 1 | -1) => {
    let i = Math.max(0, Math.min(shown.length - 1, to));
    while (shown[i]?.disabled && i + dir >= 0 && i + dir < shown.length) i += dir;
    setActive(i);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(at + 1, 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(at - 1, -1); }
    else if (e.key === "Home" && !search) { e.preventDefault(); move(0, 1); }
    else if (e.key === "End" && !search) { e.preventDefault(); move(shown.length - 1, -1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[at];
      if (o && !o.disabled) onPick(o);
    }
  };

  return (
    <div className="sl">
      {search && (
        <SearchInput
          value={query} onChange={(v) => { setQuery(v); setActive(0); }} label={`Search ${label}`} onKeyDown={onKey}
          listId={`${id}-list`} activeId={shown[at] ? `${id}-${at}` : undefined}
        />
      )}
      <ul id={`${id}-list`} ref={listRef} role="listbox" aria-label={label} tabIndex={search ? -1 : 0} className="sl-list" onKeyDown={search ? undefined : onKey} aria-activedescendant={!search && shown[at] ? `${id}-${at}` : undefined}>
        {shown.flatMap((o, i) => {
          const items = [];
          if (!query.trim() && o.group && o.group !== shown[i - 1]?.group) items.push(<li key={`g-${i}`} role="presentation" className="sl-group">{o.group}</li>); // headings only in the full list: a ranked result list is not grouped
          items.push(
            <li
              key={o.value || "__blank"} id={`${id}-${i}`} role="option" data-value={o.value}
              aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
              className={`sl-option${i === at ? " sl-active" : ""}${o.disabled ? " sl-disabled" : ""}`}
              onMouseMove={() => { if (!o.disabled) setActive(i); }}
              onMouseDown={(e) => { e.preventDefault(); if (!o.disabled) onPick(o); }}
            >
              {o.label}{o.value === value ? <span className="sl-check"> ✓</span> : null}
            </li>,
          );
          return items;
        })}
      </ul>
      {shown.length === 0 && <NoResults query={query} />}
    </div>
  );
}

/**
 * A drop-down to choose one value. Up to 8 options it is a plain select; with more it opens a searchable list, so the 167
 * fields, a long list of people or projects can be found by typing. `blank` adds a first "no value" choice.
 */
export function SelectField({ label, value, options, onChange, blank, id, className, disabled }: {
  label: string; value: string; options: ListOption[]; onChange: (v: string) => void; blank?: string; id?: string; className?: string; disabled?: boolean;
}) {
  const auto = useId();
  const triggerId = id ?? `${auto}-t`;
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const menuBlur = useMenuBlur(close);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useDismiss(wrapRef, open, close);

  if (!needsSearch(options.length)) {
    const groups = [...new Set(options.map((o) => o.group).filter((g): g is string => !!g))];
    const opt = (o: ListOption) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>;
    return (
      <select id={triggerId} aria-label={label} className={className} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {groups.length > 0 ? groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map(opt)}</optgroup>) : options.map(opt)}
      </select>
    );
  }
  const all: ListOption[] = blank !== undefined ? [{ value: "", label: blank }, ...options] : options;
  const current = all.find((o) => o.value === value);
  const pick = (o: ListOption) => { onChange(o.value); close(); triggerRef.current?.focus(); };
  return (
    <span
      ref={wrapRef}
      className={`select-field${className ? ` ${className}` : ""}`}
      {...menuBlur}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); triggerRef.current?.focus(); } }}
    >
      <button
        ref={triggerRef} id={triggerId} type="button" className="select-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => {
          const r = triggerRef.current?.getBoundingClientRect();
          if (r) setRect({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 328)) });
          setOpen((o) => !o);
        }}
      >
        <span className="visually-hidden">{label}: </span>{current?.label ?? blank ?? "Choose…"} <span aria-hidden="true">▾</span>
      </button>
      {open && rect && (
        <div className="select-panel" style={{ top: rect.top, left: rect.left }}>
          <SearchableList label={label} options={all} value={value} onPick={pick} />
        </div>
      )}
    </span>
  );
}

/**
 * Keys for the search box on top of a menu made of buttons (role menuitem / menuitemradio): Down and Up go into the menu,
 * Enter chooses the first match. The menu's own items keep their roles; only the search is shared.
 */
export function menuSearchKeys(e: KeyboardEvent<HTMLInputElement>) {
  const items = () => Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []).filter((x) => !(x as HTMLButtonElement).disabled);
  if (e.key === "ArrowDown") { e.preventDefault(); items()[0]?.focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items().at(-1)?.focus(); }
  else if (e.key === "Enter") { e.preventDefault(); items()[0]?.click(); }
}
