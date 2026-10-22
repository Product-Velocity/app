"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./provider";
import { ProjectDialog, ScopeDialog } from "./scope-dialog";
import { useScope } from "./scope";
import type { Scope } from "./store";

/** Header chip: "All projects ▾". Choose everything, a saved scope or one project; make or edit a scope. */
export function ScopeSwitcher() {
  const { scopes, projects, canEdit, canAdmin, error } = useWorkspace();
  const router = useRouter();
  const { selection, label, select } = useScope();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<{ scope: Scope | null } | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
  const close = (refocus = false) => { setOpen(false); if (refocus) ref.current?.querySelector<HTMLElement>(".scope-chip")?.focus(); };
  const pick = (s: Parameters<typeof select>[0]) => { select(s); close(true); };

  return (
    <div
      ref={ref}
      className="scope-switcher"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={(e) => {
        if (!open) return;
        const els = items();
        const at = els.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") { e.stopPropagation(); close(true); }
        else if (e.key === "ArrowDown") { e.preventDefault(); els[Math.min(els.length - 1, at + 1)]?.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); els[Math.max(0, at - 1)]?.focus(); }
      }}
    >
      <button type="button" className="scope-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open && (
        <div className="scope-menu" role="menu" aria-label="Portfolio scope">
          <button type="button" role="menuitemradio" aria-checked={selection.kind === "all"} className="scope-item" autoFocus onClick={() => pick({ kind: "all" })}>
            <span>All projects</span><span className="scope-meta">{selection.kind === "all" ? "✓ " : ""}{projects.length} {projects.length === 1 ? "project" : "projects"}</span>
          </button>
          <p className="scope-head">Saved scopes</p>
          {scopes.length === 0 && <p className="scope-empty">{error ?? "None yet"}</p>}
          {scopes.map((s) => (
            <div key={s.id} className="scope-row">
              <button type="button" role="menuitemradio" aria-checked={selection.kind === "scope" && selection.id === s.id} className="scope-item" onClick={() => pick({ kind: "scope", id: s.id })}>
                <span>{s.name}</span><span className="scope-meta">{selection.kind === "scope" && selection.id === s.id ? "✓ " : ""}{s.projectIds.length} {s.projectIds.length === 1 ? "project" : "projects"}</span>
              </button>
              {canEdit && (
                <button type="button" role="menuitem" className="scope-edit" aria-label={`Edit scope ${s.name}`} onClick={() => { close(); setDialog({ scope: s }); }}>Edit</button>
              )}
            </div>
          ))}
          <p className="scope-head">Projects</p>
          {projects.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={selection.kind === "project" && selection.id === p.id} className="scope-item" onClick={() => pick({ kind: "project", id: p.id })}>
              <span>{p.name}</span><span className="scope-meta">{selection.kind === "project" && selection.id === p.id ? "✓" : ""}</span>
            </button>
          ))}
          {canAdmin && (
            <button type="button" role="menuitem" className="scope-item scope-new" onClick={() => { close(); setProjectDialog(true); }}>+ New project</button>
          )}
          {canEdit && (
            <button type="button" role="menuitem" className="scope-item scope-new-scope" onClick={() => { close(); setDialog({ scope: null }); }}>+ New scope</button>
          )}
        </div>
      )}
      {projectDialog && <ProjectDialog onClose={() => setProjectDialog(false)} onCreated={() => { setProjectDialog(false); router.refresh(); }} />}
      {dialog && (
        <ScopeDialog
          scope={dialog.scope}
          onClose={() => setDialog(null)}
          onDone={(saved) => {
            setDialog(null);
            if (saved) select({ kind: "scope", id: saved.id });
            else if (dialog.scope && selection.kind === "scope" && selection.id === dialog.scope.id) select({ kind: "all" });
          }}
        />
      )}
    </div>
  );
}
