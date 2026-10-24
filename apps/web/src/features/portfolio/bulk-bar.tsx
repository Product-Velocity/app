"use client";

import { useId, useRef, useState } from "react";
import { bulkEditReason, canBeEmpty, EDITABLE_FIELDS, FIELDS, FIELD_BY_KEY, fieldOptions, optionsFor, type FieldDef, type ListOption } from "@pv/domain";
import { SelectField } from "@/components/search-list";
import type { PortfolioController } from "./controller";
import { downloadCsv, selectionToCsv } from "./export-selection";
import type { GridItem, Lookups } from "./types";
import { useMenuBlur } from "./use-menu-blur";
import { useDismiss } from "./use-dismiss";
import { CopyDialog } from "./copy-dialog";
import { AlignmentDialog } from "./alignment-dialog";

type Props = {
  controller: PortfolioController;
  lookups: Lookups;
  selected: GridItem[];
  /** The columns currently shown: what "Export selection to file" writes. */
  exportFields: FieldDef[];
  onClear: () => void;
  onSelectAll: () => void;
  /** Opens the delete confirmation for the selected rows. */
  onDelete: () => void;
  /** Opens the "Update GitHub" confirmation for the selected rows. */
  onGithub: () => void;
  /** Number of items in the grid, for "Select all 22". */
  total: number;
};

/** The fields set most often get their own button, as on prototype board 1. */
const QUICK_FIELDS = ["health", "moscow", "horizon", "focus_area"] as const;

/** The value control for a field: a list for selects, people, projects and yes/no, a text box for the rest. */
function valueOptions(f: FieldDef, lookups: Lookups): { value: string; label: string }[] | null {
  if (f.key === "home_project") return lookups.projects.map((p) => ({ value: p.id, label: p.name }));
  if (f.type === "Person") return lookups.members.map((m) => ({ value: m.user_id, label: m.email }));
  const o = optionsFor(f.key);
  return o.length > 0 ? o : null;
}
const HINT: Record<string, string> = { Date: "for example 31 mar, next friday, q2", Currency: "for example 120k or 1.2m", Number: "a number" };

/** "Set MoSCoW ▾": a button that opens the list of values; choosing one applies it to every selected item. */
function SetMenu({ def, selected, onPick }: { def: FieldDef; selected: GridItem[]; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const options = optionsFor(def.key);
  const current = [...new Set(selected.map((r) => (r[def.key] === null || r[def.key] === undefined ? "empty" : String(r[def.key]))))];
  const items = [...(canBeEmpty(def.key) ? [{ value: "", label: "(empty)" }] : []), ...options];
  const focusItem = (i: number) => (ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[i])?.focus();
  const close = () => setOpen(false);
  const menuBlur = useMenuBlur(close);
  useDismiss(ref, open, close);
  return (
    <span
      ref={ref}
      className="set-menu"
      {...menuBlur}
      onKeyDown={(e) => {
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
        const at = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape" && open) { e.stopPropagation(); close(); ref.current?.querySelector<HTMLElement>("button")?.focus(); }
        else if (e.key === "ArrowDown" && open) { e.preventDefault(); focusItem(Math.min(els.length - 1, at + 1)); }
        else if (e.key === "ArrowUp" && open) { e.preventDefault(); focusItem(Math.max(0, at - 1)); }
      }}
    >
      <button type="button" className={open ? "bulk-btn bulk-btn-open" : "bulk-btn"} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => { setOpen((o) => !o); }}>
        Set {def.name} ▾
      </button>
      {open && (
        <div id={id} role="menu" aria-label={`Set ${def.name}`} className="set-menu-list">
          <p className="set-menu-head">Set {def.name} on {selected.length} {selected.length === 1 ? "item" : "items"} to</p>
          {items.map((o, i) => (
            <button key={o.value || "__empty"} type="button" role="menuitem" className="set-menu-item" autoFocus={i === 0} onClick={() => { close(); onPick(o.value); }}>
              {o.label}
            </button>
          ))}
          <p className="set-menu-foot">Currently: {current.slice(0, 6).join(", ")}{current.length > 6 ? ", …" : ""}</p>
        </div>
      )}
    </span>
  );
}

