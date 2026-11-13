"use client";
import { Loading } from "@/components/pill-loader";
import { useEffect, useState } from "react";
import { agreementText, decisionText, placeLabel, type CrowdRow, type RankDecision } from "@pv/domain";
import type { PortfolioController } from "./controller";
import { METHODS } from "@/lib/alignment";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const methodName = (m: CrowdRow["method"]) => METHODS.find((x) => x.value === m)?.label ?? m;

/**
 * The Alignment tab of the item panel (issue #393): what the crowd said about this initiative in closed alignment sessions.
 * Aggregates only. The current result is the latest closed session; earlier ones stay as history. People who are not admins see a result
 * only when its session lets participants see results, so an empty tab does not mean nobody voted.
 * The panel gives this tab a key per initiative, so moving to another one starts from the loading state.
 */
export function AlignmentTab({ controller, itemId }: { controller: PortfolioController; itemId: string }) {
  const [rows, setRows] = useState<CrowdRow[] | null>(null);
  const [decided, setDecided] = useState<RankDecision[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    controller.crowd(itemId).then((r) => { if (!cancelled) { setRows(r); setError(null); } }, (e: Error) => { if (!cancelled) setError(e.message); });
    // what admins decided and why (issue #397): the database gives it to admins only; a failure here must not hide the result
    controller.decisions(itemId).then((d) => { if (!cancelled) setDecided(d); }, () => undefined);
    return () => { cancelled = true; };
  }, [controller, itemId]);

  if (error) return <p role="alert" className="pf-error">Could not load the alignment results: {error}</p>;
  if (!rows) return <Loading>Loading the alignment results…</Loading>;
  if (rows.length === 0) {
    return (
      <div className="ip-empty">
        <h3>Alignment</h3>
        <p className="muted">No alignment result to show yet. A result appears here when an alignment session that includes this initiative has closed. People who are not admins see it only if the session allows participants to see results.</p>
      </div>
    );
  }
  const [current, ...earlier] = rows as [CrowdRow, ...CrowdRow[]];
  const decision = (sessionId: string) => {
    const d = decided.find((x) => x.sessionId === sessionId);
    return d ? <p className="ip-decision"><strong>Decision:</strong> {decisionText(d)} <em>Reason:</em> {d.reason}</p> : null;
  };
  return (
    <div className="ip-alignment">
      <h3>Alignment</h3>
      <section aria-labelledby="ip-al-current">
        <h4 id="ip-al-current">Current result <span className="muted">· {current.sessionName}, closed {day(current.closedAt)}</span></h4>
        <dl className="ip-facts">
          <div><dt>Place in the vote</dt><dd>{placeLabel(current)} of {current.ofItems}{current.tied && <span className="muted"> (tied)</span>}</dd></div>
          <div><dt>Score (top = 100)</dt><dd>{current.score.toFixed(1)}</dd></div>
          <div><dt>People who voted</dt><dd>{current.voters}</dd></div>
          <div><dt>Method</dt><dd>{methodName(current.method)}</dd></div>
        </dl>
        <p className={current.contested ? "ip-contested" : "muted"}>{current.contested ? <strong>{agreementText(current)}</strong> : agreementText(current)}</p>
        {decision(current.sessionId)}
      </section>
      <section aria-labelledby="ip-al-history">
        <h4 id="ip-al-history">Earlier sessions</h4>
        {earlier.length === 0 ? <p className="muted">This initiative has been in one session so far.</p> : (
          <ol className="ip-log">
            {earlier.map((r) => (
              <li key={r.sessionId}>
                <p><strong>{r.sessionName}</strong> <span className="muted">closed {day(r.closedAt)}</span></p>
                <p>Place {placeLabel(r)} of {r.ofItems} · score {r.score.toFixed(1)} · {r.voters} voted{r.contested ? " · contested" : ""}</p>
                {decision(r.sessionId)}
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="muted">These are anonymous results: no names, and groups with fewer than 5 voters are never shown on their own. They are advice; a person decides the Stack Rank.</p>
    </div>
  );
}
