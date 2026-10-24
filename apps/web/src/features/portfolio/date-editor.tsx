"use client";

import { useRef, useState } from "react";
import { dateFormatHint, formatDate, localToday } from "@pv/domain";
import { useGridCellEditor, type CustomCellEditorProps } from "ag-grid-react";

/**
 * Date cell editor: type the date in your own format (or words like "next friday"), or press the calendar button to pick one.
 * The typed text goes to the grid as is and the controller reads it, so a date it cannot read is refused with the usual message.
 */
export function DateEditor({ value, onValueChange, stopEditing, eventKey }: CustomCellEditorProps<unknown, string | null>) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const iso = value ?? "";
  const start = eventKey && eventKey.length === 1 ? eventKey : formatDate(iso, localToday());
  const [text, setText] = useState(start);
  useGridCellEditor({ focusIn: () => { input.current?.focus(); input.current?.select(); } });
  return (
    <div className="date-editor">
      <input
        ref={input}
        autoFocus
        type="text"
        autoComplete="off"
        aria-label="Date"
        placeholder={dateFormatHint()}
        value={text}
        onFocus={(e) => { if (!eventKey || eventKey.length !== 1) e.target.select(); }}
        onChange={(e) => { setText(e.target.value); onValueChange(e.target.value === "" ? null : e.target.value); }}
      />
      <button
        type="button"
        className="date-pick"
        aria-label="Pick a date"
        title="Pick a date"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { const el = picker.current; if (!el) return; try { el.showPicker(); } catch { el.click(); } }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      <input
        ref={picker}
        className="date-native"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ""}
        onChange={(e) => { if (e.target.value) { onValueChange(e.target.value); stopEditing(); } }}
      />
    </div>
  );
}
