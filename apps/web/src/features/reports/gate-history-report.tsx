"use client";

import { useEffect, useMemo, useState } from "react";
import { GATES, gateReport, gateTitle, type GateRequest } from "@pv/domain";
import type { ReportEnv } from "./report-env";

const fmt = (n: number | null) => (n === null ? "–" : `${Math.round(n * 10) / 10}`);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * Gate history: requests, outcomes and the wait for a decision per gate, and the wait between Gate B and Start Building.
 * Follows the filters of the Reports tab. Team-level only: there is no per-approver breakdown (rule 8).
 */
export function GateHistoryReport({ env, load, onOpen }: { env: ReportEnv; load?: () => Promise<GateRequest[]>; onOpen: (id: string) => void }) {
  const { rows, nameOf, controller } = env;
  const [requests, setRequests] = useState<GateRequest[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    if (!load) return;
    load().then((r) => { if (live) { setRequests(r); setFailed(null); } }, (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : "Could not read the gate requests."); });
    return () => { live = false; };
  }, [load, reload]);

  const items = useMemo(() => new Map(rows.map((r) => [r.id, { startBuilding: typeof r.start_building === "string" && r.start_building ? r.start_building.slice(0, 10) : null }])), [rows]);
  const report = useMemo(() => gateReport(requests ?? [], items, controller.todayDate()), [requests, items, controller]);
  const today = controller.todayDate().toISOString().slice(0, 10);

  if (failed) return <div role="alert" className="error">Could not load the gate history: {failed} <button type="button" className="link-button" onClick={() => setReload((n) => n + 1)}>Try again</button></div>;
  if (!load || requests === null) return <p role="status" className="muted">{load ? "Loading the gate history…" : "The gate history is not available here."}</p>;

  return (
    <>
      <section className="rp-card rp-wide" aria-label="Gate history summary">
        <h2 className="rp-title">Gate history</h2>
        <p className="rp-note">Decision-gate requests of the initiatives that match the filters above, as of {today}. Days are counted from the request to the decision. Figures are for the whole team; nothing is shown per approver.</p>
        {report.total === 0 ? <p className="rp-empty" role="status">No data matching current filters</p> : (
          <div className="rp-table-wrap">
            <table className="rp-table" aria-label="Decisions per gate">
              <thead><tr><th scope="col">Gate</th><th scope="col">Requested</th><th scope="col">Waiting now</th><th scope="col">Decided</th><th scope="col">Go</th><th scope="col">Go with conditions</th><th scope="col">Hold</th><th scope="col">Stop</th><th scope="col">Fast lane</th><th scope="col">Withdrawn</th><th scope="col">Median days to decide</th><th scope="col">Average days</th><th scope="col">Longest open (days)</th></tr></thead>
              <tbody>
                {report.gates.map((g) => (
                  <tr key={g.gate}>
                    <th scope="row" title={GATES[g.gate].question}>{gateTitle(g.gate)}</th>
                    <td>{g.requested}</td><td>{g.open}</td><td>{g.decided}</td>
                    <td>{g.outcomes.go}</td><td>{g.outcomes.go_with_conditions}</td><td>{g.outcomes.hold}</td><td>{g.outcomes.stop}</td>
                    <td>{g.fastLane}</td><td>{g.withdrawn}</td>
                    <td>{fmt(g.medianDaysToDecide)}</td><td>{fmt(g.averageDaysToDecide)}</td><td>{g.longestOpenDays === null ? "–" : Math.floor(g.longestOpenDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rp-card rp-wide" aria-label="Ready to start">
        <h2 className="rp-title">Wait between Gate B and Start Building</h2>
        <p className="rp-note">For initiatives whose latest Gate B decision is Go or Go with conditions: the days from that decision to the Start Building date. {plural(report.ready.passed, "initiative", "initiatives")} passed Gate B, {report.ready.started.toLocaleString("en-GB")} started building. Median {fmt(report.ready.medianDays)} days, average {fmt(report.ready.averageDays)} days.</p>
        {report.ready.waiting.length === 0 ? <p className="rp-empty" role="status">Nothing is waiting to start.</p> : (
          <div className="rp-table-wrap">
            <table className="rp-table" aria-label="Passed Gate B and not started">
              <thead><tr><th scope="col">Initiative</th><th scope="col">Days since Gate B</th></tr></thead>
              <tbody>{report.ready.waiting.map((w) => <tr key={w.id}><td><button type="button" className="link-button" onClick={() => onOpen(w.id)}>{nameOf(w.id)}</button></td><td>{w.days}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
