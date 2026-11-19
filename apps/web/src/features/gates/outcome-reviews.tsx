"use client";

import { useCallback, useEffect, useState } from "react";
import { OUTCOME_CHECKPOINTS, outcomeDueOn, type OutcomeReview } from "@pv/domain";
import type { GateSource } from "./gate-source";

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const num = (s: string) => (s.trim() === "" ? null : Number(s));

/**
 * The 30, 60 and 90 day outcome reviews in the item panel (not a gate; Ashu, chat 2026-11-19). Only for an initiative that has reached Roll-out (it needs Start Roll-Out).
 * Each checkpoint says when it is due and where it stands in words (not requested, requested, recorded); a Creator or Admin can ask for it (the Product Manager is notified)
 * or record the realised value of the Primary KR, the adoption % and a note. Outcomes are never synced to a tracker.
 */
export function OutcomeReviewsSection({ source, row, canEdit, onChanged }: { source: GateSource; row: Record<string, unknown>; canEdit: boolean; onChanged?: () => void }) {
  const itemId = String(row.id);
  const phase = row.initiative_phase;
  const [reviews, setReviews] = useState<OutcomeReview[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState({ value: "", adoption: "", note: "" });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { source.loadOutcomeReviews().then((all) => setReviews(all.filter((r) => r.item_id === itemId)), () => setReviews([])); }, [source, itemId]);
  useEffect(() => { load(); }, [load]);

  if ((phase !== "Roll-out" && phase !== "Completed") || !row.start_rollout) return null;
  const unit = typeof row.kr_unit === "string" && row.kr_unit ? ` (${row.kr_unit})` : "";
  const edit = (days: number) => {
    const r = reviews?.find((x) => x.at_days === days);
    setForm({ value: r?.realised_kr_value == null ? "" : String(r.realised_kr_value), adoption: r?.adoption_pct == null ? "" : String(r.adoption_pct), note: r?.notes ?? "" });
    setMessage(null); setEditing(days);
  };
  const run = async (p: Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    setMessage(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
    if (r.ok) { setEditing(null); load(); onChanged?.(); }
  };

  return (
    <section className="ip-outcomes" aria-label="Outcome reviews">
      <h3 className="ip-outcomes-title">Outcome reviews <span className="muted">30, 60 and 90 days after Start Roll-Out</span></h3>
      <ul className="ip-outcomes-list">
        {OUTCOME_CHECKPOINTS.map((days) => {
          const r = reviews?.find((x) => x.at_days === days);
          const due = outcomeDueOn(row.start_rollout, days);
          const state = r?.recorded_at ? `Recorded ${when(r.recorded_at)}` : r?.requested_at ? `Requested ${when(r.requested_at)}, not recorded yet` : "Not requested yet";
          return (
            <li key={days} className="ip-outcomes-row">
              <span><strong>{days} days</strong> · due {due ? when(due) : "unknown"} · {state}</span>
              {r?.recorded_at && editing !== days && <span className="muted"> {r.realised_kr_value != null ? `Value ${r.realised_kr_value}${unit}` : ""}{r.adoption_pct != null ? ` · Adoption ${r.adoption_pct}%` : ""}{r.notes ? ` · ${r.notes}` : ""}</span>}
              {canEdit && editing !== days && (
                <span className="ip-outcomes-actions">
                  {!r && <button type="button" className="bulk-btn" disabled={busy} onClick={() => void run(source.requestOutcomeReview(itemId, days), `${days} day metrics requested. The Product Manager has been notified.`)}>Request metrics</button>}
                  <button type="button" className="bulk-btn" onClick={() => edit(days)}>{r?.recorded_at ? "Edit" : "Record"}</button>
                </span>
              )}
              {editing === days && (
                <form className="ip-outcomes-form" onSubmit={(e) => { e.preventDefault(); void run(source.recordOutcomeReview(itemId, days, { value: num(form.value), adoption: num(form.adoption), note: form.note }), `${days} day metrics recorded.`); }}>
                  <label>Realised value{unit}<input type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
                  <label>Adoption %<input type="number" min={0} max={100} step="any" value={form.adoption} onChange={(e) => setForm({ ...form, adoption: e.target.value })} /></label>
                  <label className="ip-outcomes-note">Note<input type="text" maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                  <button type="submit" className="bulk-btn bulk-btn-open" disabled={busy}>Save</button>
                  <button type="button" className="bulk-btn" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "notice" : "error"}>{message.text}</p>}
    </section>
  );
}
