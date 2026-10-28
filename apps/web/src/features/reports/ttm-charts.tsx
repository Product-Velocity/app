"use client";

import { useMemo } from "react";
import { DIM_LABEL, phaseDurations, ttmBy, ttmSummary, unsetLabel, type ReportCtx, type ReportDim, type ReportRow } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE, RADIUS } from "./echart";

const days = (n: number | null) => (n === null ? "–" : `${Math.round(n * 10) / 10}`);
const DAY_MS = 86_400_000;

type Group = { key: string; label: string; median: number; average: number; count: number };

/** A small table under a chart: the same numbers, reachable from the keyboard and read by screen readers. */
function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="rp-details">
      <summary>Show as table</summary>
      <table className="rp-table" aria-label={caption}>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

const baseGrid = { left: 8, right: 96, top: 24, bottom: 8, containLabel: true };

function barOption(groups: Group[], colour: string): EChartsCoreOption {
  return {
    grid: baseGrid,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const g = groups[(p as { dataIndex: number }[])[0]!.dataIndex]!; return `<b>${g.label}</b><br/>Median ${days(g.median)} days<br/>Average ${days(g.average)} days<br/>${g.count} ${g.count === 1 ? "initiative" : "initiatives"}`; } },
    xAxis: { type: "value", name: "days", nameLocation: "end", axisLabel: { color: "#4b5563" }, splitLine: { lineStyle: { color: "#edeff3" } } },
    yAxis: { type: "category", inverse: true, data: groups.map((g) => g.label), axisLabel: { color: "#111827" }, axisTick: { show: false } },
    series: [{ type: "bar", barMaxWidth: 22, showBackground: true, backgroundStyle: { color: "#f3f4f7", borderRadius: [0, RADIUS, RADIUS, 0] }, itemStyle: { color: colour, borderRadius: [0, RADIUS, RADIUS, 0] }, label: { show: true, position: "right", color: "#111827", formatter: (p: { dataIndex: number }) => `${days(groups[p.dataIndex]!.median)} d (n=${groups[p.dataIndex]!.count})` }, emphasis: { itemStyle: { color: "#2433a8" } }, data: groups.map((g) => g.median) }],
  };
}

type Props = {
  rows: readonly ReportRow[];
  ctx: ReportCtx;
  label: (dim: ReportDim, key: string) => string;
  /** Clicking a bar of Team or Effort filters like any other chart; clicking a dot opens the initiative. */
  onPick: (picks: { dim: ReportDim; key: string }[]) => void;
  onOpen: (id: string) => void;
  nameOf: (id: string) => string;
};

