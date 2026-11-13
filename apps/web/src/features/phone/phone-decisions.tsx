"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GATES, OUTCOMES, QUEUE_FILTERS, checklistReady, gateChecklist, gateTitle, isOpen, outcomeLabel,
  type GateId, type GateOutcome, type GateRequest, type QueueFilter, filterQueue, decidableCount,
} from "@pv/domain";
import type { Approvers, Condition, Decider, GateItem, GateSource } from "../gates/gate-source";
import { DocReader } from "./doc-reader";

const short = (email: string) => email.split("@")[0]!;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
const KIND_FOR_GATE: Record<GateId, string> = { A: "discovery", B: "prd", C: "prd" };

/**
 * Decisions on a phone (docs/29-MOBILE.md section 4.5): the queue as cards, then one review screen with the gate pack, the document and a
 * decision bar. No bulk decide, no swipe, no fast lane here; a decision always goes through a confirm step and cannot be undone.
 */
export function PhoneDecisions({ source, me, mayDecide = true, tenantId }: { source: GateSource; me: string | null; mayDecide?: boolean; tenantId: string }) {
  const [requests, setRequests] = useState<GateRequest[] | null>(null);
  const [items, setItems] = useState<Map<string, GateItem>>(new Map());
  const [can, setCan] = useState<GateId[]>([]);
  const [deciders, setDeciders] = useState<Decider[]>([]);
  const [approvers, setApprovers] = useState<Approvers>({ A: [], B: [], C: [] });
  const [filter, setFilter] = useState<QueueFilter>("can-decide");
  const [reviewId, setReviewId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("review")));
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const reqs = await source.loadRequests();
        const [its, mine, dec, appr] = await Promise.all([
          source.loadItems([...new Set(reqs.map((r) => r.item_id))]), mayDecide ? source.myGates() : Promise.resolve([] as GateId[]),
          source.loadDeciders().catch(() => [] as Decider[]), source.loadApprovers().catch(() => ({ A: [], B: [], C: [] }) as Approvers),
        ]);
        if (off) return;
        setRequests(reqs); setItems(new Map(its.map((i) => [i.id, i]))); setCan(mine); setDeciders(dec); setApprovers(appr); setError(null);
      } catch (e) { if (!off) setError((e as Error).message); }
    })();
    return () => { off = true; };
  }, [source, mayDecide, reload]);

  const open = (id: string | null) => {
    setReviewId(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("review", id); else u.searchParams.delete("review");
    window.history.replaceState(null, "", u.toString());
    window.scrollTo({ top: 0 });
  };
  const rows = useMemo(() => filterQueue(requests ?? [], filter, me, can), [requests, filter, me, can]);
  const email = (id: string | null) => (id ? short(deciders.find((d) => d.user_id === id)?.email ?? "someone who left") : "unknown");
  const whoCanDecide = (gate: GateId) => {
    const names = deciders.filter((d) => !d.is_service_account && (d.role === "admin" || d.is_approver || approvers[gate].includes(d.user_id))).map((d) => short(d.email));
    return names.length === 0 ? "Admins" : names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
  };

  const current = reviewId && requests ? requests.find((r) => r.id === reviewId) ?? null : null;
  if (reviewId && requests && !current) return <div className="notice-box"><p>That request is not available to you.</p><button type="button" className="btn" onClick={() => open(null)}>Back to Decisions</button></div>;
  if (current) {
    return <Review request={current} item={items.get(current.item_id)} source={source} can={can.includes(current.gate)} mayDecide={mayDecide} who={whoCanDecide(current.gate)} email={email} tenantId={tenantId} onBack={() => open(null)} onDecided={load} />;
  }

  return (
    <div className="phone-decisions">
      <h1>Decisions</h1>
      <div className="phone-chips" role="group" aria-label="Filter requests">
        {QUEUE_FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? "phone-chip phone-chip-on" : "phone-chip"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}{f.id === "can-decide" && requests ? ` (${decidableCount(requests, can)})` : f.id === "waiting" && requests ? ` (${requests.filter(isOpen).length})` : ""}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {requests === null ? <p role="status" className="muted">Loading…</p> : rows.length === 0 ? (
        <p className="muted" role="status">{filter === "can-decide" ? "Nothing needs your decision." : filter === "waiting" ? "No gate requests are waiting." : filter === "decided" ? "No decisions yet." : "You have not requested a gate."}</p>
      ) : (
        <ul className="phone-cards">
          {rows.map((r) => {
            const it = items.get(r.item_id);
            const done = r.criteria.filter((c) => c.ok).length;
            return (
              <li key={r.id}>
                <button type="button" className="phone-card phone-card-btn" onClick={() => open(r.id)}>
                  <span className="phone-card-top"><span className="mono">{it?.item_code ?? ""}</span><span className="phone-health">{r.decided_at ? outcomeLabel(r.outcome) : `Gate ${r.gate}`}</span></span>
                  <span className="phone-card-name">{it?.initiative_name ?? r.item_id}</span>
                  <span className="muted phone-card-meta">
                    {r.decided_at ? `Decided by ${email(r.decided_by)}` : `Requested by ${email(r.requested_by)}, ${daysSince(r.requested_at)} days ago`}
                    {" · "}{r.criteria.length === 0 ? "no checklist recorded" : `${done} of ${r.criteria.length} ready${checklistReady(r.criteria) ? " (complete)" : " (incomplete)"}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Review({ request, item, source, can, mayDecide, who, email, tenantId, onBack, onDecided }: {
  request: GateRequest; item: GateItem | undefined; source: GateSource; can: boolean; mayDecide: boolean; who: string; email: (id: string | null) => string; tenantId: string; onBack: () => void; onDecided: () => void;
}) {
  const [docs, setDocs] = useState<{ kind: string; status: string }[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [sheet, setSheet] = useState<GateOutcome | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    void source.loadDocs(request.item_id).then((d) => { if (!off) setDocs(d); }, () => undefined);
    void source.loadConditions(request.item_id).then((c) => { if (!off) setConditions(c); }, () => undefined);
    return () => { off = true; };
  }, [source, request.item_id]);

  const checklist = request.criteria.length > 0 ? request.criteria : item ? gateChecklist(request.gate, item as unknown as Record<string, unknown>, docs) : [];
  const waiting = isOpen(request) && !done;
  const label = item ? `${item.item_code} ${item.initiative_name}` : request.item_id;

  return (
    <div className="phone-review">
      <button type="button" className="btn phone-back" onClick={onBack}>← Decisions</button>
      <h1 className="phone-review-title">{label}</h1>
      <p><strong>{gateTitle(request.gate)}</strong><br />{GATES[request.gate].question}</p>
      <p className="muted">Requested by {email(request.requested_by)}, {daysSince(request.requested_at)} days ago. {item && <Link href={`/w/${tenantId}/portfolio/${encodeURIComponent(item.item_code)}`}>Open the initiative</Link>}</p>

      <h2 className="fy-h">Checklist</h2>
      <ul className="gate-checklist">
        {checklist.map((c) => <li key={c.label}><span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.label} <span className="visually-hidden">{c.ok ? "(done)" : "(missing)"}</span></li>)}
      </ul>
      {item?.hypothesis && <><h2 className="fy-h">Hypothesis</h2><p>{item.hypothesis}</p></>}
      {conditions.filter((c) => !c.done_at).length > 0 && (
        <><h2 className="fy-h">Open conditions</h2><ul>{conditions.filter((c) => !c.done_at).map((c) => <li key={c.id}>{c.text}</li>)}</ul></>
      )}

      <h2 className="fy-h">{request.gate === "A" ? "Discovery document" : "PRD"}</h2>
      <DocReader itemId={request.item_id} preferKind={KIND_FOR_GATE[request.gate]} />

      {request.decided_at && (
        <div className="notice-box">
          <p><strong>{outcomeLabel(request.outcome)}</strong> by {email(request.decided_by)}</p>
          {request.rationale && <blockquote>{request.rationale}</blockquote>}
        </div>
      )}
      {request.withdrawn_at && <p className="muted">This request was withdrawn when the initiative moved.</p>}
      {done && <p className="notice-box" role="status">{done}</p>}

      {waiting && !can && <p className="muted">{mayDecide ? `You do not have approval rights for gate ${request.gate}. ${who} can decide it.` : "Looking in as staff: decisions are not available."}</p>}
      {waiting && can && (
        <div className="phone-decide-bar" role="region" aria-label="Decide">
          <button type="button" className="btn btn-primary" onClick={() => setSheet("go")}>Go</button>
          <button type="button" className="btn" onClick={() => setSheet("hold")}>Hold</button>
          <button type="button" className="btn" onClick={() => setSheet("go_with_conditions")}>Conditions</button>
          <button type="button" className="btn" onClick={() => setSheet("stop")}>Stop</button>
        </div>
      )}
      {sheet && (
        <DecideSheet
          source={source} request={request} label={label} initial={sheet} onClose={() => setSheet(null)}
          onDone={(text) => { setDone(text); setSheet(null); onDecided(); }}
        />
      )}
    </div>
  );
}

/** Pick the outcome, write the rationale (required), then confirm. The decision and rationale are append-only, so there is no undo. */
export function DecideSheet({ source, request, label, initial, onClose, onDone }: { source: GateSource; request: GateRequest; label: string; initial: GateOutcome; onClose: () => void; onDone: (text: string) => void }) {
  const [outcome, setOutcome] = useState<GateOutcome>(initial);
  const [rationale, setRationale] = useState("");
  const [conditions, setConditions] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = rationale.trim().length >= 3 && (outcome !== "go_with_conditions" || conditions.trim().length > 0);
  const condList = conditions.split("\n").map((l) => l.trim()).filter(Boolean);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const out = await source.decide([request.id], {
        outcome, rationale: rationale.trim(), fastLane: false, targetPhase: null,
        conditions: outcome === "go_with_conditions" ? condList : [], reviewDate: outcome === "hold" && reviewDate ? reviewDate : null,
      });
      const r = out[0];
      if (r && !r.ok) { setError(r.message ?? "The decision was not recorded."); setStep("edit"); }
      else onDone(`Recorded: ${outcomeLabel(outcome)} for ${label}.`);
    } catch (e) { setError((e as Error).message); setStep("edit"); }
    setBusy(false);
  };

  return (
    <div className="phone-sheet-wrap">
      <div className="phone-sheet" role="dialog" aria-modal="true" aria-label={`Decide ${gateTitle(request.gate)}`}>
        {step === "edit" ? (
          <>
            <h2>{label}<br /><span className="muted">{gateTitle(request.gate)}</span></h2>
            <fieldset className="gate-outcomes">
              <legend className="dialog-label">Decision</legend>
              {OUTCOMES.map((o) => (
                <label key={o.value} className="gate-outcome">
                  <input type="radio" name="outcome" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                  <span><strong>{o.label}</strong> <span className="muted">{o.hint}</span></span>
                </label>
              ))}
            </fieldset>
            <label className="dialog-label" htmlFor="ds-r">Rationale (required, kept as written)</label>
            <textarea id="ds-r" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4} maxLength={4000} />
            {outcome === "go_with_conditions" && (<><label className="dialog-label" htmlFor="ds-c">Conditions, one per line</label><textarea id="ds-c" value={conditions} onChange={(e) => setConditions(e.target.value)} rows={3} /></>)}
            {outcome === "hold" && (<><label className="dialog-label" htmlFor="ds-d">Look at it again on (optional)</label><input id="ds-d" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} /></>)}
            {error && <p role="alert" className="pf-error">{error}</p>}
            <div className="phone-sheet-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => setStep("confirm")}>Review decision</button>
            </div>
          </>
        ) : (
          <>
            <h2>Confirm</h2>
            <p><strong>{outcomeLabel(outcome)}</strong> for {label}, {gateTitle(request.gate)}.</p>
            <blockquote>{rationale.trim()}</blockquote>
            {outcome === "go_with_conditions" && <ul>{condList.map((c) => <li key={c}>{c}</li>)}</ul>}
            <p className="muted">The decision and the rationale are recorded with your name and cannot be undone or edited.</p>
            <div className="phone-sheet-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => setStep("edit")}>Back</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Recording…" : `Confirm ${outcomeLabel(outcome)}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
