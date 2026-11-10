"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { METHODS } from "@/lib/alignment";
import { MOSCOW_VALUES, NOT_SET, NO_PICK_FILTERS, STAGES, filterInitiatives, pickerQuarters, stageCounts, type Initiative, type PickFilters, type StageId } from "@/lib/alignment-pick";

export type { Initiative };
export type CreateSession = (ids: string[], name: string, method: string) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;

const MIN = 2, MAX = 100;

/**
 * "New session" on the Alignment tab (issue #392): a name, a method and the initiatives to rank, picked with a search and the project and phase filters.
 * It makes a draft; nothing is sent and nobody is invited. The grid's "Start alignment session…" does the same from a selection.
 */
export function NewSessionDialog({ initiatives, create, onCreated, onClose }: { initiatives: Initiative[]; create: CreateSession; onCreated: (id: string) => void; onClose: () => void }) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<string>("coins");
  const [f, setF] = useState<PickFilters>(NO_PICK_FILTERS);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const projects = useMemo(() => [...new Set(initiatives.map((i) => i.project))].sort(), [initiatives]);
  const quarters = useMemo(() => pickerQuarters(initiatives), [initiatives]);
  // what each stage would add given the other filters, so the chips never promise more than they show
  const counts = useMemo(() => stageCounts(filterInitiatives(initiatives, { ...f, stages: [] })), [initiatives, f]);
  const shown = useMemo(() => filterInitiatives(initiatives, f), [initiatives, f]);
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_PICK_FILTERS);
  const toggleStage = (id: StageId) => setF((x) => ({ ...x, stages: x.stages.includes(id) ? x.stages.filter((s) => s !== id) : [...x.stages, id] }));

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const addShown = () => setPicked((s) => { const n = new Set(s); for (const i of shown) { if (n.size >= MAX) break; n.add(i.id); } return n; });
  const count = picked.size;
  const reason = name.trim().length === 0 ? "Give the session a name." : count < MIN ? `Pick at least ${MIN} initiatives.` : count > MAX ? `Pick at most ${MAX} initiatives.` : null;

  const go = async () => {
    if (reason) return;
    setBusy(true); setError(null);
    const r = await create([...picked], name, method);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    onCreated(r.id);
  };

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>New alignment session</h2>
        <p>This makes a draft. Nothing is sent and nobody is invited. On the next page you set the groups and the closing time and preview what participants will see.</p>
        <div className="al-dialog-top">
          <label className="al-field"><span>Name</span><input ref={nameRef} aria-label="Name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="For example Q1 priorities" /></label>
          <label className="al-field"><span>Method</span>
            <select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          </label>
        </div>
        <p className="muted">{METHODS.find((m) => m.value === method)?.help}</p>
        <h3>Initiatives to rank</h3>
        <div className="al-toolbar">
          <label className="al-field"><span>Planned quarter</span>
            <select aria-label="Planned quarter" value={f.quarter} onChange={(e) => setF((x) => ({ ...x, quarter: e.target.value }))}><option value="">Any planned quarter</option>{quarters.map((q) => <option key={q} value={q}>{q}</option>)}</select>
          </label>
          <label className="al-field"><span>MoSCoW</span>
            <select aria-label="MoSCoW" value={f.moscow} onChange={(e) => setF((x) => ({ ...x, moscow: e.target.value }))}>
              <option value="">Any</option>{MOSCOW_VALUES.map((m) => <option key={m} value={m}>{m}</option>)}<option value={NOT_SET}>{NOT_SET}</option>
            </select>
          </label>
          <label className="al-field"><span>Project</span>
            <select aria-label="Project" value={f.project} onChange={(e) => setF((x) => ({ ...x, project: e.target.value }))}><option value="">All projects</option>{projects.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </label>
          <label className="al-field"><span>Search</span><input type="search" aria-label="Search" value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} placeholder="Name or ID" /></label>
        </div>
        <div className="al-needs" role="group" aria-label="Stage">
          <span className="muted">Stage:</span>
          {STAGES.map((st) => (
            <button key={st.id} type="button" className={`al-chip${f.stages.includes(st.id) ? " is-on" : ""}`} aria-pressed={f.stages.includes(st.id)} onClick={() => toggleStage(st.id)}>
              {st.label} <strong>{counts[st.id]}</strong>
            </button>
          ))}
          {filtered && <button type="button" className="btn" onClick={() => setF(NO_PICK_FILTERS)}>Clear filters</button>}
        </div>
        <div className="al-toolbar">
          <button type="button" className="btn" onClick={addShown} disabled={shown.length === 0}>Add the {shown.length} shown</button>
          <button type="button" className="btn" onClick={() => setPicked(new Set())} disabled={count === 0}>Clear picked</button>
        </div>
        <p className="muted" role="status">{count} of {MAX} picked{count < MIN ? `; at least ${MIN} are needed` : ""}. {shown.length} {shown.length === 1 ? "initiative matches" : "initiatives match"}.</p>
        <ul className="al-picker" aria-label="Initiatives">
          {shown.length === 0 && <li className="muted">No initiative matches.</li>}
          {shown.map((i) => (
            <li key={i.id}>
              <label>
                <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} disabled={!picked.has(i.id) && count >= MAX} />{" "}
                <strong>{i.code}</strong> {i.name} <span className="muted">· {i.project}{i.phase ? ` · ${i.phase}` : ""}{i.ready ? " · Ready for build" : ""}{i.moscow ? ` · ${i.moscow}` : ""}{i.quarter ? ` · ${i.quarter}` : ""}</span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={go} disabled={busy || reason !== null} aria-describedby={reason ? `${titleId}-why` : undefined}>Create draft</button>
          {reason && <span id={`${titleId}-why`} className="muted">{reason}</span>}
        </div>
      </div>
    </div>
  );
}
