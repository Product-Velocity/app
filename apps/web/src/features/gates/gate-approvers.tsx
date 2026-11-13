"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { GATE_IDS, GATES, gateTitle, type GateId } from "@pv/domain";
import { createClient } from "@/lib/supabase/browser";
import { SupabaseGateSource, type Approvers, type Decider, type GateSource } from "./gate-source";

/**
 * Settings, Workspace: who can decide each gate. Admins always can (default); anyone with the Approver permission can decide every gate;
 * any other account can be added to a single gate here. Claude, service accounts and staff never can (CLAUDE.md rules 3 and 10).
 */
export function GateApproversView({ source, canEdit }: { source: GateSource; canEdit: boolean }) {
  const [deciders, setDeciders] = useState<Decider[] | null>(null);
  const [lists, setLists] = useState<Approvers>({ A: [], B: [], C: [] });
  const [saved, setSaved] = useState<Partial<Record<GateId, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    let off = false;
    Promise.all([source.loadDeciders(), source.loadApprovers()]).then(([d, a]) => { if (!off) { setDeciders(d); setLists(a); } }, (e: Error) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [source]);

  const people = useMemo(() => (deciders ?? []).filter((d) => !d.is_service_account), [deciders]);
  const toggle = (gate: GateId, userId: string) => setLists((l) => ({ ...l, [gate]: l[gate].includes(userId) ? l[gate].filter((x) => x !== userId) : [...l[gate], userId] }));
  const save = async (gate: GateId) => {
    setError(null);
    const r = await source.setApprovers(gate, lists[gate]);
    if (!r.ok) { setError(r.error); return; }
    setSaved((s) => ({ ...s, [gate]: "Saved" }));
  };

  if (error && !deciders) return <p role="alert" className="error">{error}</p>;
  if (!deciders) return <p role="status" className="muted">Loading…</p>;
  return (
    <section aria-labelledby={`${id}-h`} className="card gate-approvers">
      <h2 id={`${id}-h`}>Who can decide a gate</h2>
      <p className="muted">Admins can decide every gate. So can anyone with the Approver permission. Add others to a single gate here. An approver may approve their own request. Claude and service accounts never can.</p>
      {error && <p role="alert" className="error">{error}</p>}
      {GATE_IDS.map((g) => (
        <fieldset key={g} className="gate-approvers-gate">
          <legend><strong>{gateTitle(g)}</strong> <span className="muted">{GATES[g].question}</span></legend>
          <ul className="plain-list">
            {people.map((p) => {
              const always = p.role === "admin" ? "Admin" : p.is_approver ? "Approver permission" : null;
              return (
                <li key={p.user_id}>
                  <label>
                    <input type="checkbox" checked={always !== null || lists[g].includes(p.user_id)} disabled={!canEdit || always !== null} onChange={() => toggle(g, p.user_id)} />{" "}
                    {p.email} {always && <span className="muted">(always: {always})</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          {canEdit && <button type="button" className="btn" onClick={() => void save(g)}>Save gate {g}</button>}
          {saved[g] && <span role="status" className="muted"> {saved[g]}</span>}
        </fieldset>
      ))}
      {!canEdit && <p className="muted">Only an admin can change this.</p>}
    </section>
  );
}

export function GateApprovers({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const source = useMemo(() => new SupabaseGateSource(createClient(), tenantId), [tenantId]);
  return <GateApproversView source={source} canEdit={canEdit} />;
}
