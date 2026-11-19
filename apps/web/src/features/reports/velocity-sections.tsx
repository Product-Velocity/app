"use client";

import { useMemo, type ReactNode } from "react";
import {
  DIM_LABEL, MIN_FOR_BOX, STAGES, SUB_PHASES, ZONES, decisionStats, groupStats, recentChange, sizeStats, stageAverages, stagesBy, subPhaseBySize, subPhaseStats, trendByQuarter, workWait,
  type GateRequest, type GroupStat, type ReportDim, type Stats, type VelocityRow, type VelocitySummary, type WindowCoverage,
} from "@pv/domain";
import type { ReportEnv } from "./report-env";
import { Bell, Donut, RangeChart, Stages, Trend, type RangeRow, type Slice } from "./velocity-charts";
import { DataTable } from "./ttm-charts";
import { STAGE_COLOURS, ZONE_COLOURS, adjustedText, compare, fmtDays, fmtNum, fmtWholeDays, inUnit, unitShort, type Unit } from "./velocity-format";

const None = () => <p className="rp-empty" role="status">No data matching current filters</p>;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A small (i) that explains a chart: opens on hover and on keyboard focus, and the same words are the accessible description. */
export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="vel-info" tabIndex={0} role="note" aria-label={`${title}. ${typeof children === "string" ? children : ""}`.trim()}>
      <span aria-hidden="true">i</span>
      <span className="vel-info-pop" role="tooltip"><b>{title}</b>{children}</span>
    </span>
  );
}

const READ_RANGE = (unit: string) => (
  <>
    <span>One row per {unit}, for the time measured chosen above. The blue box holds the middle half of the initiatives (25th to 75th percentile). The thin line runs from the fastest tenth to the slowest tenth (10th to 90th percentile). The black tick is the median: half were faster, half slower. The diamond is the average. The dashed orange line is the overall median. Rows with fewer than {MIN_FOR_BOX} initiatives show single dots. Only initiatives that reached the end of the measure are counted; a still-running one is never counted as zero.</span>
    <span><b>Numbers on the right</b>: the median, and how it compares with the overall median.</span>
  </>
);
const READ_ADJ = (
  <span><b>Size-adj.</b> compares the group with what its own mix of sizes predicts: for each initiative, take the overall median of its T-shirt size, then the median of those. +20% means the group takes 20% longer than expected for the work it does.</span>
);

function Legend() {
  return (
    <div className="vel-glyphs" aria-hidden="true">
      <span><svg width="30" height="12"><line x1="1" x2="29" y1="6" y2="6" stroke="#6b7280" strokeWidth="1.5" /><rect x="8" y="1" width="14" height="10" rx="2" fill="#2270ed" opacity=".85" /></svg> box: middle half (25th to 75th percentile), line: 10th to 90th</span>
      <span><svg width="12" height="12"><line x1="6" x2="6" y1="0" y2="12" stroke="#111827" strokeWidth="2.5" /></svg> median</span>
      <span><svg width="12" height="12"><path d="M6 1L11 6L6 11L1 6Z" fill="#fff" stroke="#111827" strokeWidth="1.5" /></svg> average</span>
    </div>
  );
}

