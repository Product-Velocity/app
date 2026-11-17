"use client";

import { useMemo } from "react";
import { DIM_LABEL, buildTimeBy, buildTimeSummary, buildVsEstimate, unsetLabel, type ReportCtx, type ReportDim, type ReportRow } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE } from "./echart";
import { DataTable, barOption, type Group } from "./ttm-charts";

const num = (n: number | null) => (n === null ? "–" : `${Math.round(n * 10) / 10}`);
const DAY_MS = 86_400_000;

type Props = {
  rows: readonly ReportRow[];
  ctx: ReportCtx;
  label: (dim: ReportDim, key: string) => string;
  /** Clicking a bar of Team or Effort filters like any other chart; clicking a dot opens the initiative. */
  onPick: (picks: { dim: ReportDim; key: string }[]) => void;
  onOpen: (id: string) => void;
  nameOf: (id: string) => string;
};

/**
 * Build time (issue #480): how many weeks the build took, from Start Building to the tracker's Build Completed (or the start of the next phase when the tracker has none),
 * the same number as the grid column Actual Build (weeks). Median and average, by Team and by Effort, against the high estimate, and every initiative as a dot.
 * Team-level only: nothing here is about a person (rule 8).
 */
export function BuildTime({ rows, ctx, label, onPick, onOpen, nameOf }: Props) {
  const sum = useMemo(() => buildTimeSummary(rows), [rows]);
  const est = useMemo(() => buildVsEstimate(rows), [rows]);
  const group = (dim: ReportDim): Group[] => buildTimeBy(rows, dim, ctx).map((g) => ({ ...g, label: g.key === "__none" ? unsetLabel(dim) : label(dim, g.key) }));
  const byTeam = useMemo(() => group("team"), [rows, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const byEffort = useMemo(() => { const order = ["XS", "S", "M", "L", "XL"]; return group("effort").sort((a, b) => (order.indexOf(a.key) + 99) % 99 - (order.indexOf(b.key) + 99) % 99); }, [rows, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const teamOption = useMemo(() => barOption(byTeam, PALETTE[0]!, "weeks"), [byTeam]);
  const effortOption = useMemo(() => barOption(byEffort, PALETTE[3]!, "weeks"), [byEffort]);
  const withEnd = sum.points.filter((p) => p.end !== null);
  const scatter = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 8, right: 24, top: 24, bottom: 24, containLabel: true },
    tooltip: { textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const d = (p as { data: [number, number, string] }).data; return `<b>${nameOf(d[2])}</b><br/>${d[1]} weeks<br/>Build ended ${new Date(d[0]).toISOString().slice(0, 10)}`; } },
    xAxis: { type: "time", name: "Build ended", nameLocation: "middle", nameGap: 28, axisLabel: { color: "#4b5563", hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: "value", name: "weeks", axisLabel: { color: "#4b5563" }, splitLine: { lineStyle: { color: "#edeff3" } } },
    series: [{ type: "scatter", symbolSize: 12, itemStyle: { color: PALETTE[0], opacity: 0.85, borderColor: "#fff", borderWidth: 2 }, emphasis: { itemStyle: { color: "#1a56c4", opacity: 1 } }, data: withEnd.map((p) => [Date.parse(`${p.end}T00:00:00Z`), p.weeks, p.id]),
      markLine: sum.median === null ? undefined : { silent: true, symbol: "none", lineStyle: { color: "#c27a00", type: "dashed" }, label: { formatter: `median ${num(sum.median)}`, color: "#7a4a00" }, data: [{ yAxis: sum.median }] } }],
  }), [sum, withEnd, nameOf]);
  const empty = sum.count === 0;
  return (
    <section className="rp-card rp-wide" aria-label="Build time">
      <h2 className="rp-title">Build time (weeks)</h2>
      <p className="rp-note">From Start Building to Build Completed, the tracker&apos;s own date (a GitHub ticket closed as completed, or a Jira issue resolved while done); where the tracker has no completion, to the start of the next phase. The same number as the Actual Build (weeks) column. Initiatives that started building and have no end yet are counted apart, never as zero.</p>
      <div className="rp-kpis" role="group" aria-label="Overall build time">
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="build-median">{num(sum.median)}</span><span className="rp-kpi-l">Median weeks</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="build-average">{num(sum.average)}</span><span className="rp-kpi-l">Average weeks</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="build-count">{sum.count}</span><span className="rp-kpi-l">Counted</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="build-still">{sum.stillBuilding}</span><span className="rp-kpi-l">Still building (no end yet)</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="build-estimate">{est.median === null ? "–" : `${Math.round(est.median)}%`}</span><span className="rp-kpi-l">{est.count === 0 ? "Of the high estimate (no estimate on a counted initiative)" : `Median of the high estimate (${est.over} of ${est.count} took longer)`}</span></div>
      </div>
      {empty ? <p className="rp-empty" role="status">No data matching current filters</p> : (
        <div className="rp-ttm-grid">
          <div>
            <h3 className="rp-sub">Median weeks by Team</h3>
            <EChart name="build-team" label="Median build weeks by team" height={Math.max(120, byTeam.length * 34 + 40)} option={teamOption} onClick={(p) => { const g = byTeam[p.dataIndex ?? -1]; if (g) onPick([{ dim: "team", key: g.key }]); }} />
            <DataTable caption="Median build weeks by Team" head={[DIM_LABEL.team, "Median weeks", "Average weeks", "Initiatives"]} rows={byTeam.map((g) => [g.label, num(g.median), num(g.average), g.count])} />
          </div>
          <div>
            <h3 className="rp-sub">Median weeks by Effort</h3>
            <EChart name="build-effort" label="Median build weeks by effort" height={Math.max(120, byEffort.length * 34 + 40)} option={effortOption} onClick={(p) => { const g = byEffort[p.dataIndex ?? -1]; if (g) onPick([{ dim: "effort", key: g.key }]); }} />
            <DataTable caption="Median build weeks by Effort" head={[DIM_LABEL.effort, "Median weeks", "Average weeks", "Initiatives"]} rows={byEffort.map((g) => [g.label, num(g.median), num(g.average), g.count])} />
          </div>
          <div>
            <h3 className="rp-sub">Each initiative: click a dot to open it</h3>
            <EChart name="build-scatter" label="Build weeks of each initiative against the date its build ended" height={260} option={scatter} onClick={(p) => { const id = (p.data as [number, number, string] | undefined)?.[2]; if (id) onOpen(id); }} />
            <DataTable caption="Build weeks of each initiative" head={["Initiative", "Weeks", "Build started", "Build ended"]} rows={sum.points.map((p) => [nameOf(p.id), num(p.weeks), p.start, p.end ?? "–"])} />
          </div>
        </div>
      )}
    </section>
  );
}
