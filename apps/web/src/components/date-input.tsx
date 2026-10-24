"use client";

import { useId, useRef, useState } from "react";
import { dateFormatHint, formatDate, parseDate } from "@pv/domain";

type Props = {
  /** The date as ISO (2027-03-31), or empty. */
  value: string;
  /** Called with the new ISO date, or "" when the box was emptied. Only called with a date that could be read. */
  onCommit: (iso: string) => void;
  label: string;
  today: Date;
  /** What "Q2" or "march" mean: the first day (a start) or the last day (an end). */
  edge?: "start" | "end";
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

/**
 * A date field: type it in your own date format (31/03/2027 or 03/31/2027 by your account setting, or words like "next friday"), or press
 * the calendar button to pick it. What is shown is always your format. A date that cannot be read is explained under the box and nothing is
 * saved until it can.
 */
export function DateInput({ value, onCommit, label, today, edge = "start", id, disabled, autoFocus, className }: Props) {
  const auto = useId();
  const inputId = id ?? `${auto}-d`;
  const shown = formatDate(value, today);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // a new value from outside (a pick, an undo, another row) replaces what was being typed
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(null); setError(null); }

  const commit = (text: string) => {
    if (text.trim() === "") { setDraft(null); setError(null); if (value !== "") onCommit(""); return; }
    const r = parseDate(text, today, { edge });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setDraft(null);
    if ((r.iso ?? "") !== value) onCommit(r.iso ?? "");
  };
  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.click(); }
  };

  return (
    <span className={`date-input${className ? ` ${className}` : ""}`}>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-err` : undefined}
        value={draft ?? shown}
        placeholder={dateFormatHint()}
        onFocus={() => setDraft(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => { if (draft !== null) commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); }
          else if (e.key === "Escape" && draft !== null) { e.stopPropagation(); setDraft(null); setError(null); }
        }}
      />
      <button type="button" className="date-pick" disabled={disabled} aria-label={`Pick a date for ${label}`} title="Pick a date" onClick={openPicker}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      <input
        ref={picker}
        className="date-native"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(e) => { if (e.target.value) { setError(null); setDraft(null); onCommit(e.target.value); } }}
      />
      {error && <span id={`${inputId}-err`} role="alert" className="quick-add-error">{error}</span>}
    </span>
  );
}