// ---- how long it takes
type BellProps = { summary: VelocitySummary; vrows: readonly VelocityRow[]; unit: Unit; title: string; coverage: WindowCoverage; measure: { label: string; needs: string } };
export function BellCard({ summary, vrows, unit, title, coverage, measure }: BellProps) {
  const st = summary.stats;
  const recent = useMemo(() => recentChange(vrows), [vrows]);
  const days = useMemo(() => vrows.filter((v) => v.value !== null).map((v) => v.value!), [vrows]);
  const change = recent ? compare(recent.recent, recent.before) : null;
  const kpi = (id: string, n: string, label: string, extra?: ReactNode) => (
    <div className="rp-kpi"><span className="rp-kpi-n" data-kpi={id}>{n}<small className="vel-kpi-u">{id.startsWith("n-") || !st ? "" : ` ${unitShort(unit)}`}</small></span><span className="rp-kpi-l">{label}</span>{extra}</div>
  );
  const f = (d: number | undefined) => (d === undefined ? "–" : fmtNum(inUnit(d, unit), unit));
  return (
    <section className="rp-card rp-wide" aria-label="How long it takes">
      <h2 className="rp-title">{title}</h2>
      <p className="rp-note">Each bar counts the initiatives that took about that long. The curve smooths the bars into a bell. The markers show the median (half were faster) and the average. Colours mark the fastest tenth, the middle half and the slowest tenth.</p>
      <div className="rp-kpis" role="group" aria-label="Overall time">
        {kpi("median", f(st?.median), "Median", change && change.tone !== "same" ? <span className={`vel-delta vel-${change.tone}`}>{change.text} than before</span> : undefined)}
        {kpi("average", f(st?.average), "Average")}
        {kpi("p80", f(st?.p80), "80% finish within")}
        {kpi("p10", f(st?.p10), "Fastest tenth under")}
        {kpi("p90", f(st?.p90), "Slowest tenth over")}
        {kpi("n-counted", String(summary.counted), "Initiatives")}
        {kpi("n-notyet", String(summary.notThere), "Initiatives not there yet", <span className="vel-sub">still on the way, never counted as zero</span>)}
      </div>
      {!st || summary.counted < 3 ? (
        <div className="rp-empty vel-why" role="status">
          <p><b>{summary.counted === 0 ? `Nothing can be measured for ${measure.label} yet.` : `Only ${summary.counted} initiative${summary.counted === 1 ? "" : "s"} can be measured for ${measure.label}, too few for a distribution.`}</b> {measure.needs}</p>
          <p>Of the {coverage.initiatives} initiatives with these filters, {coverage.withStart} {coverage.withStart === 1 ? "has" : "have"} the start date, {coverage.withEnd} {coverage.withEnd === 1 ? "has" : "have"} the end date and {coverage.withBoth} {coverage.withBoth === 1 ? "has" : "have"} both.{coverage.withStart === 0 || coverage.withEnd === 0 ? " Fill the missing dates in the Grid, or pick another measure above (Build only needs Start Building)." : ""}</p>
        </div>
      ) : (
        <>
          <Bell days={days} unit={unit} median={st.median} average={st.average} />
          <ul className="vel-legend" aria-label="Zones of the bell">
            {ZONES.map((z, i) => {
              const range = [`under ${f(st.p10)}`, `${f(st.p10)} to ${f(st.p25)}`, `${f(st.p25)} to ${f(st.p75)}`, `${f(st.p75)} to ${f(st.p90)}`, `over ${f(st.p90)}`][i]!;
              return <li key={z}><i className="vel-sw" style={{ background: ZONE_COLOURS[i] }} />{z}: {range} {unitShort(unit)}</li>;
            })}
          </ul>
          <DataTable caption="Summary" head={["Measure", `Value (${unit})`]} rows={[["Median", f(st.median)], ["Average", f(st.average)], ["Fastest tenth under", f(st.p10)], ["Middle half from", f(st.p25)], ["Middle half to", f(st.p75)], ["80% finish within", f(st.p80)], ["Slowest tenth over", f(st.p90)], ["Initiatives", summary.counted]]} />
        </>
      )}
      {summary.noStart > 0 && summary.counted > 0 && <p className="rp-note vel-small">{summary.noStart} initiative{summary.noStart === 1 ? " has" : "s have"} no start date for this measure and {summary.noStart === 1 ? "is" : "are"} left out.</p>}
    </section>
  );
}

// ---- by size and by group
function toRows(groups: GroupStat[], unit: Unit, reference: number | null, labelOf: (key: string) => string, adjust: boolean): RangeRow[] {
  return groups.map((g) => {
    const s = g.stats;
    const cmp = reference && g.n >= MIN_FOR_BOX ? compare(s.median, reference) : null;
    const adj = adjust && g.n >= MIN_FOR_BOX ? adjustedText(g.adjusted) : null;
    const u = (d: number) => inUnit(d, unit);
    const name = labelOf(g.key);
    const tip = `<b>${esc(name)}</b> (n ${g.n})<br/>Median ${fmtDays(s.median, unit)}, average ${fmtDays(s.average, unit)}<br/>${g.n >= MIN_FOR_BOX ? `Middle half ${fmtDays(s.p25, unit)} to ${fmtDays(s.p75, unit)}<br/>10th percentile ${fmtDays(s.p10, unit)}, 90th ${fmtDays(s.p90, unit)}` : `Fewer than ${MIN_FOR_BOX}: shown as dots`}${adj ? `<br/>Against its size mix: ${esc(adj.replace("size-adj. ", ""))}` : ""}`;
    return {
      key: g.key, label: name, n: g.n, p10: u(s.p10), p25: u(s.p25), median: u(s.median), p75: u(s.p75), p90: u(s.p90), average: u(s.average), values: g.values.map(u),
      note: cmp ? cmp.text : g.n < MIN_FOR_BOX ? "few data" : "", ...(adj ? { adj } : {}), tone: cmp ? cmp.tone : "none", tip,
    };
  });
}
const groupTable = (groups: GroupStat[], unit: Unit, labelOf: (k: string) => string, adjust: boolean) => ({
  head: ["Group", "Initiatives", `Median (${unit})`, `Average (${unit})`, ...(adjust ? ["Against its size mix"] : [])],
  rows: groups.map((g) => [labelOf(g.key), g.n, fmtNum(inUnit(g.stats.median, unit), unit), fmtNum(inUnit(g.stats.average, unit), unit), ...(adjust ? [adjustedText(g.adjusted) ?? "–"] : [])]),
});

