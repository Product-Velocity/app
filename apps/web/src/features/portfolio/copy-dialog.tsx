"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PortfolioController } from "./controller";
import type { Lookups } from "./types";

type Props = { controller: PortfolioController; lookups: Lookups; ids: string[]; onClose: () => void };

/**
 * "Copy to project": makes new initiatives in another project from the selected ones. The originals stay as they are. A copy has its own
 * code and rank and carries the planning fields, tags and links, but no tracker link, status, progress or decision: those belong to its own project.
 */
export function CopyDialog({ controller, lookups, ids, onClose }: Props) {
  const titleId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [project, setProject] = useState(lookups.projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ copied: number; codes: string[]; failed: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { selectRef.current?.focus(); }, []);

  const go = async () => {
    setBusy(true); setError(null);
    const r = await controller.copyToProject(ids, project);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setDone({ copied: r.copied.length, codes: r.copied.slice(0, 4).map((c) => c.code), failed: r.failed[0]?.reason ?? null });
  };
  const target = lookups.projects.find((p) => p.id === project)?.name ?? "the project";

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Copy {ids.length} {ids.length === 1 ? "initiative" : "initiatives"} to a project</h2>
        {done ? (
          <>
            <p role="status">Copied {done.copied} {done.copied === 1 ? "initiative" : "initiatives"} into {target}{done.codes.length ? ` (${done.codes.join(", ")}${done.copied > done.codes.length ? ", …" : ""})` : ""}.{done.failed ? ` Some could not be copied: ${done.failed}` : ""}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload the roadmap</button>
            </div>
          </>
        ) : (
          <>
            <p>The originals stay where they are. Each copy is a new initiative with its own code and rank, and the same planning fields, tags and links. It gets no tracker link, status, delivery progress or decision: those belong to its own project and its own gates.</p>
            <label className="dialog-label" htmlFor={`${titleId}-p`}>Copy into</label>
            <select id={`${titleId}-p`} ref={selectRef} value={project} onChange={(e) => setProject(e.target.value)}>
              {lookups.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {error && <p role="alert" className="error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy || !project} onClick={() => void go()}>{busy ? "Copying…" : `Copy ${ids.length}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
