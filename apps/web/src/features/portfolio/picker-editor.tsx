"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { nearDuplicates } from "@pv/domain";
import { useGridCellEditor, type CustomCellEditorProps } from "ag-grid-react";

export type PickerOption = { value: string; label: string };
type Props = CustomCellEditorProps<unknown, string | null> & {
  options: PickerOption[]; allowEmpty?: boolean; emptyLabel?: string;
  /** An open list: a typed name that is not in the list can be created ("Create “name”"), with a hint about look-alikes. */
  allowCreate?: boolean;
};

/**
 * Typed picker: start typing to filter, arrows to move, Enter to choose, Esc to cancel.
 * The highlighted option is the value, so Enter (handled by the grid) saves it.
 */
export function PickerEditor({ value, onValueChange, stopEditing, options, allowEmpty = false, emptyLabel = "None", allowCreate = false, eventKey }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const all = useMemo<PickerOption[]>(() => (allowEmpty ? [{ value: "", label: emptyLabel }, ...options] : options), [options, allowEmpty, emptyLabel]);
  const startQuery = eventKey && eventKey.length === 1 ? eventKey : "";
  const [query, setQuery] = useState(startQuery);
  const typed = query.replace(/\s+/g, " ").trim();
  const canCreate = allowCreate && typed !== "" && !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q === "" ? all : all.filter((o) => o.label.toLowerCase().includes(q));
    return canCreate ? [...found, { value: typed, label: `Create “${typed}”` }] : found;
  }, [all, query, canCreate, typed]);
  const similar = canCreate ? nearDuplicates(typed, options.map((o) => o.label)) : [];
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
          const t = e.target.value.replace(/\s+/g, " ").trim();
          const found = q === "" ? all : all.filter((o) => o.label.toLowerCase().includes(q));
          const create = allowCreate && t !== "" && !options.some((o) => o.label.toLowerCase() === t.toLowerCase());
          const next = create ? [...found, { value: t, label: t }] : found;
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
      {similar.length > 0 && <p role="status" className="picker-hint">Looks like {similar.map((g) => `“${g}”`).join(", ")}. Pick it from the list to reuse it.</p>}
      <ul id={listId} role="listbox" className="picker-list">
        {shown.length === 0 && <li className="picker-empty">No results</li>}
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