export function SizeCard({ vrows, unit, summary, env }: { vrows: readonly VelocityRow[]; unit: Unit; summary: VelocitySummary; env: ReportEnv }) {
  const groups = useMemo(() => sizeStats(vrows), [vrows]);
  const ref = summary.stats?.median ?? null;
  const rows = useMemo(() => toRows(groups, unit, ref, (k) => env.label("effort", k), false), [groups, unit, ref, env]);
  return (
    <section className="rp-card" aria-label="By T-shirt size">
      <div className="vel-h"><h2 className="rp-title">By T-shirt size</h2><InfoTip title="How to read it">{READ_RANGE("T-shirt size")}</InfoTip></div>
      <p className="rp-note">Do the sizes mean what we think they mean? Bars should step up from XS to XL with little overlap. Click a row to filter.</p>
      {rows.length === 0 ? <None /> : (
        <>
          <Legend />
          <RangeChart name="velocity-size" label={`Time by T-shirt size, in ${unit}`} rows={rows} reference={ref === null ? null : inUnit(ref, unit)} unit={unit} onPick={(k) => env.pick([{ dim: "effort", key: k }])} />
          <DataTable caption="Time by T-shirt size" {...groupTable(groups, unit, (k) => env.label("effort", k), false)} />
        </>
      )}
    </section>
  );
}

export function GroupCard({ vrows, unit, summary, dim, env }: { vrows: readonly VelocityRow[]; unit: Unit; summary: VelocitySummary; dim: ReportDim; env: ReportEnv }) {
  const groups = useMemo(() => groupStats(vrows, dim, env.ctx), [vrows, dim, env.ctx]);
  const ref = summary.stats?.median ?? null;
  const labelOf = (k: string) => env.label(dim, k);
  const rows = useMemo(() => toRows(groups, unit, ref, labelOf, true), [groups, unit, ref, env]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="rp-card" aria-label={`By ${DIM_LABEL[dim]}`}>
      <div className="vel-h"><h2 className="rp-title">By {DIM_LABEL[dim]}</h2><InfoTip title="How to read it"><>{READ_RANGE("group")}{READ_ADJ}</></InfoTip></div>
      <p className="rp-note">Slowest first. The dashed line is the overall median. &quot;Size-adj.&quot; compares a group with what its own mix of sizes would predict, so a group that does mostly large work is not called slow for it. Click a row to filter.</p>
      {rows.length === 0 ? <None /> : (
        <>
          <Legend />
          <RangeChart name="velocity-group" label={`Time by ${DIM_LABEL[dim]}, in ${unit}`} rows={rows} reference={ref === null ? null : inUnit(ref, unit)} unit={unit} onPick={(k) => env.pick([{ dim, key: k }])} />
          <DataTable caption={`Time by ${DIM_LABEL[dim]}`} {...groupTable(groups, unit, labelOf, true)} />
        </>
      )}
    </section>
  );
}

// ---- trend and working or waiting
export function TrendCard({ vrows, unit }: { vrows: readonly VelocityRow[]; unit: Unit }) {
  const points = useMemo(() => trendByQuarter(vrows), [vrows]);
  return (
    <section className="rp-card" aria-label="Are we getting faster">
      <h2 className="rp-title">Are we getting faster?</h2>
      <p className="rp-note">Median per quarter in which the initiative reached the end of the measure, with the middle half shaded. Quarters with fewer than 3 initiatives are left out.</p>
      {points.length < 2 ? <p className="rp-empty" role="status">Not enough quarters with 3 or more initiatives.</p> : (
        <>
          <Trend points={points} unit={unit} />
          <DataTable caption="Median per quarter" head={["Quarter", "Initiatives", `Median (${unit})`, `25th (${unit})`, `75th (${unit})`]} rows={points.map((p) => [p.quarter, p.n, fmtNum(inUnit(p.median, unit), unit), fmtNum(inUnit(p.p25, unit), unit), fmtNum(inUnit(p.p75, unit), unit)])} />
        </>
      )}
    </section>
  );
}

