"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { REASON_MAX, assignRanks, changedMoves, describeMove, describeRanks, differences, moveInOrder, suggestOrder } from "@pv/domain";
import type { SuggestionRow } from "@/lib/alignment-rank";

type Focus = { id: string; kind: "up" | "down" | "place" } | null;

/**
 * The order for the Stack Rank (issues #394 and #397). The vote's order is the starting point; the admin can move any initiative (move up, move down,
 * or type the place it should take), tick which initiatives to include, and then reviews the changes. Wherever the final rank differs from the rank the
 * vote suggested, a reason is asked for in the review. Nothing changes until the last button is pressed, and only a person can press it.
 * The moves shown are worked out with the same functions the server uses; the server works them out again and the database checks them, and the database
 * also works out the vote's own rank itself, so a reason cannot be skipped from here.
 */
export function SuggestedOrder({ sessionId, rows, skipped, apply }: { sessionId: string; rows: SuggestionRow[]; skipped: number; apply: (form: FormData) => Promise<void> }) {
  const id = useId();
  const crowdAll = useMemo(() => suggestOrder(rows.map((r) => ({ id: r.itemId, stackRank: r.from, place: r.place, tied: r.tied }))).map((m) => m.id), [rows]);
  const [order, setOrder] = useState<string[]>(crowdAll); // every initiative, in the order the person wants; unticked ones keep their slot
  const [on, setOn] = useState<Set<string>>(() => new Set(rows.map((r) => r.itemId)));
  const [review, setReview] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<Focus>(null);
  const [said, setSaid] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);
  const byId = useMemo(() => new Map(rows.map((r) => [r.itemId, r])), [rows]);

  const chosenOrder = order.filter((x) => on.has(x));
  const chosen = chosenOrder.map((x) => byId.get(x)!);
  const held = chosen.map((r) => ({ id: r.itemId, stackRank: r.from }));
  const votes = new Map(chosen.map((r) => [r.itemId, { place: r.place, tied: r.tied }]));
  const moves = assignRanks(chosenOrder, held, votes);
  const crowd = suggestOrder(chosen.map((r) => ({ id: r.itemId, stackRank: r.from, place: r.place, tied: r.tied })));
  const diffs = differences(moves, crowd);
  const crowdOf = new Map(crowd.map((m) => [m.id, m.to]));
  const toOf = new Map(moves.map((m) => [m.id, m.to]));
  const changed = changedMoves(moves);
  const diffIds = new Set(diffs.map((d) => d.id));
  const missing = diffs.filter((d) => (reasons[d.id] ?? "").trim().length === 0);
  const seen = JSON.stringify(Object.fromEntries(rows.map((r) => [r.itemId, r.from])));
  const sameAsVote = diffs.length === 0;
  const shown = [...chosenOrder, ...order.filter((x) => !on.has(x))];

  useEffect(() => {
    if (!focus) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-focus="${focus.id}-${focus.kind}"]`)?.focus();
  }, [focus, order]);

  const toggle = (item: string) => { setReview(false); setOn((s) => { const n = new Set(s); if (n.has(item)) n.delete(item); else n.add(item); return n; }); };
  const place = (item: string, to: number, kind: "up" | "down" | "place") => {
    const next = moveInOrder(chosenOrder, item, to);
    if (next === chosenOrder) return;
    // put the chosen initiatives back into their slots in the full order, leaving the unticked ones where they were
    let i = 0;
    setOrder(order.map((x) => (on.has(x) ? next[i++]! : x)));
    setReview(false);
    setFocus({ id: item, kind });
    const r = byId.get(item)!;
    setSaid(`${r.code} is now place ${next.indexOf(item) + 1} of ${next.length}.`);
  };
  const backToVote = () => { setOrder(crowdAll); setReview(false); setSaid("The order is the vote's order again."); };

  if (rows.length < 2) return <p className="muted">Fewer than two of these initiatives can be reordered (the others are in the Trash or not in the Stack Rank), so there is no suggested order.</p>;
  return (
    <form action={apply} className="suggested-order">
      <input type="hidden" name="session" value={sessionId} />
      <input type="hidden" name="seen" value={seen} />
      {chosenOrder.map((x) => <input key={x} type="hidden" name="order" value={x} />)}
      <p className="muted">
        The vote&rsquo;s order is the starting point. Move initiatives to the order you decide, with what you know that the voters do not. Wherever the final rank is not the one the vote suggested you will be asked for a short reason.
      </p>
      <div className="table-wrap">
        <table className="table" ref={tableRef}>
          <caption className="sr-only">Order for the Stack Rank</caption>
          <thead><tr><th scope="col">Include</th><th scope="col">Crowd</th><th scope="col">Initiative</th><th scope="col">Stack Rank now</th><th scope="col">Vote suggests</th><th scope="col">Your order</th><th scope="col">Move</th><th scope="col">Change place</th></tr></thead>
          <tbody>
            {shown.map((x) => {
              const r = byId.get(x)!;
              const isOn = on.has(x);
              const to = toOf.get(x);
              const n = chosenOrder.indexOf(x) + 1;
              return (
                <tr key={x}>
                  <td><input type="checkbox" name="item" value={x} checked={isOn} onChange={() => toggle(x)} aria-label={`Include ${r.code} ${r.name}`} /></td>
                  <td>{r.tied ? "=" : ""}{r.place}{r.tied && <span className="sr-only"> (tied)</span>}</td>
                  <td><strong>{r.code}</strong> {r.name}{diffIds.has(x) && <span className="muted"> · differs from the vote</span>}</td>
                  <td>#{r.from}</td>
                  <td>{isOn ? `#${crowdOf.get(x)}` : "–"}</td>
                  <td>{isOn && to !== undefined ? `#${to} (${describeMove({ from: r.from, to })})` : "not included"}</td>
                  <td>
                    {isOn && (
                      <span className="row-form">
                        <button type="button" className="btn" data-focus={`${x}-up`} aria-disabled={n <= 1} aria-label={`Move ${r.code} up`} onClick={() => n > 1 && place(x, n - 1, "up")}>Up</button>
                        <button type="button" className="btn" data-focus={`${x}-down`} aria-disabled={n >= chosenOrder.length} aria-label={`Move ${r.code} down`} onClick={() => n < chosenOrder.length && place(x, n + 1, "down")}>Down</button>
                      </span>
                    )}
                  </td>
                  <td>
                    {isOn && (
                      <input
                        key={`${x}-${n}`} type="number" min={1} max={chosenOrder.length} defaultValue={n} style={{ width: 64 }} data-focus={`${x}-place`}
                        aria-label={`Place in your order for ${r.code}, 1 to ${chosenOrder.length}`}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); place(x, Number((e.target as HTMLInputElement).value), "place"); } }}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== n) place(x, v, "place"); }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      <p className="muted">
        The voted initiatives swap among the positions they already hold, so nothing outside this vote moves. Initiatives that tie keep their current order in the vote&rsquo;s suggestion.
        {skipped > 0 && ` ${skipped} ${skipped === 1 ? "initiative was" : "initiatives were"} left out because ${skipped === 1 ? "it is" : "they are"} in the Trash or not in the Stack Rank.`}
      </p>
      <p className="muted">Effect on the fit line: not shown yet. Capacity planning (#119) is not built, so there is no fit line to compare.</p>
      {!review && (
        <div className="row-form">
          <button type="button" className="btn btn-primary" disabled={changed.length === 0} onClick={() => setReview(true)} aria-describedby={`${id}-hint`}>Review changes…</button>
          {!sameAsVote && <button type="button" className="btn" onClick={backToVote}>Back to the vote&rsquo;s order</button>}
          <span id={`${id}-hint`} className="muted" role="status">
            {chosen.length < 2 ? "Tick at least two initiatives." : changed.length === 0 ? "The Stack Rank would not change." : `${changed.length} ${changed.length === 1 ? "initiative" : "initiatives"} would move${diffs.length > 0 ? `; ${diffs.length} differ from the vote and need a reason` : ""}.`}
          </span>
        </div>
      )}
      {review && (
        <section className="notice" aria-labelledby={`${id}-confirm`}>
          <h3 id={`${id}-confirm`}>Change the Stack Rank?</h3>
          <p>This changes the Stack Rank of {changed.length} {changed.length === 1 ? "initiative" : "initiatives"} for everyone. It is one change in the audit log, and you can undo it from this page until someone ranks again.</p>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">The changes and the reasons</caption>
              <thead><tr><th scope="col">Initiative</th><th scope="col">Now</th><th scope="col">Vote suggests</th><th scope="col">Your order</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {moves.filter((m) => m.from !== m.to || diffIds.has(m.id)).map((m) => {
                  const r = byId.get(m.id)!;
                  const d = diffIds.has(m.id);
                  return (
                    <tr key={m.id}>
                      <td><strong>{r.code}</strong> {r.name}</td>
                      <td>#{m.from}</td>
                      <td>#{crowdOf.get(m.id)}</td>
                      <td>{describeRanks(m)} ({describeMove(m)})</td>
                      <td>
                        {d ? (
                          <label>
                            <span className="sr-only">Reason for {r.code}, up to {REASON_MAX} characters</span>
                            <input type="text" name={`reason_${m.id}`} maxLength={REASON_MAX} required value={reasons[m.id] ?? ""} onChange={(e) => setReasons((s) => ({ ...s, [m.id]: e.target.value }))} style={{ width: "100%" }} placeholder="Why this differs from the vote" />
                          </label>
                        ) : <span className="muted">as the vote suggests</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">Reasons are kept with this change and seen by admins only. They are never sent to GitHub or Jira.</p>
          <div className="row-form">
            <button type="submit" className="btn btn-primary" disabled={missing.length > 0}>Apply {changed.length} {changed.length === 1 ? "change" : "changes"} to Stack Rank</button>
            <button type="button" className="btn" onClick={() => setReview(false)}>Cancel</button>
            {missing.length > 0 && <span role="status" className="muted">Give a reason for {missing.length} {missing.length === 1 ? "initiative" : "initiatives"}.</span>}
          </div>
        </section>
      )}
    </form>
  );
}