/** Module 4: Overall Time to Market card, median days by Team and by Effort, days in each phase, and every finished initiative as a dot. */
export function TimeToMarket({ rows, ctx, label, onPick, onOpen, nameOf }: Props) {
  const sum = useMemo(() => ttmSummary(rows), [rows]);
  const group = (dim: ReportDim): Group[] => ttmBy(rows, dim, ctx).map((g) => ({ ...g, label: g.key === "__none" ? unsetLabel(dim) : label(dim, g.key) }));
  const byTeam = useMemo(() => group("team"), [rows, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const byEffort = useMemo(() => { const g = group("effort"); const order = ["XS", "S", "M", "L", "XL"]; return g.sort((a, b) => (order.indexOf(a.key) + 99) % 99 - (order.indexOf(b.key) + 99) % 99); }, [rows, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const phases = useMemo(() => phaseDurations(rows), [rows]);
  const scatter = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 8, right: 24, top: 24, bottom: 24, containLabel: true },
    tooltip: { textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const d = (p as { data: [number, number, string] }).data; return `<b>${nameOf(d[2])}</b><br/>${d[1]} days<br/>Went to market ${new Date(d[0]).toISOString().slice(0, 10)}`; } },
    xAxis: { type: "time", name: "G2M Date (actual)", nameLocation: "middle", nameGap: 28, axisLabel: { color: "#4b5563", hideOverlap: true }, splitLine: { show: false } },
    yAxis: { type: "value", name: "days", axisLabel: { color: "#4b5563" }, splitLine: { lineStyle: { color: "#edeff3" } } },
    series: [{ type: "scatter", symbolSize: 12, itemStyle: { color: PALETTE[0], opacity: 0.85, borderColor: "#fff", borderWidth: 2 }, emphasis: { itemStyle: { color: "#2433a8", opacity: 1 } }, data: sum.points.map((p) => [p.end * DAY_MS, p.days, p.id]),
      markLine: sum.median === null ? undefined : { silent: true, symbol: "none", lineStyle: { color: "#c27a00", type: "dashed" }, label: { formatter: `median ${days(sum.median)}`, color: "#7a4a00" }, data: [{ yAxis: sum.median }] } }],
  }), [sum, nameOf]);
  const phaseOption = useMemo<EChartsCoreOption>(() => barOption(phases.map((p) => ({ key: p.phase, label: p.phase, median: p.median, average: p.average, count: p.count })), PALETTE[1]!), [phases]);

  const teamOption = useMemo(() => barOption(byTeam, PALETTE[0]!), [byTeam]);
  const effortOption = useMemo(() => barOption(byEffort, PALETTE[3]!), [byEffort]);
  const empty = sum.count === 0;
  const none = <p className="rp-empty" role="status">No data matching current filters</p>;
  return (
    <section className="rp-card rp-wide" aria-label="Time to Market">
      <h2 className="rp-title">Time to Market (days)</h2>
      <p className="rp-note">From the earlier of Start Discovery and Start Date to G2M Date (actual).</p>
      <div className="rp-kpis" role="group" aria-label="Overall Time to Market">
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="median">{days(sum.median)}</span><span className="rp-kpi-l">Median days</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="average">{days(sum.average)}</span><span className="rp-kpi-l">Average days</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="count">{sum.count}</span><span className="rp-kpi-l">Counted</span></div>
        <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="excluded">{sum.excluded}</span><span className="rp-kpi-l">Excluded (no G2M Date (actual) or start date)</span></div>
      </div>
      {empty ? none : (
        <div className="rp-ttm-grid">
          <div>
            <h3 className="rp-sub">Median days by Team</h3>
            <EChart name="ttm-team" label="Median days to market by team" height={Math.max(120, byTeam.length * 34 + 40)} option={teamOption} onClick={(p) => { const g = byTeam[p.dataIndex ?? -1]; if (g) onPick([{ dim: "team", key: g.key }]); }} />
            <DataTable caption="Median days by Team" head={[DIM_LABEL.team, "Median days", "Average days", "Initiatives"]} rows={byTeam.map((g) => [g.label, days(g.median), days(g.average), g.count])} />
          </div>
          <div>
            <h3 className="rp-sub">Median days by Effort</h3>
            <EChart name="ttm-effort" label="Median days to market by effort" height={Math.max(120, byEffort.length * 34 + 40)} option={effortOption} onClick={(p) => { const g = byEffort[p.dataIndex ?? -1]; if (g) onPick([{ dim: "effort", key: g.key }]); }} />
            <DataTable caption="Median days by Effort" head={[DIM_LABEL.effort, "Median days", "Average days", "Initiatives"]} rows={byEffort.map((g) => [g.label, days(g.median), days(g.average), g.count])} />
          </div>
          <div>
            <h3 className="rp-sub">Median days in each phase</h3>
            <EChart name="ttm-phase" label="Median days spent in each phase" height={Math.max(120, phases.length * 34 + 40)} option={phaseOption} />
            <DataTable caption="Days in each phase" head={["Phase", "Median days", "Average days", "Initiatives"]} rows={phases.map((p) => [p.phase, days(p.median), days(p.average), p.count])} />
          </div>
          <div>
            <h3 className="rp-sub">Each initiative: click a dot to open it</h3>
            <EChart name="ttm-scatter" label="Days to market of each initiative against the date it went to market" height={260} option={scatter} onClick={(p) => { const id = (p.data as [number, number, string] | undefined)?.[2]; if (id) onOpen(id); }} />
            <DataTable caption="Days to market of each initiative" head={["Initiative", "Days", "G2M Date (actual)"]} rows={sum.points.map((p) => [nameOf(p.id), p.days, new Date(p.end * DAY_MS).toISOString().slice(0, 10)])} />
          </div>
        </div>
      )}
    </section>
  );
}