export function WorkWaitCard({ vrows }: { vrows: readonly VelocityRow[] }) {
  const w = useMemo(() => workWait(vrows), [vrows]);
  const total = w.work.reduce((s, a) => s + a.average, 0) + w.gate + w.queue;
  const slices = useMemo<Slice[]>(() => {
    const pct = (v: number) => `${Math.round((v / (total || 1)) * 100)}% of the elapsed time`;
    return [
      ...w.work.map((a) => ({ name: a.label, value: a.average, colour: STAGE_COLOURS[a.id], tip: pct(a.average) })),
      { name: "Waiting for a gate decision", value: w.gate, colour: "#aeb6c4", hatch: true, tip: pct(w.gate) },
      { name: "Waiting in a queue", value: w.queue, colour: "#c5ccd8", tip: pct(w.queue) },
    ];
  }, [w, total]);
  return (
    <section className="rp-card" aria-label="Working or waiting">
      <h2 className="rp-title">Working or waiting?</h2>
      <p className="rp-note">Share of elapsed time. Hatched means the initiative waited for a gate decision, grey means it waited in a queue.</p>
      {total === 0 ? <None /> : (
        <>
          <Donut name="velocity-wait" label={`${Math.round(w.waitShare * 100)}% of the elapsed time is waiting`} slices={slices} centre={`${Math.round(w.waitShare * 100)}%`} sub="waiting" />
          <ul className="vel-legend vel-legend-col">
            {slices.map((s) => <li key={s.name}><i className={`vel-sw${s.hatch ? " vel-hatch" : ""}`} style={s.hatch ? undefined : { background: s.colour }} />{s.name}<b>{Math.round((s.value / total) * 100)}%</b></li>)}
          </ul>
          <DataTable caption="Share of elapsed time" head={["Stage", "Share"]} rows={slices.map((s) => [s.name, `${Math.round((s.value / total) * 100)}%`])} />
        </>
      )}
    </section>
  );
}

// ---- where the time goes
export function StagesCard({ vrows, unit, dim, env }: { vrows: readonly VelocityRow[]; unit: Unit; dim: ReportDim; env: ReportEnv }) {
  const groups = useMemo(() => {
    const all = stageAverages(vrows);
    const n = vrows.filter((v) => v.value !== null).length;
    const by = stagesBy(vrows, dim, env.ctx).map((g) => ({ key: g.key, label: env.label(dim, g.key), n: g.n, stages: g.stages, total: g.total }));
    return n === 0 ? [] : [{ key: "__all", label: "All counted", n, stages: all, total: all.reduce((s, a) => s + a.average, 0) }, ...by];
  }, [vrows, dim, env]);
  return (
    <section className="rp-card rp-wide" aria-label="Where the time goes">
      <h2 className="rp-title">Where the time goes, by {DIM_LABEL[dim]}</h2>
      <p className="rp-note">Average time in each stage of the journey, for the initiatives counted above, so the bars add up to the average of the measure. Groups with fewer than 3 initiatives are left out.</p>
      {groups.length === 0 ? <None /> : (
        <>
          <ul className="vel-legend" aria-label="Stages">
            {(["discover", "define", "build", "test", "experiment"] as const).map((id) => <li key={id}><i className="vel-sw" style={{ background: STAGE_COLOURS[id] }} />{STAGES.find((s) => s.id === id)!.label}</li>)}
            <li><i className="vel-sw vel-hatch" />Waiting for a gate decision</li>
            <li><i className="vel-sw" style={{ background: "#c5ccd8" }} />Waiting in a queue</li>
          </ul>
          <Stages groups={groups} unit={unit} onPick={(k) => { if (k !== "__all") env.pick([{ dim, key: k }]); }} />
          <DataTable caption="Average per stage" head={["Group", "Initiatives", ...STAGES.map((s) => s.label)]} rows={groups.map((g) => [g.label, g.n, ...g.stages.map((a) => fmtNum(inUnit(a.average, unit), unit))])} />
        </>
      )}
    </section>
  );
}

