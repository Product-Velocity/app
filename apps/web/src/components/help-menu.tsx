"use client";

import { useEffect, useId, useRef, useState } from "react";
import { QUICK_ADD_TOKENS } from "@pv/domain";

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  { title: "Anywhere in the roadmap", rows: [["Ctrl+K / ⌘K", "Open the command palette: find an initiative or run an action"], ["Alt+N", "Go to Add an initiative"], ["Ctrl+Z / ⌘Z", "Undo your last change"], ["Ctrl+Y / ⇧⌘Z", "Redo"], ["Esc", "Close a menu or dialog; clear the selection"]] },
  { title: "In the grid", rows: [["Arrow keys", "Move between cells"], ["Enter or F2", "Edit the cell"], ["Tab", "Move one cell right"], ["Esc", "Cancel an edit"], ["Delete", "Clear a cell, or delete the ticked rows when you are on the checkbox column"], ["Space", "Open the initiative in the side panel"], ["Paste from a spreadsheet", "Opens the import with column mapping"]] },
  { title: "The side panel", rows: [["J / K", "Next or previous initiative in the current view"], ["Esc", "Close the panel"], ["← →", "Switch tabs (with the tab focused)"]] },
  { title: "Add an initiative: type it in one line", rows: [
    ["Name", "Type the name, press Enter. Only the name is needed; the project comes from the row you are on"],
    ...QUICK_ADD_TOKENS.map((t): [string, string] => [t.token, t.means]),
    ["Paste a list", "One initiative per line, with the same words (up to 200)"],
    ["Example", "Faster search #platform @bo +growth M should ~now !atrisk by:31/03"],
  ] },
  { title: "Good to know", rows: [["Lock icon", "The value comes from GitHub and cannot be edited here"], ["Selecting rows", "A bar above the grid sets a field on all of them at once"]] },
];

/** Shortcuts in the top bar, next to Help and the account menu: all keyboard shortcuts in one place, and a button that opens the command palette. */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  return (
    <>
      <button type="button" className="help-btn" aria-haspopup="dialog" onClick={() => setOpen(true)} title="Keyboard shortcuts">Shortcuts</button>
      {open && (
        <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <h2 id={titleId}>Keyboard shortcuts</h2>
            <p className="muted">Product Velocity is built for the keyboard. On a Mac use ⌘ where it says Ctrl.</p>
            <button type="button" className="btn" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("pv:open-palette")); }}>Open the command palette</button>
            {SECTIONS.map((s) => (
              <section key={s.title}>
                <h3>{s.title}</h3>
                <dl className="help-list">
                  {s.rows.map(([k, v]) => (<div key={k + v}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>))}
                </dl>
              </section>
            ))}
            <div className="dialog-actions"><button ref={closeRef} type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
