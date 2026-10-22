"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useGridCellEditor, type CustomCellEditorProps } from "ag-grid-react";

export type PickerOption = { value: string; label: string };
type Props = CustomCellEditorProps<unknown, string | null> & { options: PickerOption[]; allowEmpty?: boolean; emptyLabel?: string };

/**
 * Typed picker: start typing to filter, arrows to move, Enter to choose, Esc to cancel.
 * The highlighted option is the value, so Enter (handled by the grid) saves it.
 */
export function PickerEditor({ value, onValueChange, stopEditing, options, allowEmpty = false, emptyLabel = "None", eventKey }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const all = useMemo<PickerOption[]>(() => (allowEmpty ? [{ value: "", label: emptyLabel }, ...options] : options), [options, allowEmpty, emptyLabel]);
  const startQuery = eventKey && eventKey.length === 1 ? eventKey : "";
  const [query, setQuery] = useState(startQuery);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? all : all.filter((o) => o.label.toLowerCase().includes(q));
  }, [all, query]);
  const [active, setActive] = useState(() => {
    if (startQuery) return 0;
    const i = all.findIndex((o) => o.value === (value ?? ""));
    return i >= 0 ? i : 0;
  });

  useGridCellEditor({ focusIn: () => inputRef.current?.focus() });
  useEffect(() => {
    inputRef.current?.focus();
    if (startQuery && shown[0]) onValueChange(shown[0].value);
    // run once when the editor opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (i: number) => {
    const opt = shown[i];
    if (!opt) return;
    setActive(i);
    onValueChange(opt.value === "" ? null : opt.value);
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-label="Choose an option, type to filter"
        value={query}
        placeholder={all.find((o) => o.value === (value ?? ""))?.label ?? ""}
        onChange={(e) => {
          setQuery(e.target.value);
          const q = e.target.value.trim().toLowerCase();
          const next = q === "" ? all : all.filter((o) => o.label.toLowerCase().includes(q));
          setActive(0);
          if (next[0]) onValueChange(next[0].value === "" ? null : next[0].value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.stopPropagation(); // keep the grid from moving to another cell
            e.preventDefault();
            const i = Math.max(0, Math.min(shown.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
            choose(i);
          }
        }}
      />
      <ul id={listId} role="listbox" className="picker-list">
        {shown.length === 0 && <li className="picker-empty">No match</li>}
        {shown.map((o, i) => (
          <li
            key={o.value || "__empty"}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={i === active ? "picker-option active" : "picker-option"}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(i);
              stopEditing();
            }}
          >
            {o.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
