"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  GATES, GATE_IDS, OUTCOMES, checklistReady, gateChecklist, gateOfPhase, gateTitle, movablePhases, moveNeedsGate, outcomeLabel, requestableGates, splitForRequest, targetPhases,
  type ChecklistItem, type GateId, type GateOutcome, type GateRequest,
} from "@pv/domain";
import type { Approvers, Decider, GateItem, GateSource, ItemResult } from "./gate-source";

const label = (i: Record<string, unknown>) => `${String(i.item_code ?? "")} ${String(i.initiative_name ?? "")}`.trim();

function Shell({ title, onClose, className = "", children }: { title: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const titleId = useId();
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className={`dialog dialog-narrow gate-dialog${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Results({ rows, names, note }: { rows: ItemResult[]; names: Map<string, string>; note?: string }) {
  const bad = rows.filter((r) => !r.ok);
  return (
    <div role="status" className="gate-results">
      <p>{rows.length - bad.length} of {rows.length} done.{bad.length > 0 ? " These could not be handled:" : ""}</p>
      {note && rows.length > bad.length && <p>{note}</p>}
      {bad.length > 0 && <ul>{bad.map((r) => <li key={r.id}><strong>{names.get(r.id) ?? r.id}</strong>: {r.message}</li>)}</ul>}
    </div>
  );
}

/** Items the dialogs work on: the few fields the rules need. */
export type DialogItem = { id: string } & Record<string, unknown>;

// -------------------------------------------------------------------------------------------------------------------------------- request

/** "Request gate": asks for a decision on the selected items. The checklist informs; it never blocks (docs/28 section 3). */
export function RequestGateDialog({ source, items, me = null, initialGate, onClose, onDone }: { source: GateSource; items: DialogItem[]; /** The signed-in person: left out of the list of people to ask. */ me?: string | null; /** The gate to start on (the Changes report asks for the gate that opens the phase an action points at); used only if every item may request it. */ initialGate?: GateId; onClose: () => void; onDone: () => void }) {
  const first = items.map((i) => gateOfPhase(i.initiative_phase)).find(Boolean) ?? "A";
  const common = GATE_IDS.filter((g) => items.some((i) => requestableGates(i.initiative_phase).includes(g)));
  const [gate, setGate] = useState<GateId>(initialGate && common.includes(initialGate) ? initialGate : common.includes(first) ? first : common[0] ?? "A");
  const [docs, setDocs] = useState<Record<string, { kind: string; status: string }[]>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<{ deciders: Decider[]; approvers: Approvers } | null>(null);
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { selectRef.current?.focus(); }, []);
  useEffect(() => {
    let off = false;
    void Promise.all([source.loadDeciders(), source.loadApprovers()]).then(([deciders, approvers]) => { if (!off) setPeople({ deciders, approvers }); }, () => undefined);
    return () => { off = true; };
  }, [source]);
  useEffect(() => {
    let off = false;
    void Promise.all(items.slice(0, 50).map(async (i) => [i.id, await source.loadDocs(i.id).catch(() => [])] as const)).then((e) => { if (!off) setDocs(Object.fromEntries(e)); });
    return () => { off = true; };
  }, [items, source]);

  const { ready, skipped } = useMemo(() => splitForRequest(items, gate), [items, gate]);
  const lists = ready.map((i) => ({ item: i, list: gateChecklist(gate, i, docs[i.id] ?? []) }));
  const complete = lists.filter((l) => checklistReady(l.list)).length;
  const names = new Map(items.map((i) => [i.id, label(i)]));
  // who can decide this gate: Admins, the Approver permission and the gate's own list (the database applies the same rule; it never tells the requester)
  const askable = (people?.deciders ?? []).filter((d) => d.user_id !== me && !d.is_service_account && (d.role === "admin" || d.is_approver || (people?.approvers[gate] ?? []).includes(d.user_id)));

  const go = async () => {
    setBusy(true); setError(null);
    try {
      const out = await source.requestGate(gate, lists.map((l) => ({ item: l.item.id, ready: checklistReady(l.list), criteria: l.list as ChecklistItem[], ...(askable.length > 0 && asked.size > 0 ? { preferred: [...asked] } : {}) })));
      setResults(out);
      onDone();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <Shell title={`Request a gate for ${items.length} ${items.length === 1 ? "initiative" : "initiatives"}`} onClose={onClose}>
      {results ? (
        <>
          <Results rows={results} names={names} />
          <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
        </>
      ) : (
        <>
          <p>An approver decides. The checklist shows what is missing; it does not stop the request or the decision.</p>
          <label className="dialog-label" htmlFor="gate-pick">Gate</label>
          <select id="gate-pick" ref={selectRef} value={gate} onChange={(e) => setGate(e.target.value as GateId)}>
            {(common.length ? common : GATE_IDS).map((g) => <option key={g} value={g}>{gateTitle(g)}: {GATES[g].question}</option>)}
          </select>
          <p className="gate-count" role="status">{ready.length} {ready.length === 1 ? "initiative is" : "initiatives are"} ready to ask, {complete} with a complete checklist.{skipped.length > 0 ? ` ${skipped.length} skipped.` : ""}</p>
          {skipped.length > 0 && <ul className="gate-skipped">{skipped.map((s) => <li key={s.item.id}><strong>{label(s.item)}</strong>: {s.reason}</li>)}</ul>}
          {lists.some((l) => !checklistReady(l.list)) && (
            <details><summary>What is missing</summary>
              <ul>{lists.filter((l) => !checklistReady(l.list)).map((l) => <li key={l.item.id}><strong>{label(l.item)}</strong>: {l.list.filter((c) => !c.ok).map((c) => c.label).join(", ")}</li>)}</ul>
            </details>
          )}
          {askable.length > 0 && (
            <fieldset className="gate-ask">
              <legend className="dialog-label">Ask these people (optional)</legend>
              <p className="muted">Everyone who can decide gate {gate} gets a notification. Pick people to ask only them.</p>
              {askable.map((d) => (
                <label key={d.user_id} className="gate-outcome">
                  <input type="checkbox" checked={asked.has(d.user_id)} onChange={() => setAsked((s) => { const n = new Set(s); if (!n.delete(d.user_id)) n.add(d.user_id); return n; })} />
                  <span>{d.email}</span>
                </label>
              ))}
            </fieldset>
          )}
          {error && <p role="alert" className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-confirm" disabled={busy || ready.length === 0} onClick={() => void go()}>{busy ? "Requesting…" : `Request gate ${gate} for ${ready.length}`}</button>
          </div>
        </>
      )}
    </Shell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------- decide

/** What to do next after a decision; sending to a tracker is never automatic. */
function resultNote(gates: GateId[], outcome: GateOutcome): string | undefined {
  if (outcome === "stop") return "Initiative Status is now Cancelled. If an issue exists in GitHub or Jira, Sync offers to label and close it (under Removed or stopped in Product Velocity); nothing is sent until you confirm.";
  if ((outcome === "go" || outcome === "go_with_conditions") && gates.includes("B")) return "Gate B passed: the PRD is approved and the initiative is Ready for build. Use Sync with GitHub or Jira (grid bar or item panel) to hand it over; you confirm what is sent.";
  return undefined;
}

export type DecideRow = { request: GateRequest; item: DialogItem | undefined };

/** What the chosen outcome will do, in plain words, before anything is saved. */
function effectText(outcome: GateOutcome, gates: GateId[], many: boolean, target: string): { text: string; tone: "go" | "hold" | "stop" } {
  const each = many ? "Each initiative" : "The initiative";
  if (outcome === "stop") return { tone: "stop", text: `${each} is set to Cancelled and its request closes. Nothing is sent to GitHub or Jira until you confirm it in Sync.` };
  if (outcome === "hold") return { tone: "hold", text: `${each} stays in its phase and the request closes as Hold. Ask again when it is ready.` };
  const to = gates.length === 1 ? target || GATES[gates[0]!].to : null;
  const moves = to ? `${each} moves to ${to}.` : `${each} moves to the phase its gate opens.`;
  return { tone: "go", text: outcome === "go_with_conditions" ? `${moves} Each condition becomes a task that is tracked until it is done.` : moves };
}

const TONE_OF: Record<GateOutcome, "go" | "hold" | "stop"> = { go: "go", go_with_conditions: "go", hold: "hold", stop: "stop" };

/**
 * "Decide": Go, Go with conditions, Hold or Stop for one or many requests (Ashu, 2026-11-23: clearer layout, batch stated plainly). One comment (the rationale, optional since 2026-11-23), and the conditions
 * if any, are stored on each request. Fast lane is a recorded choice, not a check. The checklist informs; it never blocks.
 */
export function DecideDialog({ source, rows, initialOutcome, onClose, onDone }: { source: GateSource; rows: DecideRow[]; initialOutcome?: GateOutcome; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<GateOutcome>(initialOutcome ?? "go");
  const [rationale, setRationale] = useState("");
  const [fast, setFast] = useState(false);
  const [target, setTarget] = useState("");
  const [conditions, setConditions] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => { boxRef.current?.focus(); }, []);

  const many = rows.length > 1;
  const gates = [...new Set(rows.map((r) => r.request.gate))];
  const names = new Map(rows.map((r) => [r.request.id, label(r.item ?? {}) || r.request.item_id]));
  // fast lane: a later phase than the gate opens; only offered when every selected request is at the same gate
  const single = gates.length === 1 ? gates[0]! : null;
  const targets = single ? targetPhases(single, rows[0]?.item?.initiative_phase) : [];
  const go = outcome === "go" || outcome === "go_with_conditions";
  const ok = outcome !== "go_with_conditions" || conditions.trim().length > 0;
  const incomplete = rows.filter((r) => r.request.criteria.length > 0 && r.request.criteria.some((c) => !c.ok)).length;
  const effect = effectText(outcome, gates, many, go && fast ? target : "");
  const count = `${rows.length} ${many ? "requests" : "request"}`;

  const submit = async () => {
    if (busy || !ok) return;
    setBusy(true); setError(null);
    try {
      const out = await source.decide(rows.map((r) => r.request.id), {
        outcome, rationale: rationale.trim(), fastLane: fast && go, targetPhase: go && target ? target : null,
        conditions: outcome === "go_with_conditions" ? conditions.split("\n").map((l) => l.trim()).filter(Boolean) : [], reviewDate: outcome === "hold" && reviewDate ? reviewDate : null,
      });
      setResults(out);
      onDone();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const submitKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } };

  return (
    <Shell title={`Decide ${count}`} onClose={onClose} className="gate-decide">
      {results ? (
        <>
          <Results rows={results} names={names} note={resultNote(rows.map((r) => r.request.gate), outcome)} />
          <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
        </>
      ) : (
        <div onKeyDown={submitKey}>
          <ul className="dec-rows" aria-label="Requests you are deciding">
            {rows.map((r) => {
              const crit = r.request.criteria;
              const done = crit.filter((c) => c.ok).length;
              return (
                <li key={r.request.id} className="dec-row">
                  <span className="dec-what"><span className="mono">{String(r.item?.item_code ?? r.request.item_id)}</span> <strong>{String(r.item?.initiative_name ?? "")}</strong></span>
                  <span className="dec-meta">
                    <span className="dec-gate">{gateTitle(r.request.gate)}</span>
                    {crit.length > 0 && <span className={`pill ${done === crit.length ? "tone-good" : "tone-risk"}`}>{done} of {crit.length} · {done === crit.length ? "complete" : "incomplete"}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {many && <p className="muted dec-note">Batch decision: the same outcome and comment are saved on each of the {rows.length} requests, and each is recorded under your name.</p>}

          <fieldset className="dec-choices">
            <legend className="dialog-label">Decision</legend>
            <div className="dec-grid">
              {OUTCOMES.map((o) => (
                <label key={o.value} className={`dec-choice tone-${TONE_OF[o.value]}${outcome === o.value ? " is-on" : ""}`}>
                  <input type="radio" name={`${id}-o`} checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                  <strong className="dec-name">{o.label}</strong>{" "}
                  <span className="dec-hint">{o.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className={`dec-effect tone-${effect.tone}`} role="status">{effect.text}</p>

          <label className="dialog-label" htmlFor={`${id}-r`}>Comment <span className="muted">(optional, kept as written{many ? ", shared by all" : ""})</span></label>
          <textarea id={`${id}-r`} ref={boxRef} value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} maxLength={4000} placeholder="Why this decision? Anyone reading the gate history sees this." />
          {outcome === "go_with_conditions" && (
            <>
              <label className="dialog-label dec-gap" htmlFor={`${id}-c`}>Conditions <span className="muted">(one per line{many ? ", added to each request" : ""})</span></label>
              <textarea id={`${id}-c`} value={conditions} onChange={(e) => setConditions(e.target.value)} rows={3} />
            </>
          )}
          {outcome === "hold" && (
            <div className="dec-gap">
              <label className="dialog-label" htmlFor={`${id}-d`}>Look at it again on <span className="muted">(optional)</span></label>
              <input id={`${id}-d`} type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </div>
          )}
          {go && single && targets.length > 1 && (
            <div className="gate-fast">
              <label><input type="checkbox" checked={fast} onChange={(e) => { setFast(e.target.checked); if (!e.target.checked) setTarget(""); }} /> Fast lane: go to a later phase</label>
              {fast && (
                <select aria-label="Target phase" value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">{GATES[single].to} (next)</option>
                  {targets.slice(1).map((t) => <option key={t.phase} value={t.phase}>{t.phase}</option>)}
                </select>
              )}
              <p className="muted">Skipped phases and gates are recorded as Skipped (fast lane). There are no checks; it is your call.</p>
            </div>
          )}
          {go && many && !single && <p className="muted dec-note">Fast lane is offered only when every request is at the same gate.</p>}
          {incomplete > 0 && <p className="muted dec-note">{incomplete} of {rows.length} {incomplete === 1 ? "has an incomplete checklist" : "have incomplete checklists"}. The checklist informs; it never blocks a decision.</p>}
          {error && <p role="alert" className="error">{error}</p>}
          <div className="dialog-actions">
            <span className="dec-keys muted">Ctrl or ⌘ + Enter saves</span>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className={outcome === "go" ? "btn btn-confirm" : outcome === "stop" ? "btn btn-danger" : "btn btn-primary"} disabled={busy || !ok} onClick={() => void submit()}>{busy ? "Saving…" : `${outcomeLabel(outcome)} for ${count}`}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------- move

/** "Move to next phase": the moves that need no gate (any earlier phase, or forward up to the next gate). */
export function MoveDialog({ source, items, onClose, onDone }: { source: GateSource; items: DialogItem[]; onClose: () => void; onDone: () => void }) {
  const options = useMemo(() => {
    const sets = items.map((i) => movablePhases(i.initiative_phase));
    return sets.length === 0 ? [] : sets[0]!.filter((p) => sets.every((s) => s.includes(p)));
  }, [items]);
  const [to, setTo] = useState<string>(options.find((p) => items.every((i) => !moveNeedsGate(i.initiative_phase, p as never))) ?? options[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const names = new Map(items.map((i) => [i.id, label(i)]));
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => { selectRef.current?.focus(); }, []);

  const go = async () => {
    setBusy(true);
    const out: ItemResult[] = [];
    for (const i of items) {
      const r = await source.move(i.id, to);
      out.push(r.ok ? { id: i.id, ok: true } : { id: i.id, ok: false, message: r.error });
    }
    setResults(out); setBusy(false); onDone();
  };

  return (
    <Shell title={`Move ${items.length} ${items.length === 1 ? "initiative" : "initiatives"} to another phase`} onClose={onClose}>
      {results ? (
        <>
          <Results rows={results} names={names} />
          <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
        </>
      ) : options.length === 0 ? (
        <>
          <p>These initiatives have no common phase to move to without a gate. Use Request gate, or set Initiative Status to Completed to finish one.</p>
          <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Close</button></div>
        </>
      ) : (
        <>
          <p>A move up to the next gate needs no approver. To go past a gate, request it.</p>
          <label className="dialog-label" htmlFor="move-to">Move to</label>
          <select id="move-to" ref={selectRef} value={to} onChange={(e) => setTo(e.target.value)}>
            {options.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !to} onClick={() => void go()}>{busy ? "Moving…" : `Move ${items.length} to ${to}`}</button>
          </div>
        </>
      )}
    </Shell>
  );
}
