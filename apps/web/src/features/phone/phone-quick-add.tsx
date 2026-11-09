"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { similarItems } from "@pv/domain";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import { useStatus } from "../portfolio/status-strip";
import type { PortfolioController } from "../portfolio/controller";
import type { Lookups } from "../portfolio/types";

const LAST_PROJECT = "pv:phone-last-project";
const readLast = () => { try { return window.localStorage.getItem(LAST_PROJECT); } catch { return null; } };
const writeLast = (id: string) => { try { window.localStorage.setItem(LAST_PROJECT, id); } catch { /* storage may be blocked */ } };

export function PhoneQuickAddClient({ tenantId, role, userId, lookups, initial }: { tenantId: string; role: string; userId: string; lookups: Lookups; /** Prefilled from a share (Web Share Target). */ initial?: { name: string; line: string } }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  if (state.kind === "error") return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  return <PhoneQuickAdd controller={state.kind === "ready" ? state.controller : null} lookups={lookups} tenantId={tenantId} {...(initial ? { initial } : {})} />;
}

/**
 * Quick add on a phone: the name is the only required field, an optional line says what and why (stored as the Description). The initiative
 * is exactly what the desktop quick-add makes; whatever its stage still needs shows up under "My placeholders" on For you.
 */
export function PhoneQuickAdd({ controller, lookups, tenantId, initial }: { controller: PortfolioController | null; lookups: Lookups; tenantId: string; initial?: { name: string; line: string } }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [line, setLine] = useState(initial?.line ?? "");
  const [project, setProject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = readLast();
    // the remembered project is only known in the browser, so it is read after the first render
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProject(lookups.projects.find((p) => p.id === last)?.id ?? lookups.projects[0]?.id ?? "");
    nameRef.current?.focus();
  }, [lookups.projects]);

  const similar = useMemo(() => (controller ? similarItems(name, controller.rows, 3) : []), [controller, name]);

  const create = () => {
    setError(null);
    if (!controller) return;
    if (!name.trim()) { setError("Give it a name."); return; }
    if (!project) { setError("There is no project yet. Ask an admin to add one."); return; }
    const r = controller.createItems([{ initiative_name: name.trim(), home_project: project, ...(line.trim() ? { description: line.trim() } : {}) }]);
    if (!r.ok) { setError(r.error); return; }
    writeLast(project);
    const row = controller.rows[controller.rows.length - 1];
    setAdded({ id: row!.id, name: name.trim() });
    setName("");
    setLine("");
  };

  if (controller && !controller.canEdit) return <div className="notice-box"><p>You have view-only access, so you cannot add initiatives. Ask an admin for the Creator role.</p></div>;

  return (
    <div className="page-narrow stack phone-add">
      <h1>New initiative</h1>
      {initial && (initial.name || initial.line) && <p className="muted">Shared from another app. Check it, then create.</p>}
      {added && <AddedNotice controller={controller!} added={added} tenantId={tenantId} onAnother={() => { setAdded(null); nameRef.current?.focus(); }} />}
      <form onSubmit={(e) => { e.preventDefault(); create(); }} className="stack">
        <div className="field">
          <label htmlFor="pa-name">Name</label>
          <input id="pa-name" ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="pa-line">What and why, in a line (optional)</label>
          <textarea id="pa-line" rows={3} value={line} onChange={(e) => setLine(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pa-project">Project</label>
          <select id="pa-project" value={project} onChange={(e) => setProject(e.target.value)}>
            {lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {similar.length > 0 && (
          <div className="notice-box" role="status">
            <p>Looks similar to:</p>
            <ul>{similar.map((s) => <li key={s.id}><Link href={`/w/${tenantId}/portfolio/${encodeURIComponent(s.item_code)}`}>{s.item_code} · {s.initiative_name}</Link></li>)}</ul>
          </div>
        )}
        {error && <p role="alert" className="pf-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={!controller}>{controller ? "Create" : "Loading…"}</button>
        <p className="muted">Name only is enough. Complete it on a computer later; it will wait under “My placeholders” on For you.</p>
      </form>
    </div>
  );
}

function AddedNotice({ controller, added, tenantId, onAnother }: { controller: PortfolioController; added: { id: string; name: string }; tenantId: string; onAnother: () => void }) {
  const status = useStatus(controller);
  const row = controller.row(added.id);
  const code = row && row.item_code !== "…" ? row.item_code : null;
  return (
    <div className="notice-box" role="status">
      <p><strong>{status.pending > 0 || !code ? "Adding" : "Created"} {code ?? ""}</strong> “{added.name}”. Complete it on a computer.</p>
      <div className="inline-form">
        <button type="button" className="btn" onClick={() => { controller.undo(); onAnother(); }}>Undo</button>
        {code && <Link className="btn" href={`/w/${tenantId}/portfolio/${encodeURIComponent(code)}`}>Open</Link>}
        <button type="button" className="btn" onClick={onAnother}>Add another</button>
      </div>
    </div>
  );
}
