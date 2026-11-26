"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { matchSpaces, type SpaceChoice } from "./confluence-tree-utils";

const LAST_KEY = "pv.confluence.lastSpace";
/** The space chosen last time on this browser (a convenience only: it may be missing or blocked). */
export function lastSpaceKey(): string | null { try { return window.localStorage.getItem(LAST_KEY); } catch { return null; } }
function rememberSpace(key: string) { try { window.localStorage.setItem(LAST_KEY, key); } catch { /* not remembered */ } }

/**
 * One box to find a Confluence space: type part of its name or key, pick with the arrow keys and Enter (or a click). It replaces a filter box plus a dropdown.
 * The last space used here is listed first. Shows "Name (KEY)" when closed.
 */
export const ConfluenceSpacePicker = forwardRef<HTMLInputElement, { spaces: SpaceChoice[]; value: string; onChange: (key: string) => void; label?: string }>(function ConfluenceSpacePicker({ spaces, value, onChange, label = "Space" }, ref) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
  const current = spaces.find((s) => s.key === value);
  const text = (s: SpaceChoice | undefined) => (s ? `${s.name} (${s.key})` : "");
  const [query, setQuery] = useState<string | null>(null); // null: not searching, show the chosen space
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { shown, more } = matchSpaces(spaces, query ?? "", lastSpaceKey());
  useEffect(() => { setActive(0); }, [query]);

  const pick = (s: SpaceChoice) => { rememberSpace(s.key); onChange(s.key); setQuery(null); setOpen(false); };
  const close = () => { setQuery(null); setOpen(false); };

  return (
    <div className="space-picker">
      <label className="dialog-label" htmlFor={id}>{label}</label>
      <input
        id={id} ref={inputRef} type="text" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
        aria-activedescendant={open && shown[active] ? `${id}-o${active}` : undefined}
        placeholder={spaces.length === 0 ? "No spaces found" : `Search ${spaces.length} spaces by name or key`}
        value={query ?? text(current)}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(close, 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); pick(shown[active]!); }
          else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
        }}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" className="space-picker-list">
          {shown.length === 0 && <li className="muted space-picker-note" role="presentation">No space matches “{query}”.</li>}
          {shown.map((s, i) => (
            <li key={s.key} id={`${id}-o${i}`} role="option" aria-selected={s.key === value} className={i === active ? "space-picker-on" : undefined} onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}>
              {s.name} <span className="muted">({s.key})</span>{s.key === value ? " ✓" : ""}
            </li>
          ))}
          {more > 0 && <li className="muted space-picker-note" role="presentation">{more} more: keep typing to narrow it down.</li>}
        </ul>
      )}
    </div>
  );
});