/** Shown when rows are selected: set one field on all of them (one undo step), export them, or (later) update GitHub. */
export function BulkBar({ controller, lookups, selected, exportFields, onClear, onSelectAll, onDelete, onGithub, total }: Props) {
  const id = useId();
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [more, setMore] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [alignOpen, setAlignOpen] = useState(false);
  const def = field ? FIELD_BY_KEY[field] : undefined;
  const reason = field ? bulkEditReason(field) : null;
  const options = def ? valueOptions(def, lookups) : null;
  const editable = FIELDS.filter((f) => bulkEditReason(f.key) === null && EDITABLE_FIELDS.includes(f.key));
  const blocked = FIELDS.filter((f) => bulkEditReason(f.key) !== null);
  const fieldChoices: ListOption[] = [
    ...fieldOptions(editable).map((o) => ({ ...o, group: "Can be set here" })),
    ...fieldOptions(blocked).map((o) => ({ ...o, group: "Cannot be set here (GitHub, calculated, system, later phases, rank)" })),
  ];
  const n = selected.length;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const apply = (f = field, v = value) => {
    if (!f || bulkEditReason(f)) return;
    const r = controller.bulkEdit(selected.map((s) => s.id), f, v);
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
      {n < total && <button type="button" className="bulk-link" onClick={onSelectAll}>Select all {total}</button>}
      {controller.canEdit && <span className="bulk-sep" aria-hidden="true" />}
      {controller.canEdit && QUICK_FIELDS.map((k) => <SetMenu key={k} def={FIELD_BY_KEY[k]!} selected={selected} onPick={(v) => apply(k, v)} />)}
      {controller.canEdit && (
        <button type="button" className={more ? "bulk-btn bulk-btn-open" : "bulk-btn"} aria-expanded={more} onClick={() => setMore((m) => !m)}>More fields ▾</button>
      )}
      <div className="bulk-actions">
        {controller.canEdit && (
          lookups.github?.connected ? (
            <button type="button" className="bulk-btn" onClick={onGithub} title="Create or update the GitHub tracking issue of each selected initiative (you confirm first)">Update GitHub…</button>
          ) : (
            <button type="button" className="bulk-btn" disabled title="An admin connects GitHub in Settings > GitHub">
              Update GitHub <span className="bulk-later">connect GitHub first</span>
            </button>
          )
        )}
        <button type="button" className="bulk-btn" onClick={() => downloadCsv(`roadmap-selection-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(selected, exportFields, lookups))}>
          Export selection to file
        </button>
        {controller.canPurge && <button type="button" className="bulk-btn" onClick={() => setAlignOpen(true)}>Start alignment session…</button>}
        {controller.canEdit && <button type="button" className="bulk-btn" onClick={() => setCopyOpen(true)}>Copy to project…</button>}
        {controller.canEdit && <button type="button" className="bulk-btn bulk-btn-danger" onClick={onDelete}>Delete…</button>}
        <button type="button" className="bulk-btn" onClick={onClear}>Clear selection</button>
      </div>
      <span className="bulk-hint">Esc clears · changes can be undone with {mac ? "⌘Z" : "Ctrl+Z"}</span>
      {controller.canEdit && more && (
      <div className="bulk-set">
        <span className="bulk-set-label" aria-hidden="true">Set</span>
        <SelectField
          id={`${id}-field`} label="Field to set" value={field} options={fieldChoices} blank="Choose a field…"
          onChange={(v) => { setField(v); setValue(""); setMessage(null); }}
        />
        {def && !reason && (
          options ? (
            <SelectField label={`New value for ${def.name}`} value={value} options={options} onChange={setValue} blank={canBeEmpty(def.key) ? "(empty)" : "Choose…"} />
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
        <button type="button" className="bulk-btn" disabled={!field || !!reason} onClick={() => apply()}>
          Apply to {n} {n === 1 ? "item" : "items"}
        </button>
      </div>
      )}
      {alignOpen && <AlignmentDialog ids={selected.map((r) => r.id)} onClose={() => setAlignOpen(false)} />}
      {copyOpen && <CopyDialog controller={controller} lookups={lookups} ids={selected.map((r) => r.id)} onClose={() => setCopyOpen(false)} />}
      <div className="bulk-messages" aria-live="polite">
        {reason && <p className="quick-add-error">{reason}</p>}
        {message && <p className={message.kind === "error" ? "quick-add-error" : "quick-add-ok"}>{message.text}</p>}
      </div>
    </div>
  );
}
