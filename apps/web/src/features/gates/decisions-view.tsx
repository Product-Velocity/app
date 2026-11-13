"use client";

import { Loading } from "@/components/pill-loader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GATES, QUEUE_FILTERS, checklistReady, decidableCount, filterQueue, gateChecklist, gateTitle, isOpen, outcomeLabel,
  type GateId, type GateOutcome, type GateRequest, type QueueFilter,
} from "@pv/domain";
import { DecideDialog, type DecideRow, type DialogItem } from "./gate-dialogs";
import type { Approvers, Condition, Decider, GateItem, GateSource } from "./gate-source";

type Props = {
  source: GateSource;
  /** The signed-in person; null when staff look in. */
  me: string | null;
  /** False when staff are looking in: the screen shows everything and offers no decision (rule 10). */
  mayDecide?: boolean;
  initialFilter?: QueueFilter;
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const short = (email: string) => email.split("@")[0]!;

/**
 * The Decisions screen (issue #323, docs/28-DECISION-GATES.md section 6): every gate request of the workspace, about the gates, not about one person.
 * Anyone with approval rights for a gate can decide it; the first decision wins. Open a row to read the gate pack; J and K move, G, C, H, S decide.
 */
export function DecisionsView({ source, me, mayDecide = true, initialFilter = "waiting" }: Props) {
  const [requests, setRequests] = useState<GateRequest[] | null>(null);
  const [items, setItems] = useState<Map<string, GateItem>>(new Map());
  const [can, setCan] = useState<GateId[]>([]);
  const [deciders, setDeciders] = useState<Decider[]>([]);
  const [approvers, setApprovers] = useState<Approvers>({ A: [], B: [], C: [] });
  const [docs, setDocs] = useState<Record<string, { kind: string; status: string }[]>>({});
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [filter, setFilter] = useState<QueueFilter>(initialFilter);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ rows: DecideRow[]; outcome?: GateOutcome } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

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

  const rows = useMemo(() => filterQueue(requests ?? [], filter, me, can), [requests, filter, me, can]);
  const open = requests ? decidableCount(requests, can) : 0;
  const current = rows.find((r) => r.id === active) ?? null;
  const itemOf = (r: GateRequest) => items.get(r.item_id);
  const email = (id: string | null) => (id ? deciders.find((d) => d.user_id === id)?.email ?? "someone who left" : "unknown");

  // the active row's documents and conditions (the gate pack)
  useEffect(() => {
    if (!current) return;
    let off = false;
    void source.loadDocs(current.item_id).then((d) => { if (!off) setDocs((s) => ({ ...s, [current.item_id]: d })); }, () => undefined);
    void source.loadConditions(current.item_id).then((c) => { if (!off) setConditions(c); }, () => undefined);
    return () => { off = true; };
  }, [current, source]);

  const whoCanDecide = (gate: GateId) => {
    const names = deciders.filter((d) => !d.is_service_account && (d.role === "admin" || d.is_approver || approvers[gate].includes(d.user_id))).map((d) => short(d.email));
    return names.length === 0 ? "Admins" : names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
  };

  const decideRows = (reqs: GateRequest[], outcome?: GateOutcome) => {
    const ok = reqs.filter((r) => isOpen(r) && can.includes(r.gate));
    if (ok.length === 0) { setError(mayDecide ? "You do not have approval rights for the selected requests." : "Looking in as staff: decisions are not available."); return; }
    setDialog({ rows: ok.map((request) => ({ request, item: itemOf(request) as unknown as DialogItem | undefined })), ...(outcome ? { outcome } : {}) });
  };

  // keys work wherever the focus is on this screen (like the item page), except inside a field or a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role='dialog']")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || dialog) return;
      const i = rows.findIndex((r) => r.id === active);
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setActive(rows[Math.min(rows.length - 1, i + 1)]?.id ?? null); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setActive(rows[Math.max(0, i - 1)]?.id ?? null); }
      else if (current && ["g", "c", "h", "s"].includes(e.key)) {
        e.preventDefault();
        decideRows([current], ({ g: "go", c: "go_with_conditions", h: "hold", s: "stop" } as const)[e.key as "g"]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // decideRows only reads state that is in the list below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, active, current, dialog, can, mayDecide, items]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const pickedReqs = rows.filter((r) => picked.has(r.id));

  return (
    <div className="decisions" ref={root}>
      <div className="page-head">
        <h1>Decisions</h1>
        <p className="muted">Every gate request in the workspace. Anyone with approval rights for a gate can decide it; the first decision wins.</p>
      </div>
      <div className="help-tabs" role="tablist" aria-label="Filter requests">
        {QUEUE_FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`help-tab${filter === f.id ? " is-active" : ""}`} onClick={() => { setFilter(f.id); setPicked(new Set()); setActive(null); }}>
            {f.label}{f.id === "waiting" && requests ? ` (${requests.filter(isOpen).length})` : ""}{f.id === "can-decide" && requests ? ` (${open})` : ""}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {pickedReqs.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Decide the selected requests">
          <strong className="bulk-count">{pickedReqs.length} selected</strong>
          <button type="button" className="bulk-btn" onClick={() => decideRows(pickedReqs)}>Decide {pickedReqs.length}…</button>
          <button type="button" className="bulk-btn" onClick={() => setPicked(new Set())}>Clear selection</button>
        </div>
      )}
      {requests === null ? <Loading>Loading…</Loading> : rows.length === 0 ? (
        <p className="muted" role="status">{filter === "waiting" ? "No gate requests are waiting." : filter === "decided" ? "No decisions yet." : filter === "mine" ? "You have not requested a gate." : "Nothing here needs your decision."}</p>
      ) : (
        <div className="decisions-body">
          <table className="decisions-table">
            <thead><tr><th scope="col"><span className="visually-hidden">Select</span></th><th scope="col">Initiative</th><th scope="col">Gate</th><th scope="col">{filter === "decided" ? "Decision" : "Requested"}</th><th scope="col">Checklist</th><th scope="col">Who can decide</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const it = itemOf(r);
                const done = r.criteria.filter((c) => c.ok).length;
                return (
                  <tr key={r.id} className={r.id === active ? "is-active" : ""} aria-selected={r.id === active} onClick={() => setActive(r.id)}>
                    <td><input type="checkbox" aria-label={`Select ${it?.item_code ?? ""}`} checked={picked.has(r.id)} disabled={!isOpen(r)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <th scope="row"><button type="button" className="link-btn" onClick={() => setActive(r.id)}>{it ? `${it.item_code} ${it.initiative_name}` : r.item_id}</button></th>
                    <td>{gateTitle(r.gate)}</td>
                    <td>{r.decided_at ? <>{outcomeLabel(r.outcome)}{r.fast_lane ? " · Fast lane" : ""}<br /><span className="muted">{email(r.decided_by)}, {dateText(r.decided_at)}</span></> : <>{email(r.requested_by)}<br /><span className="muted">{dateText(r.requested_at)}</span></>}</td>
                    <td>{r.criteria.length === 0 ? <span className="muted">none recorded</span> : <span>{done} of {r.criteria.length}{checklistReady(r.criteria) ? " · complete" : " · incomplete"}</span>}</td>
                    <td>{whoCanDecide(r.gate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {current && (
            <aside className="decisions-pack" aria-label="Gate pack">
              <h2>{itemOf(current) ? `${itemOf(current)!.item_code} ${itemOf(current)!.initiative_name}` : current.item_id}</h2>
              <p><strong>{gateTitle(current.gate)}</strong><br />{GATES[current.gate].question}</p>
              <h3>Checklist</h3>
              <ul className="gate-checklist">
                {(current.criteria.length > 0 ? current.criteria : itemOf(current) ? gateChecklist(current.gate, itemOf(current) as unknown as Record<string, unknown>, docs[current.item_id] ?? []) : []).map((c) => (
                  <li key={c.label}><span aria-hidden="true">{c.ok ? "✓" : "✗"}</span> {c.label} <span className="visually-hidden">{c.ok ? "(done)" : "(missing)"}</span></li>
                ))}
              </ul>
              <h3>Documents</h3>
              <p>{(docs[current.item_id] ?? []).length === 0 ? "None yet." : (docs[current.item_id] ?? []).map((d) => `${d.kind} (${d.status.replace("_", " ")})`).join(", ")}</p>
              {itemOf(current)?.hypothesis && <><h3>Hypothesis</h3><p>{itemOf(current)!.hypothesis}</p></>}
              {current.decided_at ? (
                <>
                  <h3>Decision</h3>
                  <p><strong>{outcomeLabel(current.outcome)}</strong>{current.fast_lane ? " (fast lane)" : ""} by {email(current.decided_by)} on {dateText(current.decided_at)}</p>
                  {current.rationale && <blockquote>{current.rationale}</blockquote>}
                  {current.skipped_phases.length > 0 && <p>Skipped phases: {current.skipped_phases.join(", ")}.</p>}
                  {conditions.filter((c) => c.review_id === current.id).length > 0 && (
                    <ul>{conditions.filter((c) => c.review_id === current.id).map((c) => <li key={c.id}>{c.done_at ? "✓" : "☐"} {c.text}</li>)}</ul>
                  )}
                </>
              ) : current.withdrawn_at ? <p className="muted">This request was withdrawn when the initiative moved.</p> : (
                <div className="decisions-actions">
                  {can.includes(current.gate) ? (
                    <>
                      <button type="button" className="btn btn-confirm" onClick={() => decideRows([current], "go")}>Go <kbd>G</kbd></button>
                      <button type="button" className="btn" onClick={() => decideRows([current], "go_with_conditions")}>Go with conditions <kbd>C</kbd></button>
                      <button type="button" className="btn" onClick={() => decideRows([current], "hold")}>Hold <kbd>H</kbd></button>
                      <button type="button" className="btn btn-danger-quiet" onClick={() => decideRows([current], "stop")}>Stop <kbd>S</kbd></button>
                    </>
                  ) : <p className="muted">{mayDecide ? `You do not have approval rights for gate ${current.gate}. ${whoCanDecide(current.gate)} can decide it.` : "Looking in as staff: decisions are not available."}</p>}
                </div>
              )}
              <p className="muted">J and K move through the list.</p>
            </aside>
          )}
        </div>
      )}
      {dialog && <DecideDialog source={source} rows={dialog.rows} {...(dialog.outcome ? { initialOutcome: dialog.outcome } : {})} onClose={() => { setDialog(null); }} onDone={() => { setPicked(new Set()); load(); }} />}
    </div>
  );
}
