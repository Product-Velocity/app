"use client";

import { useEffect, useRef, useState } from "react";
import { NOTE_MAX, QUICK_FIELDS, noteRequired, quickChangeProblem, quickChangeText, type QuickField } from "./quick-change";
import type { QuickChangeSource } from "./quick-change-source";

/**
 * Change Health or Status from a phone, with a short reason (a bottom sheet). The reason is kept on the history of the change with your name; a concern (At Risk,
 * Delayed, Blocked, On hold, Cancelled) needs one. The save goes through the same rules and role checks as any edit (the database function item_quick_change).
 */
export function QuickChangeSheet({ field, itemLabel, current, source, itemId, onClose, onDone }: {
  field: QuickField; itemLabel: string; current: string | null; source: QuickChangeSource; itemId: string; onClose: () => void;
  onDone: (r: { field: QuickField; from: string | null; to: string }) => void;
}) {
  const def = QUICK_FIELDS[field];
  const [value, setValue] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [busy, onClose]);

  const problem = quickChangeProblem(field, current, value, note);
  const required = value ? noteRequired(field, value) : false;

  async function save() {
    if (!value || problem || busy) return;
    setBusy(true); setError(null);
    const res = await source.change(itemId, field, value, note);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    onDone({ field, from: res.old, to: res.new });
  }

  return (
    <div className="phone-sheet-wrap">
      <div className="phone-sheet" role="dialog" aria-modal="true" aria-labelledby="qc-title">
        <h2 id="qc-title">Change {def.label.toLowerCase()}<br /><span className="muted">{itemLabel}</span></h2>
        <fieldset className="qc-options">
          <legend className="dialog-label">{def.label} now: {current ?? "not set"}</legend>
          {def.options.map((o, i) => (
            <label key={o.value} className={`qc-option${value === o.value ? " qc-option-on" : ""}${o.value === current ? " qc-option-now" : ""}`}>
              <input ref={i === 0 ? first : undefined} type="radio" name="qc-value" checked={value === o.value} disabled={o.value === current} onChange={() => setValue(o.value)} />
              <span><strong>{o.label}</strong>{o.value === current ? <span className="muted"> (now)</span> : null}</span>
            </label>
          ))}
        </fieldset>
        <label className="dialog-label" htmlFor="qc-note">{required ? "Why (required)" : "Why (optional)"}</label>
        <textarea id="qc-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={NOTE_MAX} placeholder="A few words, kept with the change" />
        <p className="muted phone-sheet-hint">{note.trim().length} of {NOTE_MAX}. Recorded in the history with your name; everyone in the workspace can read it.</p>
        {value && problem && <p className="muted" role="status">{problem}</p>}
        {error && <p role="alert" className="pf-error">{error}</p>}
        <div className="phone-sheet-actions">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!value || !!problem || busy} onClick={() => void save()}>{busy ? "Saving…" : value ? `Set to ${value}` : "Choose a value"}</button>
        </div>
        {value && !problem && <p className="muted phone-sheet-hint">{quickChangeText(field, current, value)}</p>}
      </div>
    </div>
  );
}
