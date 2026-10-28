"use client";

import { useMemo } from "react";
import { effortKr, unsetLabel, type ReportRow } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE } from "./echart";

const SHOWN = 15;
const fmt = (n: number | null) => (n === null ? "–" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n));

type Props = {
  rows: readonly ReportRow[];
  onPick: (picks: { dim: "effort"; key: string }[]) => void;
  onOpen: (id: string) => void;
  nameOf: (id: string) => string;
};

/**
 * Module 3, version 1: how much work is in each effort size, how many of those initiatives have a Primary KR, and the KRs themselves.
 * The impact side (planned against achieved) waits for the outcome fields of phase 7; its place is held by a placeholder that says so.
 */
export function ImpactEffort({ rows, onPick, onOpen, nameOf }: Props) {
  const s = useMemo(() => effortKr(rows), [rows]);
  const label = (k: string) => (k === "__none" ? unsetLabel("effort") : k);
  const option = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, textStyle: { fontFamily: CHART_FONT, color: "#111827" } },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontFamily: CHART_FONT } },
    xAxis: { type: "category", data: s.sizes.map((g) => label(g.key)), axisLabel: { color: "#111827" }, axisTick: { show: false } },
    yAxis: { type: "value", minInterval: 1, name: "initiatives", axisLabel: { color: "#4b5563" }, splitLine: { lineStyle: { color: "#edeff3" } } },
    series: [
      { name: "With a Primary KR", type: "bar", stack: "n", barMaxWidth: 40, itemStyle: { color: PALETTE[0] }, label: { show: true, color: "#fff", formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : "") }, data: s.sizes.map((g) => g.withKr) },
      { name: "No Primary KR", type: "bar", stack: "n", barMaxWidth: 40, itemStyle: { color: "#9aa3b2" }, label: { show: true, color: "#fff", formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : "") }, data: s.sizes.map((g) => g.withoutKr) },
    ],
  }), [s]);

  return (
    <section className="rp-card rp-wide" aria-label="Impact and Effort">
      <h2 className="rp-title">Impact and Effort</h2>
      <p className="rp-note">
        Effort is how big the work is; impact is shown through the Primary KR (start and target) where one is set.{" "}
        <span data-kpi="no-kr">{s.withoutKr}</span> of {s.total} {s.total === 1 ? "initiative has" : "initiatives have"} no Primary KR.
      </p>
      {s.total === 0 ? <p className="rp-empty" role="status">No data matching current filters</p> : (
        <div className="rp-ttm-grid">
          <div>
            <h3 className="rp-sub">Initiatives by Effort, with and without a Primary KR</h3>
            <EChart name="impact-effort" label="Initiatives by effort size, with and without a Primary KR" height={280} option={option} onClick={(p) => { const g = s.sizes[p.dataIndex ?? -1]; if (g) onPick([{ dim: "effort", key: g.key }]); }} />
            <details className="rp-details">
              <summary>Show as table</summary>
              <table className="rp-table" aria-label="Initiatives by Effort and Primary KR">
                <thead><tr><th scope="col">Effort</th><th scope="col">Initiatives</th><th scope="col">With a Primary KR</th><th scope="col">No Primary KR</th></tr></thead>
                <tbody>{s.sizes.map((g) => <tr key={g.key}><td>{label(g.key)}</td><td>{g.total}</td><td>{g.withKr}</td><td>{g.withoutKr}</td></tr>)}</tbody>
              </table>
            </details>
          </div>
          <div>
            <h3 className="rp-sub">Primary KRs, largest effort first</h3>
            {s.krs.length === 0 ? <p className="rp-empty" role="status" data-testid="no-krs">No initiative here has a Primary KR yet.</p> : (
              <div className="rp-table-wrap">
                <table className="rp-table" aria-label="Primary KRs">
                  <thead><tr><th scope="col">Initiative</th><th scope="col">Effort</th><th scope="col">Primary KR</th><th scope="col">Start</th><th scope="col">Target</th><th scope="col">Unit</th><th scope="col">Direction</th></tr></thead>
                  <tbody>{s.krs.slice(0, SHOWN).map((k) => (
                    <tr key={k.id}><td><button type="button" className="link-button" onClick={() => onOpen(k.id)}>{nameOf(k.id)}</button></td><td>{label(k.effort)}</td><td>{k.metric || "–"}</td><td>{fmt(k.start)}</td><td>{fmt(k.target)}</td><td>{k.unit || "–"}</td><td>{k.direction || "–"}</td></tr>
                  ))}</tbody>
                </table>
                {s.krs.length > SHOWN && <p className="rp-note">Showing {SHOWN} of {s.krs.length}. Filter, or export the list, to see the rest.</p>}
              </div>
            )}
          </div>
          <div className="rp-placeholder" role="note" data-testid="impact-placeholder">
            <h3 className="rp-sub">Impact achieved (placeholder)</h3>
            <p>Planned against achieved impact for each effort size needs Outcome Verdict and % Realized KR Value, which arrive with Outcomes (phase 7). This space will then show it without changing the page; until then nothing here is estimated.</p>
          </div>
        </div>
      )}
    </section>
  );
}
