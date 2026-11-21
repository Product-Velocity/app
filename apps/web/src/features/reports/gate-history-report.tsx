"use client";

import { useEffect, useMemo, useState } from "react";
import { GATES, MIN_HISTORY, RECENT_DAYS, gateReport, gateTitle, type GateRequest, type GateReport, type Pace } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE } from "./echart";
import type { ReportEnv } from "./report-env";

const fmt = (n: number | null) => (n === null ? "–" : `${Math.round(n * 10) / 10}`);
const MUTED = "#5b6577";
const OUTCOME_COLOURS = { go: "#0f8a6a", go_with_conditions: "#c27a00", hold: MUTED, stop: "#b4472f" } as const;
/** Pace words: always text next to the colour. Something still waiting is never called "faster": it has not finished. */
const paceLabel = (p: Pace, pending: boolean) => p === "attention" ? "Needs attention" : p === "longer" ? "Longer than usual" : p === "faster" ? (pending ? "Within usual time" : "Faster than usual") : p === "usual" ? "Within usual time" : "Not enough history";
const PACE_COLOUR: Record<Pace, string> = { attention: "#b4472f", longer: "#c27a00", faster: "#0f8a6a", usual: "#2270ed", unknown: MUTED };
function PacePill({ pace, pending = true }: { pace: Pace; pending?: boolean }) { return <span className={`gh-pill gh-${pace}`}>{paceLabel(pace, pending)}</span>; }
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
  const [showAll, setShowAll] = useState(false);
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

  const attention = report.open.filter((o) => o.pace === "attention").length + report.ready.waiting.filter((w) => w.pace === "attention").length;
  const decided = report.gates.reduce((n, g) => n + g.decided, 0);
  const passed = report.gates.reduce((n, g) => n + g.outcomes.go + g.outcomes.go_with_conditions, 0);
  const stopped = report.gates.reduce((n, g) => n + g.outcomes.stop + g.outcomes.hold, 0);
  const oldest = report.open[0]?.days ?? null;
  const shown = showAll ? report.open : report.open.slice(0, 8);
  const maxOpen = Math.max(1, ...report.open.map((o) => o.days));

  return (
    <>
      <section className="rp-card rp-wide" aria-label="Gate history summary">
        <h2 className="rp-title">Gate history</h2>
        <p className="rp-note">Decision-gate requests of the initiatives that match the filters above, as of {today}. Days are counted from the request to the decision. Figures are for the whole team; nothing is shown per approver. “Usual” is what your own decided requests show (the middle half of them): there is no target to meet.</p>
        {report.total === 0 ? <p className="rp-empty" role="status">No data matching current filters</p> : (
          <div className="rp-kpis">
            <Kpi id="waiting" n={report.open.length} label="Waiting for a decision" sub={oldest === null ? "Nothing is waiting" : `Oldest ${plural(oldest, "day", "days")}`} />
            <Kpi id="attention" n={attention} label="Need attention" sub={attention ? "Far beyond the usual wait" : "Nothing stuck"} tone={attention ? "attention" : undefined} />
            <Kpi id="median" n={fmt(report.medianDaysToDecide)} label="Median days to decide" sub={report.gates.map((g) => `${g.gate} ${fmt(g.medianDaysToDecide)}`).join(" · ")} />
            <Kpi id="pass" n={decided ? `${Math.round((passed / decided) * 100)}%` : "–"} label="Go or Go with conditions" sub={decided ? `${stopped} Hold or Stop of ${decided} decided` : "Nothing decided yet"} />
            <Kpi id="unstarted" n={report.ready.waiting.length} label="Passed Gate B, not started" sub={report.ready.waiting.length ? `Oldest ${plural(report.ready.waiting[0]!.days, "day", "days")}` : "Everything has started"} />
          </div>
        )}
      </section>

      {report.total > 0 && (
        <>
          <section className="rp-card rp-wide" aria-label="Waiting for a decision">
            <h2 className="rp-title">Waiting for a decision</h2>
            <p className="rp-note">Open requests, longest wait first, compared with how long this gate usually takes. The bar is the wait so far; a request far beyond the usual wait is marked as needing attention because it may be blocked or stuck.</p>
            {report.open.length === 0 ? <p className="rp-empty" role="status">Nothing is waiting for a decision.</p> : (
              <>
                <ul className="gh-list">
                  {shown.map((o) => (
                    <li key={o.id} className="gh-row">
                      <button type="button" className="link-button gh-name" onClick={() => onOpen(o.itemId)}>{nameOf(o.itemId)}</button>
                      <span className="gh-gate" title={GATES[o.gate].question}>Gate {o.gate}</span>
                      <span className="gh-track" aria-hidden="true"><span className="gh-fill" style={{ width: `${Math.max(3, (o.days / maxOpen) * 100)}%`, background: PACE_COLOUR[o.pace] }} /></span>
                      <span className="gh-days">{plural(o.days, "day", "days")}</span>
                      <PacePill pace={o.pace} />
                    </li>
                  ))}
                </ul>
                {report.open.length > 8 && <button type="button" className="link-button" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${report.open.length}`}</button>}
              </>
            )}
          </section>

          <div className="gh-grid">
            <section className="rp-card" aria-label="Outcomes per gate">
              <h2 className="rp-title">Outcomes per gate</h2>
              <p className="rp-note">Share of decided requests by outcome.</p>
              <EChart name="gate-outcomes" label="Outcomes per gate as a share of decided requests" height={190} option={outcomeOption(report)} />
              <Numbers label="Outcomes per gate" head={["Gate", "Decided", "Go", "Go with conditions", "Hold", "Stop"]} rows={report.gates.map((g) => [gateTitle(g.gate), g.decided, g.outcomes.go, g.outcomes.go_with_conditions, g.outcomes.hold, g.outcomes.stop])} />
            </section>
            <section className="rp-card" aria-label="Initiatives through the gates">
              <h2 className="rp-title">Initiatives through the gates</h2>
              <p className="rp-note">Initiatives that asked at each gate, and how many passed it on their latest decision there.</p>
              <EChart name="gate-funnel" label="Initiatives that asked and passed at each gate" height={190} option={funnelOption(report)} />
              <Numbers label="Initiatives through the gates" head={["Gate", "Asked", "Passed", "Share passed"]} rows={report.funnel.map((f) => [gateTitle(f.gate), f.initiatives, f.passed, f.initiatives ? `${Math.round((f.passed / f.initiatives) * 100)}%` : "–"])} />
            </section>
          </div>

          <section className="rp-card rp-wide" aria-label="Time to decide">
            <h2 className="rp-title">Time to decide: what is usual, and the outliers</h2>
            <p className="rp-note">The blue bar is the middle half of decisions at each gate and the line in it the median; the grey line runs to the slowest usual decision. Red dots are decisions that took far longer than usual; rings are requests still waiting.</p>
            <EChart name="gate-spread" label="Days to decide per gate: usual range, median, long outliers and open requests" height={230} option={spreadOption(report)} />
            <ul className="gh-lately">
              {report.gates.map((g) => (
                <li key={g.gate}><b>Gate {g.gate}</b> {g.lately.signal === "unknown" ? <>{g.spread ? `${plural(g.lately.n, "decision", "decisions")} in the last ${RECENT_DAYS} days: too few to compare.` : `Not enough decided requests yet to say what is usual (at least ${MIN_HISTORY}).`}</> : <span className={`gh-pill gh-${g.lately.signal === "faster" ? "faster" : g.lately.signal === "slower" ? "longer" : "usual"}`}>{g.lately.signal === "faster" ? "Faster than usual lately" : g.lately.signal === "slower" ? "Slower than usual lately" : "In line with usual lately"}</span>}{g.lately.signal !== "unknown" && <span className="muted"> Median {fmt(g.lately.median)} days in the last {RECENT_DAYS} days against {fmt(g.lately.earlierMedian)} before.</span>}</li>
              ))}
            </ul>
            <Numbers label="Time to decide" head={["Gate", "Decided", "Fastest", "Usual range (days)", "Median", "Slowest usual", "Outliers"]} rows={report.gates.map((g) => [gateTitle(g.gate), g.decided, g.spread ? fmt(g.spread.min) : "–", g.spread ? `${fmt(g.spread.q1)} to ${fmt(g.spread.q3)}` : "–", fmt(g.medianDaysToDecide), g.spread ? fmt(Math.min(g.spread.max, g.spread.fence)) : "–", g.spread ? (g.outliers.length ? g.outliers.map((d) => fmt(d)).join(", ") : "None") : "Not enough history"])} />
          </section>
        </>
      )}

      {report.total > 0 && (
        <section className="rp-card rp-wide" aria-label="Decisions per gate table">
          <details className="rp-details">
            <summary>Show all figures per gate as a table</summary>
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
          </details>
        </section>
      )}

      <section className="rp-card rp-wide" aria-label="Ready to start">
        <h2 className="rp-title">Wait between Gate B and Start Building</h2>
        <p className="rp-note">For initiatives whose latest Gate B decision is Go or Go with conditions: the days from that decision to the Start Building date. {plural(report.ready.passed, "initiative", "initiatives")} passed Gate B, {report.ready.started.toLocaleString("en-GB")} started building. Median {fmt(report.ready.medianDays)} days, average {fmt(report.ready.averageDays)} days.</p>
        {report.ready.passed > 0 && (
          <>
            <EChart name="gate-ready" label="Initiatives that passed Gate B by days until Start Building, started and still waiting" height={210} option={readyOption(report)} />
            <Numbers label="Wait between Gate B and Start Building" head={["Days since Gate B", "Started building", "Still waiting"]} rows={report.ready.buckets.map((b) => [b.label, b.started, b.waiting])} />
          </>
        )}
        {report.ready.waiting.length === 0 ? <p className="rp-empty" role="status">Nothing is waiting to start.</p> : (
          <div className="rp-table-wrap">
            <table className="rp-table" aria-label="Passed Gate B and not started">
              <thead><tr><th scope="col">Initiative</th><th scope="col">Days since Gate B</th><th scope="col">Compared with usual</th></tr></thead>
              <tbody>{report.ready.waiting.map((w) => <tr key={w.id}><td><button type="button" className="link-button" onClick={() => onOpen(w.id)}>{nameOf(w.id)}</button></td><td>{w.days}</td><td><PacePill pace={w.pace} /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Kpi({ id, n, label, sub, tone }: { id: string; n: number | string; label: string; sub: string; tone?: "attention" }) {
  return (
    <div className={`rp-kpi${tone ? " gh-kpi-attention" : ""}`} data-kpi={id}>
      <span className="rp-kpi-n">{n}</span>
      <span className="rp-kpi-l">{label}</span>
      <span className="rp-kpi-l gh-kpi-sub">{sub}</span>
    </div>
  );
}

/** The numbers behind a chart, for keyboard and screen-reader users. */
function Numbers({ label, head, rows }: { label: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="rp-details">
      <summary>Show as table</summary>
      <div className="rp-table-wrap">
        <table className="rp-table" aria-label={label}>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={String(r[0])}>{r.map((c, i) => (i === 0 ? <th key={i} scope="row">{c}</th> : <td key={i}>{c}</td>))}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

const AXIS = { axisLabel: { fontFamily: CHART_FONT, color: "#374151", fontSize: 11 }, axisLine: { lineStyle: { color: "#d1d5db" } }, splitLine: { lineStyle: { color: "#eef0f3" } } };
const LEGEND = { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontFamily: CHART_FONT, color: "#111827", fontSize: 11 } };
const GRID = { left: 8, right: 24, top: 8, bottom: 34, containLabel: true };

function outcomeOption(r: GateReport): EChartsCoreOption {
  const defs = [["go", "Go"], ["go_with_conditions", "Go with conditions"], ["hold", "Hold"], ["stop", "Stop"]] as const;
  return {
    grid: GRID, legend: LEGEND,
    tooltip: { trigger: "item", formatter: (p: { seriesName: string; name: string; data: { count: number; value: number } }) => `<b>${p.name}</b><br/>${p.seriesName}: ${p.data.count} (${Math.round(p.data.value)}%)` },
    xAxis: { type: "value", max: 100, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: "{value}%" } },
    yAxis: { type: "category", inverse: true, data: r.gates.map((g) => `Gate ${g.gate}`), ...AXIS, splitLine: { show: false } },
    series: defs.map(([key, name]) => ({
      name, type: "bar", stack: "o", barWidth: 24, itemStyle: { color: OUTCOME_COLOURS[key] },
      label: { show: true, color: "#fff", fontFamily: CHART_FONT, fontWeight: 600, fontSize: 11, formatter: (p: { data: { count: number; value: number } }) => (p.data.value >= 8 ? String(p.data.count) : "") },
      data: r.gates.map((g) => ({ value: g.decided ? (g.outcomes[key] / g.decided) * 100 : 0, count: g.outcomes[key] })),
    })),
  };
}

function funnelOption(r: GateReport): EChartsCoreOption {
  return {
    grid: GRID, legend: LEGEND,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", minInterval: 1, ...AXIS },
    yAxis: { type: "category", inverse: true, data: r.funnel.map((f) => `Gate ${f.gate}`), ...AXIS, splitLine: { show: false } },
    series: [
      { name: "Asked", type: "bar", barWidth: 14, itemStyle: { color: "#2270ed", borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", fontFamily: CHART_FONT, fontSize: 11 }, data: r.funnel.map((f) => f.initiatives) },
      { name: "Passed", type: "bar", barWidth: 14, itemStyle: { color: "#0f8a6a", borderRadius: [0, 4, 4, 0] }, label: { show: true, position: "right", fontFamily: CHART_FONT, fontSize: 11 }, data: r.funnel.map((f) => f.passed) },
    ],
  };
}

function spreadOption(r: GateReport): EChartsCoreOption {
  const cats = r.gates.map((g) => `Gate ${g.gate}`);
  const at = (f: (g: GateReport["gates"][number]) => number | null) => r.gates.map((g) => (g.spread ? f(g) : null));
  const dot = (name: string, data: [number, string][], color: string, hollow: boolean, size: number) => ({
    name, type: "scatter", symbolSize: size, z: 5, itemStyle: hollow ? { color: "#fff", borderColor: color, borderWidth: 2 } : { color }, data: data.map(([x, y]) => ({ value: [x, y], itemStyle: hollow ? { color: "#fff", borderColor: color, borderWidth: 2 } : { color } })),
    tooltip: { formatter: (p: { value: [number, string] }) => `<b>${p.value[1]}</b><br/>${name}: ${Math.round(p.value[0])} days` },
  });
  const open = r.open.map((o) => ({ x: o.days, y: `Gate ${o.gate}`, pace: o.pace }));
  return {
    grid: GRID, legend: { ...LEGEND, data: ["Middle half of decisions", "Median", "Decided, far longer than usual", "Waiting now"] },
    tooltip: { trigger: "item" },
    xAxis: { type: "value", name: "days", nameLocation: "end", nameTextStyle: { fontFamily: CHART_FONT, color: MUTED }, min: 0, ...AXIS },
    yAxis: { type: "category", inverse: true, data: cats, ...AXIS, splitLine: { show: false } },
    series: [
      { name: "range-base", type: "bar", stack: "r", barGap: "-100%", barWidth: 4, silent: true, itemStyle: { color: "transparent" }, data: at((g) => g.spread!.min), tooltip: { show: false } },
      { name: "Usual range", type: "bar", stack: "r", barGap: "-100%", barWidth: 4, silent: true, itemStyle: { color: "#c9ced6" }, data: at((g) => Math.min(g.spread!.max, g.spread!.fence) - g.spread!.min), tooltip: { show: false } },
      { name: "iqr-base", type: "bar", stack: "i", barGap: "-100%", barWidth: 20, silent: true, itemStyle: { color: "transparent" }, data: at((g) => g.spread!.q1), tooltip: { show: false } },
      { name: "Middle half of decisions", type: "bar", stack: "i", barGap: "-100%", barWidth: 20, itemStyle: { color: "#9ec0f6", borderRadius: 4 }, data: at((g) => g.spread!.q3 - g.spread!.q1), tooltip: { formatter: (p: { name: string; dataIndex: number }) => { const s = r.gates[p.dataIndex]!.spread!; return `<b>${p.name}</b><br/>Middle half of decisions: ${fmt(s.q1)} to ${fmt(s.q3)} days`; } } },
      { name: "Median", type: "scatter", symbol: "rect", symbolSize: [3, 22], z: 4, itemStyle: { color: PALETTE[0] }, data: r.gates.map((g, i) => (g.spread ? { value: [g.spread.median, cats[i]] } : null)).filter((d) => d), tooltip: { formatter: (p: { value: [number, string] }) => `<b>${p.value[1]}</b><br/>Median: ${fmt(p.value[0])} days` } },
      dot("Decided, far longer than usual", r.gates.flatMap((g) => g.outliers.map((d) => [d, `Gate ${g.gate}`] as [number, string])), "#b4472f", false, 9),
      { ...dot("Waiting now", open.map((o) => [o.x, o.y] as [number, string]), MUTED, true, 10), data: open.map((o) => ({ value: [o.x, o.y], itemStyle: { color: "#fff", borderColor: PACE_COLOUR[o.pace], borderWidth: 2 } })) },
    ],
  };
}

function readyOption(r: GateReport): EChartsCoreOption {
  const b = r.ready.buckets;
  return {
    grid: GRID, legend: LEGEND, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "category", data: b.map((x) => x.label), ...AXIS, splitLine: { show: false } },
    yAxis: { type: "value", minInterval: 1, name: "initiatives", nameTextStyle: { fontFamily: CHART_FONT, color: MUTED }, ...AXIS },
    series: [
      { name: "Started building", type: "bar", stack: "w", barMaxWidth: 44, itemStyle: { color: "#0f8a6a" }, data: b.map((x) => x.started) },
      { name: "Still waiting", type: "bar", stack: "w", barMaxWidth: 44, itemStyle: { color: "#c27a00", borderRadius: [4, 4, 0, 0] }, data: b.map((x) => x.waiting) },
    ],
  };
}
