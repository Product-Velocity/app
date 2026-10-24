"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { METHODS } from "@/lib/alignment";
import { createAlignmentSession } from "@/app/(workspace)/alignment/actions";

type Props = { ids: string[]; onClose: () => void };

/** "Start alignment session": a draft from the selected initiatives. The groups, weighting and closing time are set on the session page; nothing is sent. */
export function AlignmentDialog({ ids, onClose }: Props) {
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [name, setName] = useState("");
  const [method, setMethod] = useState<string>("coins");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const go = async () => {
    setBusy(true); setError(null);
    const r = await createAlignmentSession(ids, name, method);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    router.push(`/alignment/${r.id}`);
  };
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Start an alignment session with {ids.length} {ids.length === 1 ? "initiative" : "initiatives"}</h2>
        <p>This makes a draft. Nothing is sent and nobody is invited. On the next page you set the groups and the closing time and preview what participants will see.</p>
        <label className="dialog-label" htmlFor={`${titleId}-n`}>Name</label>
        <input id={`${titleId}-n`} ref={nameRef} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="For example Q1 priorities" />
        <label className="dialog-label" htmlFor={`${titleId}-m`}>Method</label>
        <select id={`${titleId}-m`} value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <p className="muted">{METHODS.find((m) => m.value === method)?.help}</p>
        {ids.length < 2 && <p role="alert" className="error">Select at least two initiatives.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || ids.length < 2 || !name.trim()} onClick={() => void go()}>{busy ? "Creating…" : "Create draft"}</button>
        </div>
      </div>
    </div>
  );
}
