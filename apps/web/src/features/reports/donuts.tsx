"use client";

import { useMemo } from "react";
import { DIM_LABEL, drillOn, shareOf, unsetLabel, type ReportCtx, type ReportDim, type ReportRow, type ReportState } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE, RADIUS } from "./echart";

const DONUT_DIMS: readonly ReportDim[] = ["initiative_status", "initiative_phase", "focus_area", "team", "moscow"];

type Props = {
  rows: readonly ReportRow[];
  ctx: ReportCtx;
  state: ReportState;
  label: (dim: ReportDim, key: string) => string;
  onPick: (picks: { dim: ReportDim; key: string }[]) => void;
};

/**
 * One-glance overview: how the shown initiatives divide by Status, Phase, Focus Area, Team and MoSCoW. A slice filters like any other chart.
 * A dimension with a single value is not drawn (a ring of 100% says nothing); it is named in a line under the row instead.
 */
export function Donuts({ rows, ctx, state, label, onPick }: Props) {
  const data = useMemo(() => DONUT_DIMS.map((dim) => ({ dim, shares: shareOf(rows, dim, ctx) })), [rows, ctx]);
  const drawn = data.filter((d) => d.shares.length > 1);
  const single = data.filter((d) => d.shares.length === 1);
  if (rows.length === 0) return <section className="rp-card rp-wide" aria-label="Overview"><h2 className="rp-title">Overview</h2><p className="rp-empty" role="status">No data matching current filters</p></section>;
  return (
    <section className="rp-card rp-wide" aria-label="Overview">
      <h2 className="rp-title">Overview</h2>
      <div className="rp-donuts">
        {drawn.map(({ dim, shares }) => <Donut key={dim} dim={dim} shares={shares} state={state} label={label} onPick={onPick} />)}
      </div>
      {single.length > 0 && <p className="rp-note">{single.map(({ dim, shares }) => `${DIM_LABEL[dim]}: ${label(dim, shares[0]!.key)} (all ${shares[0]!.count})`).join(" · ")}</p>}
      <details className="rp-details">
        <summary>Show as table</summary>
        <table className="rp-table" aria-label="Overview shares">
          <thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Initiatives</th><th scope="col">Share</th></tr></thead>
          <tbody>{data.flatMap(({ dim, shares }) => shares.map((s) => <tr key={`${dim}${s.key}`}><td>{DIM_LABEL[dim]}</td><td>{label(dim, s.key)}</td><td>{s.count}</td><td>{Math.round(s.percent)}%</td></tr>))}</tbody>
        </table>
      </details>
    </section>
  );
}

function Donut({ dim, shares, state, label, onPick }: { dim: ReportDim; shares: ReturnType<typeof shareOf>; state: ReportState; label: Props["label"]; onPick: Props["onPick"] }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    tooltip: { trigger: "item", textStyle: { fontFamily: CHART_FONT }, formatter: (p: { name: string; value: number; percent: number }) => `<b>${p.name}</b><br/>${p.value} (${Math.round(p.percent)}%)` },
    legend: { bottom: 0, type: "scroll", itemWidth: 10, itemHeight: 10, textStyle: { fontFamily: CHART_FONT, color: "#111827", fontSize: 11 } },
    series: [{
      type: "pie", radius: ["42%", "74%"], center: ["50%", "42%"], avoidLabelOverlap: true, minAngle: 8, padAngle: 3,
      itemStyle: { borderRadius: RADIUS + 2, borderColor: "#fff", borderWidth: 2 },
      emphasis: { scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: "rgba(17, 24, 39, 0.25)" } },
      label: { show: true, position: "inside", formatter: (p: { percent: number }) => (p.percent >= 12 ? `${Math.round(p.percent)}%` : ""), color: "#fff", fontSize: 11, fontWeight: 600 },
      data: shares.map((s, i) => ({ name: s.key === "__none" ? unsetLabel(dim) : label(dim, s.key), value: s.count, itemStyle: { color: PALETTE[i % PALETTE.length], ...(drillOn(state, dim, s.key) ? { borderColor: "#111827", borderWidth: 3 } : {}) } })),
    }],
  }), [shares, dim, state, label]);
  const total = shares.reduce((n, s) => n + s.count, 0);
  return (
    <div className="rp-donut">
      <h3 className="rp-sub">{DIM_LABEL[dim]}</h3>
      <div className="rp-donut-box">
        <div className="rp-donut-total" aria-hidden="true"><b>{total}</b><span>{total === 1 ? "initiative" : "initiatives"}</span></div>
      <EChart name={`donut-${dim}`} label={`${DIM_LABEL[dim]}: share of initiatives`} height={230} option={option} onClick={(p) => { const s = shares[(p as { dataIndex?: number }).dataIndex ?? -1]; if (s) onPick([{ dim, key: s.key }]); }} />
      </div>
    </div>
  );
}
