"use client";

import { useId, useState } from "react";
import { bulkEditReason, canBeEmpty, EDITABLE_FIELDS, FIELDS, FIELD_BY_KEY, optionsFor, type FieldDef } from "@pv/domain";
import type { PortfolioController } from "./controller";
import { downloadCsv, selectionToCsv } from "./export-selection";
import type { GridItem, Lookups } from "./types";

type Props = {
  controller: PortfolioController;
  lookups: Lookups;
  selected: GridItem[];
  /** The columns currently shown: what "Export selection to file" writes. */
  exportFields: FieldDef[];
  onClear: () => void;
};

/** The value control for a field: a list for selects, people, projects and yes/no, a text box for the rest. */
function valueOptions(f: FieldDef, lookups: Lookups): { value: string; label: string }[] | null {
  if (f.key === "home_project") return lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  if (f.type === "Person") return lookups.members.map((m) => ({ value: m.user_id, label: m.email }));
  const o = optionsFor(f.key);
  return o.length > 0 ? o : null;
}
const HINT: Record<string, string> = { Date: "for example 31 mar, next friday, q2", Currency: "for example 120k or 1.2m", Number: "a number" };

/** Shown when rows are selected: set one field on all of them (one undo step), export them, or (later) update GitHub. */
export function BulkBar({ controller, lookups, selected, exportFields, onClear }: Props) {
  const id = useId();
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const def = field ? FIELD_BY_KEY[field] : undefined;
  const reason = field ? bulkEditReason(field) : null;
  const options = def ? valueOptions(def, lookups) : null;
  const editable = FIELDS.filter((f) => bulkEditReason(f.key) === null && EDITABLE_FIELDS.includes(f.key));
  const blocked = FIELDS.filter((f) => bulkEditReason(f.key) !== null);
  const n = selected.length;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const apply = () => {
    if (!field || reason) return;
    const r = controller.bulkEdit(selected.map((s) => s.id), field, value);
    if (!r.ok) { setMessage({ kind: "error", text: r.error }); return; }
    setMessage({
      kind: "ok",
      text: r.changed === 0
        ? "Nothing to change: every selected item already has that value."
        : `Done: ${controller.status.last?.text ?? "changed"}${r.unchanged > 0 ? ` (${r.unchanged} already had it)` : ""}. Undo with ${mac ? "⌘Z" : "Ctrl+Z"}.`,
    });
  };

  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions for the selected items">
      <strong className="bulk-count">{n} selected</strong>
      {controller.canEdit && (
      <div className="bulk-set">
        <label htmlFor={`${id}-field`}>Set</label>
        <select
          id={`${id}-field`}
          value={field}
          onChange={(e) => { setField(e.target.value); setValue(""); setMessage(null); }}
        >
          <option value="">Choose a field…</option>
          <optgroup label="Can be set here">
            {editable.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
          </optgroup>
          <optgroup label="Cannot be set here (GitHub, calculated, system, later phases, rank)">
            {blocked.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
          </optgroup>
        </select>
        {def && !reason && (
          options ? (
            <select aria-label={`New value for ${def.name}`} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">{canBeEmpty(def.key) ? "(empty)" : "Choose…"}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input
              aria-label={`New value for ${def.name}`}
              value={value}
              placeholder={HINT[def.type] ?? "text"}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            />
          )
        )}
        <button type="button" className="btn" disabled={!field || !!reason} onClick={apply}>
          Apply to {n} {n === 1 ? "item" : "items"}
        </button>
      </div>
      )}
      <div className="bulk-actions">
        {controller.canEdit && (
          <button type="button" className="btn" disabled title="Arrives in phase 3, when GitHub sync is built">
            Update GitHub <span className="bulk-later">arrives in phase 3</span>
          </button>
        )}
        <button type="button" className="btn" onClick={() => downloadCsv(`roadmap-selection-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(selected, exportFields, lookups))}>
          Export selection to file
        </button>
        <button type="button" className="btn" onClick={onClear}>Clear selection</button>
      </div>
      <div className="bulk-messages" aria-live="polite">
        {reason && <p className="quick-add-error">{reason}</p>}
        {message && <p className={message.kind === "error" ? "quick-add-error" : "quick-add-ok"}>{message.text}</p>}
      </div>
    </div>
  );
}