// ---- decisions (always days, team level only)
const dayRow = (name: string, s: Stats, key: string, tip: string): RangeRow => ({ key, label: name, n: s.n, p10: s.p10, p25: s.p25, median: s.median, p75: s.p75, p90: s.p90, average: s.average, values: [], note: s.n < MIN_FOR_BOX ? "few data" : `avg ${Math.round(s.average)} d`, tone: "none", tip });
export function DecisionsCard({ env, requests, today, onOpen }: { env: ReportEnv; requests: readonly GateRequest[]; today: number; onOpen: (id: string) => void }) {
  const ids = useMemo(() => new Set(env.rows.map((r) => r.id)), [env.rows]);
  const stats = useMemo(() => decisionStats(requests, ids, today), [requests, ids, today]);
  const rows = useMemo(() => stats.filter((g) => g.stats).map((g) => {
    const s = g.stats!;
    const row = dayRow(`Gate ${g.gate}`, s, g.gate, `<b>Gate ${g.gate}</b> (n ${s.n})<br/>Median ${fmtWholeDays(s.median)}, average ${fmtWholeDays(s.average)}<br/>Middle half ${fmtWholeDays(s.p25)} to ${fmtWholeDays(s.p75)}<br/>10th percentile ${fmtWholeDays(s.p10)}, 90th ${fmtWholeDays(s.p90)}`);
    return row;
  }), [stats]);
  const open = useMemo(() => stats.flatMap((g) => g.open.map((o) => ({ ...o, gate: g.gate, usual: g.stats?.median ?? null }))).sort((a, b) => b.days - a.days).slice(0, 5), [stats]);
  const openCount = stats.reduce((s, g) => s + g.open.length, 0);
  const outcomes = useMemo(() => {
    const sum = { go: 0, go_with_conditions: 0, hold: 0, stop: 0 };
    for (const g of stats) for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += g.outcomes[k];
    return sum;
  }, [stats]);
  const decisions = outcomes.go + outcomes.go_with_conditions + outcomes.hold + outcomes.stop;
  const slices: Slice[] = [
    { name: "Go", value: outcomes.go, colour: "#0f8a6a", tip: `${outcomes.go} decisions` },
    { name: "Go with conditions", value: outcomes.go_with_conditions, colour: "#eab75a", tip: `${outcomes.go_with_conditions} decisions` },
    { name: "Hold", value: outcomes.hold, colour: "#a23b8f", tip: `${outcomes.hold} decisions` },
    { name: "Stop", value: outcomes.stop, colour: "#6b7280", tip: `${outcomes.stop} decisions` },
  ];
  return (
    <div className="vel-grid-21">
      <section className="rp-card" aria-label="Time to decide">
        <div className="vel-h"><h2 className="rp-title">Time to decide, by gate</h2><InfoTip title="How to read it">{READ_RANGE("gate")}</InfoTip></div>
        <p className="rp-note">Days from requesting a gate to the decision, for the team as a whole. Nothing is shown per approver.</p>
        {rows.length === 0 ? <None /> : (
          <>
            <Legend />
            <RangeChart name="velocity-decide" label="Days from the request to the decision, per gate" rows={rows} unit="days" wholeDays height={rows.length * 48 + 40} />
            <DataTable caption="Days to decide" head={["Gate", "Decided", "Median days", "Average days", "90th percentile days"]} rows={stats.filter((g) => g.stats).map((g) => [`Gate ${g.gate}`, g.stats!.n, Math.round(g.stats!.median), Math.round(g.stats!.average), Math.round(g.stats!.p90)])} />
          </>
        )}
        <h3 className="rp-sub vel-gap">Waiting now for a decision ({openCount})</h3>
        {open.length === 0 ? <p className="rp-empty">Nothing is waiting for a decision with these filters.</p> : (
          <div className="rp-table-wrap">
            <table className="rp-table" aria-label="Requests waiting for a decision">
              <thead><tr><th scope="col">Gate</th><th scope="col">Initiative</th><th scope="col">Waiting (days)</th><th scope="col">Against the usual</th></tr></thead>
              <tbody>{open.map((o) => {
                const c = o.usual ? o.days / o.usual : null;
                return <tr key={`${o.itemId}${o.gate}`}><td>{o.gate}</td><td><button type="button" className="link-button" onClick={() => onOpen(o.itemId)}>{env.nameOf(o.itemId)}</button></td><td>{o.days}</td><td>{c !== null && c >= 1.5 ? <span className="vel-pill">{c.toFixed(1)}× the median</span> : c !== null ? "within the usual range" : "–"}</td></tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="rp-card" aria-label="What the gates decided">
        <h2 className="rp-title">What the gates decided</h2>
        <p className="rp-note">All decisions of the filtered initiatives, gates A, B and C together.</p>
        {decisions === 0 ? <None /> : (
          <>
            <Donut name="velocity-outcomes" label="Share of Go, Go with conditions, Hold and Stop decisions" slices={slices.map((s) => ({ ...s, tip: `${s.value} of ${decisions} decisions (${Math.round((s.value / decisions) * 100)}%)` }))} centre={String(decisions)} sub="decisions" />
            <ul className="vel-legend vel-legend-col">{slices.map((s) => <li key={s.name}><i className="vel-sw" style={{ background: s.colour }} />{s.name}<b>{Math.round((s.value / decisions) * 100)}%</b></li>)}</ul>
          </>
        )}
      </section>
    </div>
  );
}

// ---- development sub-phases
export function SubPhasesCard({ vrows, unit, today }: { vrows: readonly VelocityRow[]; unit: Unit; today: number }) {
  const stats = useMemo(() => subPhaseStats(vrows, today), [vrows, today]);
  const bySize = useMemo(() => subPhaseBySize(vrows, today), [vrows, today]);
  const rows = useMemo<RangeRow[]>(() => stats.filter((s) => s.stats).map((s) => {
    const x = s.stats!, u = (d: number) => inUnit(d, unit);
    return { key: s.id, label: s.label, n: x.n, p10: u(x.p10), p25: u(x.p25), median: u(x.median), p75: u(x.p75), p90: u(x.p90), average: u(x.average), values: [], note: `avg ${fmtNum(u(x.average), unit)} ${unitShort(unit)}`, tone: "none" as const,
      tip: `<b>${esc(s.label)}</b> (n ${x.n})<br/>Median ${fmtDays(x.median, unit)}, average ${fmtDays(x.average, unit)}<br/>Middle half ${fmtDays(x.p25, unit)} to ${fmtDays(x.p75, unit)}<br/>10th percentile ${fmtDays(x.p10, unit)}, 90th ${fmtDays(x.p90, unit)}` };
  }), [stats, unit]);
  const max = (id: string) => Math.max(0, ...bySize.map((r) => r.cells[id as "build"].median ?? 0));
  return (
    <div className="vel-grid-21">
      <section className="rp-card" aria-label="Time in each sub-phase">
        <div className="vel-h"><h2 className="rp-title">Time in each sub-phase</h2><InfoTip title="How to read it">{READ_RANGE("sub-phase")}</InfoTip></div>
        <p className="rp-note">Build, Test and Experiment on their own, for initiatives that finished the sub-phase. Experiment is skipped on some initiatives; those are left out of its numbers. Build is the same as Actual Build.</p>
        {rows.length === 0 ? <None /> : (
          <>
            <Legend />
            <RangeChart name="velocity-subphase" label={`Time in each sub-phase, in ${unit}`} rows={rows} unit={unit} height={rows.length * 48 + 40} />
            <DataTable caption="Time in each sub-phase" head={["Sub-phase", "Initiatives", `Median (${unit})`, `Average (${unit})`]} rows={stats.filter((s) => s.stats).map((s) => [s.label, s.stats!.n, fmtNum(inUnit(s.stats!.median, unit), unit), fmtNum(inUnit(s.stats!.average, unit), unit)])} />
          </>
        )}
      </section>
      <section className="rp-card" aria-label="Median by size and sub-phase">
        <h2 className="rp-title">Median by size and sub-phase</h2>
        <p className="rp-note">Darker means longer within the column. The numbers are always shown. A cell needs 3 or more initiatives.</p>
        <div className="rp-table-wrap">
          <table className="rp-table vel-heat" aria-label="Median by size and sub-phase">
            <thead><tr><th scope="col">Size</th>{SUB_PHASES.map((s) => <th key={s.id} scope="col">{s.label}</th>)}</tr></thead>
            <tbody>
              {bySize.map((r) => (
                <tr key={r.size}>
                  <th scope="row">{r.size}</th>
                  {SUB_PHASES.map((s) => {
                    const c = r.cells[s.id];
                    return c.median === null
                      ? <td key={s.id} className="vel-heat-empty">–<small>n {c.n}</small></td>
                      : <td key={s.id} style={{ background: `color-mix(in srgb, #2270ed ${Math.round(8 + (c.median / (max(s.id) || 1)) * 42)}%, transparent)` }}>{fmtDays(c.median, unit)}<small>n {c.n}</small></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
