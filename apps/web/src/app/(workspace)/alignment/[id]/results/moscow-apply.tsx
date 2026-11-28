"use client";
import { useState } from "react";
import { REASON_MAX } from "@pv/domain";
import { MOSCOW_VALUES, type MoscowRow, type MoscowValue } from "@/lib/alignment-moscow";

/**
 * Set the MoSCoW from the vote (issue #746). Every initiative starts ticked with the vote's suggestion as its new value; the admin can untick one,
 * change its value, and then reviews. Wherever the final value differs from the suggestion a reason is asked for. An initiative that already has the
 * value is shown as unchanged. Nothing changes until the last button is pressed, and only a person can press it.
 */
export function MoscowApply({ sessionId, rows, skipped, apply }: { sessionId: string; rows: MoscowRow[]; skipped: number; apply: (form: FormData) => Promise<void> }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(rows.map((r) => r.itemId)));
  const [finals, setFinals] = useState<Record<string, MoscowValue>>(() => Object.fromEntries(rows.map((r) => [r.itemId, r.suggested])));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const seen = JSON.stringify(Object.fromEntries(rows.map((r) => [r.itemId, r.current ?? ""])));
  const chosen = rows.filter((r) => on.has(r.itemId));
  const changing = chosen.filter((r) => finals[r.itemId] !== r.current);
  const overwriting = changing.filter((r) => r.current !== null);
  const differing = changing.filter((r) => finals[r.itemId] !== r.suggested);
  const missing = differing.filter((r) => (reasons[r.itemId] ?? "").trim().length === 0);
  const toggle = (id: string) => { setReview(false); setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  return (
    <form action={apply} className="stack">
      <input type="hidden" name="session" value={sessionId} />
      <input type="hidden" name="seen" value={seen} />
      {skipped > 0 && <p className="muted">{skipped} {skipped === 1 ? "initiative is" : "initiatives are"} left out: removed or in the Trash.</p>}
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Set the MoSCoW from the vote</caption>
          <thead><tr><th scope="col">Set</th><th scope="col">Initiative</th><th scope="col">Now</th><th scope="col">The vote suggests</th><th scope="col">New value</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const final = finals[r.itemId]!;
              const ticked = on.has(r.itemId);
              const same = final === r.current;
              return (
                <tr key={r.itemId}>
                  <td><input type="checkbox" name="item" value={r.itemId} checked={ticked} onChange={() => toggle(r.itemId)} aria-label={`Set the MoSCoW of ${r.code}`} /></td>
                  <td><strong>{r.code}</strong> {r.name}</td>
                  <td>{r.current ?? <span className="muted">Not set</span>}</td>
                  <td>{r.suggested}{r.tied && <span className="muted"> (level, cautious choice)</span>}{r.contested && !r.tied && <span className="muted"> (contested)</span>}</td>
                  <td>
                    <select name={`final_${r.itemId}`} value={final} disabled={!ticked} aria-label={`New MoSCoW for ${r.code}`} onChange={(e) => { setReview(false); setFinals({ ...finals, [r.itemId]: e.target.value as MoscowValue }); }}>
                      {MOSCOW_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    {ticked && same && <span className="muted"> unchanged</span>}
                    {ticked && !same && r.current !== null && <strong> overwrites {r.current}</strong>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!review && <div><button type="button" className="btn" disabled={chosen.length === 0} onClick={() => setReview(true)}>Review the changes</button></div>}
      {review && (
        <div className="notice" role="region" aria-label="Review the changes">
          <p><strong>{changing.length === 0 ? "Nothing would change." : `${changing.length} ${changing.length === 1 ? "initiative changes" : "initiatives change"}${overwriting.length > 0 ? `, ${overwriting.length} of them overwriting a value that is set now` : ""}.`}</strong></p>
          <ul>
            {changing.map((r) => (
              <li key={r.itemId}>
                <strong>{r.code}</strong> {r.name}: {r.current ?? "not set"} → <strong>{finals[r.itemId]}</strong>
                {finals[r.itemId] !== r.suggested && (
                  <label className="stack">
                    <span>The vote suggested {r.suggested}. Why a different value? <span className="muted">(admins only, up to {REASON_MAX} characters)</span></span>
                    <input type="text" name={`reason_${r.itemId}`} maxLength={REASON_MAX} value={reasons[r.itemId] ?? ""} onChange={(e) => setReasons({ ...reasons, [r.itemId]: e.target.value })} required />
                  </label>
                )}
              </li>
            ))}
          </ul>
          <div className="row-form">
            <button type="submit" className="btn btn-primary" disabled={changing.length === 0 || missing.length > 0}>Set the MoSCoW</button>
            <button type="button" className="btn" onClick={() => setReview(false)}>Back</button>
          </div>
          {missing.length > 0 && <p className="muted">A reason is needed for {missing.length} {missing.length === 1 ? "initiative" : "initiatives"}.</p>}
        </div>
      )}
    </form>
  );
}
