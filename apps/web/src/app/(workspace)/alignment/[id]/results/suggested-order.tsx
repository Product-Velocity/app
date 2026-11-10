"use client";
import { useId, useMemo, useState } from "react";
import { changedMoves, describeMove, describeRanks, suggestOrder } from "@pv/domain";
import type { SuggestionRow } from "@/lib/alignment-rank";

/**
 * The order the vote suggests for the Stack Rank, with a tick per initiative, a review step and then the apply button (issue #394).
 * The moves shown are worked out with the same function the server uses; the server works them out again and the database checks them.
 * Nothing changes until the last button is pressed, and only a person can press it: the page is for admins.
 */
export function SuggestedOrder({ sessionId, rows, skipped, apply }: { sessionId: string; rows: SuggestionRow[]; skipped: number; apply: (form: FormData) => Promise<void> }) {
  const id = useId();
  const [on, setOn] = useState<Set<string>>(() => new Set(rows.map((r) => r.itemId)));
  const [review, setReview] = useState(false);
  const chosen = useMemo(() => rows.filter((r) => on.has(r.itemId)), [rows, on]);
  const moves = useMemo(() => suggestOrder(chosen.map((r) => ({ id: r.itemId, stackRank: r.from, place: r.place, tied: r.tied }))), [chosen]);
  const toOf = new Map(moves.map((m) => [m.id, m.to]));
  const changed = changedMoves(moves);
  const seen = JSON.stringify(Object.fromEntries(rows.map((r) => [r.itemId, r.from])));
  const toggle = (item: string) => { setReview(false); setOn((s) => { const n = new Set(s); if (n.has(item)) n.delete(item); else n.add(item); return n; }); };
  const ordered = [...rows].sort((a, b) => (toOf.get(a.itemId) ?? 1e9) - (toOf.get(b.itemId) ?? 1e9) || a.place - b.place);

  if (rows.length < 2) return <p className="muted">Fewer than two of these initiatives can be reordered (the others are in the Trash or not in the Stack Rank), so there is no suggested order.</p>;
  return (
    <form action={apply} className="suggested-order">
      <input type="hidden" name="session" value={sessionId} />
      <input type="hidden" name="seen" value={seen} />
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Suggested order for the Stack Rank</caption>
          <thead><tr><th scope="col">Include</th><th scope="col">Crowd</th><th scope="col">Initiative</th><th scope="col">Stack Rank now</th><th scope="col">Suggested</th><th scope="col">Move</th></tr></thead>
          <tbody>
            {ordered.map((r) => {
              const to = toOf.get(r.itemId);
              return (
                <tr key={r.itemId}>
                  <td><input type="checkbox" name="item" value={r.itemId} checked={on.has(r.itemId)} onChange={() => toggle(r.itemId)} aria-label={`Include ${r.code} ${r.name}`} /></td>
                  <td>{r.tied ? "=" : ""}{r.place}{r.tied && <span className="sr-only"> (tied)</span>}</td>
                  <td><strong>{r.code}</strong> {r.name}</td>
                  <td>#{r.from}</td>
                  <td>{to === undefined ? "–" : `#${to}`}</td>
                  <td>{to === undefined ? "not included" : describeMove({ from: r.from, to })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">
        The voted initiatives swap among the positions they already hold, so nothing outside this vote moves. Initiatives that tie keep their current order.
        {skipped > 0 && ` ${skipped} ${skipped === 1 ? "initiative was" : "initiatives were"} left out because ${skipped === 1 ? "it is" : "they are"} in the Trash or not in the Stack Rank.`}
      </p>
      <p className="muted">Effect on the fit line: not shown yet. Capacity planning (#119) is not built, so there is no fit line to compare.</p>
      {!review && (
        <div className="row-form">
          <button type="button" className="btn btn-primary" disabled={changed.length === 0} onClick={() => setReview(true)} aria-describedby={`${id}-hint`}>Review changes…</button>
          <span id={`${id}-hint`} className="muted" role="status">
            {chosen.length < 2 ? "Tick at least two initiatives." : changed.length === 0 ? "The team already ranks the ticked initiatives the way the vote does." : `${changed.length} ${changed.length === 1 ? "initiative" : "initiatives"} would move.`}
          </span>
        </div>
      )}
      {review && (
        <section className="notice" aria-labelledby={`${id}-confirm`}>
          <h3 id={`${id}-confirm`}>Change the Stack Rank?</h3>
          <p>This changes the Stack Rank of {changed.length} {changed.length === 1 ? "initiative" : "initiatives"} for everyone. It is one change in the audit log, and you can undo it from this page until someone ranks again.</p>
          <ul>
            {changed.map((m) => {
              const r = rows.find((x) => x.itemId === m.id)!;
              return <li key={m.id}><strong>{r.code}</strong> {r.name}: {describeRanks(m)} ({describeMove(m)})</li>;
            })}
          </ul>
          <div className="row-form">
            <button type="submit" className="btn btn-primary">Apply {changed.length} {changed.length === 1 ? "change" : "changes"} to Stack Rank</button>
            <button type="button" className="btn" onClick={() => setReview(false)}>Cancel</button>
          </div>
        </section>
      )}
    </form>
  );
}
