"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useScope } from "../workspace/scope";
import type { PortfolioController } from "../portfolio/controller";
import { useWorkspaceController } from "../portfolio/portfolio-client";
import { useStatus } from "../portfolio/status-strip";
import type { Lookups } from "../portfolio/types";
import { computeInsights, type InsightRow, type Meter, type Slice } from "./insights";

export function InsightsClient({ tenantId, role, userId, lookups }: { tenantId: string; role: string; userId: string; lookups: Lookups }) {
  const { state, retry } = useWorkspaceController(tenantId, role, lookups, userId);
  if (state.kind === "loading") return <><h1>Insights</h1><p role="status" className="muted">Loading…</p></>;
  if (state.kind === "error") return <div role="alert" className="error">Could not load the roadmap: {state.message} <button type="button" className="link-button" onClick={retry}>Try again</button></div>;
  return <Insights controller={state.controller} lookups={lookups} tenantId={tenantId} />;
}

const HEALTH_CLASS: Record<string, string> = { "On Track": "ok", "At Risk": "risk", Delayed: "late", Blocked: "bad", "No health": "none" };

/** Key charts for a phone: a few numbers, each chart with its own sentence and a table, team and initiative level only. */
export function Insights({ controller, lookups, tenantId }: { controller: PortfolioController; lookups: Lookups; tenantId: string }) {
  const status = useStatus(controller);
  const scope = useScope();
  const data = useMemo(() => {
    const rows = controller.rows.filter((r) => scope.projectIds === null || scope.projectIds.includes(r.home_project)) as unknown as InsightRow[];
    return computeInsights(rows, (id) => lookups.projects.find((p) => p.id === id)?.name ?? "");
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, status.version, scope.projectIds, lookups]);
  const maxPhase = Math.max(1, ...data.phases.map((p) => p.count));
  const maxQuarter = Math.max(1, ...data.quarters.map((q) => q.count));
  return (
    <div className="phone-insights stack">
      <h1>Insights</h1>
      <p className="muted">Active initiatives only. Numbers are for initiatives and teams, never for people.</p>
      <ul className="insight-tiles" aria-label="Key numbers">
        <li><span className="insight-num">{data.active}</span><span>active</span></li>
        <li><span className="insight-num">{data.needAttention}</span><span>need attention</span></li>
        <li><span className="insight-num">{data.waitingForDecision}</span><span>waiting for a decision</span></li>
      </ul>

      <Chart id="health" title="Health" summary={data.summary.health} table={<Table head={["Health", "Initiatives", "Share"]} rows={data.health.map((h) => [h.label, String(h.count), `${h.pct}%`])} />}>
        {data.health.length > 0 && (
          <>
            <div className="seg-bar" role="img" aria-label={data.summary.health}>
              {data.health.map((h) => <span key={h.label} className={`seg seg-${HEALTH_CLASS[h.label]}`} style={{ flexGrow: h.count }} />)}
            </div>
            <ul className="seg-legend">
              {data.health.map((h) => <li key={h.label}><span className={`seg-swatch seg-${HEALTH_CLASS[h.label]}`} aria-hidden="true" />{h.label} <strong>{h.count}</strong> <span className="muted">({h.pct}%)</span></li>)}
            </ul>
          </>
        )}
      </Chart>

      <Chart id="phase" title="Where the work is" summary={data.summary.phases} table={<Table head={["Phase", "Initiatives", "Share"]} rows={data.phases.map((p) => [p.label, String(p.count), `${p.pct}%`])} />}>
        <Bars items={data.phases} max={maxPhase} />
      </Chart>

      <Chart id="build" title="Build progress by project" summary={data.summary.build} table={<Table head={["Project", "In Build", "Average progress"]} rows={data.build.map((b) => [b.label, String(b.count), b.value === null ? "not reported" : `${b.value}%`])} />}>
        <Meters items={data.build} />
      </Chart>

      <Chart id="quarter" title="Planned quarters" summary={data.summary.quarters} table={<Table head={["Quarter", "Initiatives", "Share"]} rows={data.quarters.map((q) => [q.label, String(q.count), `${q.pct}%`])} />}>
        <Bars items={data.quarters} max={maxQuarter} />
      </Chart>

      <p className="insight-links"><Link href={`/w/${tenantId}/leadership`}>Leadership and the weekly update</Link> · <Link href={`/w/${tenantId}/reports`}>Reports</Link></p>
    </div>
  );
}

function Chart({ id, title, summary, table, children }: { id: string; title: string; summary: string; table: React.ReactNode; children: React.ReactNode }) {
  return (
    <figure className="insight-chart" aria-labelledby={`ic-${id}`}>
      <figcaption><h2 id={`ic-${id}`}>{title}</h2><p>{summary}</p></figcaption>
      {children}
      <details className="insight-table"><summary>Show as a table</summary>{table}</details>
    </figure>
  );
}

function Bars({ items, max }: { items: Slice[]; max: number }) {
  return (
    <ul className="bar-list" aria-hidden="true">
      {items.map((i) => (
        <li key={i.label}><span className="bar-label">{i.label}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${(i.count / max) * 100}%` }} /></span><span className="bar-value">{i.count}</span></li>
      ))}
    </ul>
  );
}

function Meters({ items }: { items: Meter[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="bar-list" aria-hidden="true">
      {items.map((i) => (
        <li key={i.label}><span className="bar-label">{i.label}</span><span className="bar-track"><span className="bar-fill" style={{ width: `${i.value ?? 0}%` }} /></span><span className="bar-value">{i.value === null ? "n/a" : `${i.value}%`}</span></li>
      ))}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table>
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
    </table>
  );
}
