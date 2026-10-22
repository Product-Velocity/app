"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useWorkspace } from "./provider";
import type { Scope } from "./store";

type Props = {
  /** Scope being edited, or null to create a new one. */
  scope: Scope | null;
  onClose: () => void;
  /** Called with the saved scope (or null after a delete) once it is written. */
  onDone: (saved: Scope | null) => void;
};

/** Create, rename, change the projects of, or delete a saved scope (a named selection of projects). */
export function ScopeDialog({ scope, onClose, onDone }: Props) {
  const id = useId();
  const { projects, store, reload } = useWorkspace();
  const [name, setName] = useState(scope?.name ?? "");
  const [chosen, setChosen] = useState<Set<string>>(new Set(scope?.projectIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const toggle = (pid: string) => setChosen((c) => { const n = new Set(c); if (!n.delete(pid)) n.add(pid); return n; });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ids = projects.filter((p) => chosen.has(p.id)).map((p) => p.id);
    const r = scope ? await store.updateScope(scope.id, name, ids) : await store.createScope(name, ids);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await reload();
    onDone(r.value);
  };

  const remove = async () => {
    if (!scope || busy) return;
    setBusy(true);
    const r = await store.deleteScope(scope.id);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await reload();
    onDone(null);
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{scope ? "Edit scope" : "New scope"}</h2>
        <p className="muted">A scope is a named selection of projects. The roadmap shows only their items; ranks stay global.</p>
        <label htmlFor={`${id}-name`} className="dialog-label">Name</label>
        <input
          id={`${id}-name`}
          ref={nameRef}
          value={name}
          maxLength={120}
          placeholder="For example Customer-facing work"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
        />
        <fieldset className="scope-projects">
          <legend>Projects in this scope</legend>
          {projects.length === 0 && <p className="muted">There are no projects yet.</p>}
          {projects.map((p) => (
            <label key={p.id} className="columns-item">
              <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} /> {p.name}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="quick-add-error">{error}</p>}
        <div className="dialog-actions">
          {scope && (
            confirmDelete ? (
              <>
                <span className="muted dialog-spacer">Delete “{scope.name}”? Items are not deleted.</span>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
                <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>Yes, delete scope</button>
              </>
            ) : (
              <button type="button" className="btn dialog-spacer-btn" onClick={() => setConfirmDelete(true)}>Delete scope</button>
            )
          )}
          {!confirmDelete && (
            <>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || name.trim() === "" || chosen.size === 0}>
                {scope ? "Save changes" : "Create scope"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Admins add a project by name (the full project setup comes later). Items need a project, so quick-add depends on this. */
export function ProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const id = useId();
  const { store, reload } = useWorkspace();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const create = async () => {
    if (busy || name.trim() === "") return;
    setBusy(true);
    setError(null);
    const r = await store.createProject(name);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await reload();
    onCreated();
  };
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="dialog dialog-small" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`}>New project</h2>
        <p className="muted">Every item belongs to one project. You can set the project up in more detail later.</p>
        <label htmlFor={`${id}-n`} className="dialog-label">Project name</label>
        <input id={`${id}-n`} ref={ref} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
        {error && <p role="alert" className="quick-add-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || name.trim() === ""} onClick={() => void create()}>Create project</button>
        </div>
      </div>
    </div>
  );
}
