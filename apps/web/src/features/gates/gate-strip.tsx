"use client";

import { useState } from "react";
import { GATES, gateOfPhase, localToday, phaseSuggestions, type GateId } from "@pv/domain";
import { GateActions } from "./gate-actions";
import type { GateSource } from "./gate-source";
import type { DialogItem } from "./gate-dialogs";

/** The lifecycle line of the item panel: phase, the gate it has to pass and where that stands, with the three gate actions. Text labels, never colour alone. */
export function GateStrip({ source, row, canEdit, onChanged, frozen = false }: { source: GateSource; row: Record<string, unknown> & DialogItem; canEdit: boolean; onChanged: () => void; /** The tracker link is frozen: the initiative finished more than 14 days ago. */ frozen?: boolean }) {
  const phase = (row.initiative_phase as string | null) ?? null;
  const gate = (row.current_gate as GateId | null) ?? gateOfPhase(phase);
  const status = (row.gate_status as string | null) ?? (gate ? "Not started" : null);
  const ready = row.ready_for_build as string | null | undefined;
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const suggestions = phaseSuggestions(row, localToday().toISOString().slice(0, 10));
  const accept = async (to: string) => {
    setMoving(true); setMoveError(null);
    const r = await source.move(String(row.id), to);
    setMoving(false);
    if (r.ok) onChanged(); else setMoveError(r.error);
  };
  return (
    <div className="ip-lifecycle" role="group" aria-label="Lifecycle">
      <span><strong>Phase:</strong> {phase ?? "Not set"}</span>
      {gate && <span><strong>Next gate:</strong> {gate} ({GATES[gate].from} to {GATES[gate].to}) · {status}</span>}
      {ready === "Ready" && <span><strong>Ready for build</strong> (waiting for the tracker to start)</span>}
      {suggestions.map((s) => (
        <span key={s.kind} className="ip-suggest" role="status">
          {s.text}{" "}
          {s.moveTo && canEdit && <button type="button" className="btn" disabled={moving} onClick={() => void accept(s.moveTo!)}>{moving ? "Moving…" : `Move to ${s.moveTo}`}</button>}
        </span>
      ))}
      {frozen && (
        <span className="ip-suggest" role="status">
          Syncing with GitHub or Jira is stopped: this initiative finished more than 14 days ago.{" "}
          {canEdit && <button type="button" className="btn" disabled={moving} onClick={async () => { setMoving(true); setMoveError(null); const r = await source.resumeSync(String(row.id)); setMoving(false); if (r.ok) onChanged(); else setMoveError(r.error); }}>Resume syncing</button>}
        </span>
      )}
      {moveError && <span role="alert" className="error">{moveError}</span>}
      <span className="ip-lifecycle-actions"><GateActions source={source} items={[row]} canEdit={canEdit} onChanged={onChanged} className="btn" /></span>
    </div>
  );
}
