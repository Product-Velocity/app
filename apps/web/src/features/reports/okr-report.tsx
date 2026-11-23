"use client";

import { useMemo } from "react";
import { currentQuarter, drillOn, inQuarter, objectiveByQuarter, okrByBusinessLine, stackCounts } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE, RADIUS } from "./echart";
import { DataTable } from "./health-report";
import type { ReportEnv } from "./report-env";
import { StackedChart } from "./stacked-chart";

/** A short list in a table cell: the values most used first, "+2" for the rest. */
const some = (values: string[], max = 3) => (values.length === 0 ? "–" : values.length <= max ? values.join(", ") : `${values.slice(0, max).join(", ")} +${values.length - max}`);
const short = (s: string) => (s.length > 34 ? `${s.slice(0, 33)}…` : s);

/**
 * OKRs report: (1) the Objectives grouped by Business Line with their initiative counts, (2) initiatives per Objective for each Planned
 * Quarter, to see how the focus moves from quarter to quarter, (3) the Objectives of the quarter we are in, split by Initiative Phase.
 * Same filters, pills, chart look and peek panel as the other reports; nothing is edited here, and no field leaves the platform.
 */
export function OkrReport({ env }: { env: ReportEnv }) {
  const { controller, rows, ctx, state, label, pick } = env;
  const quarter = currentQuarter(controller.todayDate());
  const groups = useMemo(() => okrByBusinessLine(rows), [rows]);
  const byQuarter = useMemo(() => objectiveByQuarter(rows, ctx), [rows, ctx]);
  const thisQuarter = useMemo(() => inQuarter(rows, quarter), [rows, quarter]);
  const quarterPhase = useMemo(() => stackCounts(thisQuarter, "objective", "initiative_phase", ctx), [thisQuarter, ctx]);
  const none = <p className="rp-empty" role="status">No data matching current filters</p>;

  const objectives = byQuarter.rows;
  const option = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 8, right: 40, top: 8, bottom: 36, containLabel: true },
    legend: { bottom: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: "#4b5563", fontFamily: CHART_FONT } },
    tooltip: { trigger: "item", textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const q = p as { seriesName: string; name: string; value: number }; return `<b>${q.name}</b><br/>${q.seriesName}: ${q.value} ${q.value === 1 ? "initiative" : "initiatives"}`; } },
    xAxis: { type: "value", minInterval: 1, axisLabel: { color: "#4b5563" }, splitLine: { lineStyle: { color: "#edeff3" } } },
    yAxis: { type: "category", inverse: true, data: objectives.map((o) => label("objective", o.key)), axisLabel: { color: "#111827", formatter: short }, axisTick: { show: false } },
    series: byQuarter.columns.map((q, i) => ({
      type: "bar", name: label("quarter", q), barMaxWidth: 16, itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0, RADIUS, RADIUS, 0] },
      label: { show: true, position: "right", color: "#111827", fontWeight: 600, formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : "") },
      emphasis: { focus: "series" }, data: objectives.map((o) => o.cells[q] ?? 0),
    })),
  }), [objectives, byQuarter.columns, label]);

  const total = rows.length;
  return (
    <>
      <section className="rp-card rp-wide" aria-label="Objectives by Business Line">
        <h2 className="rp-title">Objectives by Business Line</h2>
        <p className="rp-note">Initiatives per Objective, grouped by Business Line, after the filters above ({total.toLocaleString("en-GB")} initiatives). The two fields are independent, so an Objective can appear under more than one Business Line; initiatives without either are under “Not set”. Click an Objective or a count to filter.</p>
        {groups.length === 0 ? none : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th scope="col">Business Line</th><th scope="col">Objective</th><th scope="col">Focus Area</th><th scope="col">Owner</th><th scope="col">Business Value Type</th><th scope="col">Initiatives</th></tr></thead>
              {groups.map((g) => (
                <tbody key={g.key} aria-label={label("business_line", g.key)}>
                  {g.objectives.map((o, i) => (
                    <tr key={o.key}>
                      {i === 0 && <th scope="rowgroup" rowSpan={g.objectives.length}>
                        <button type="button" className="link-button" aria-pressed={drillOn(state, "business_line", g.key)} onClick={() => pick([{ dim: "business_line", key: g.key }])}>{label("business_line", g.key)}</button>
                        <div className="muted" data-total={g.total}>{g.total.toLocaleString("en-GB")} {g.total === 1 ? "initiative" : "initiatives"}</div>
                      </th>}
                      <td><button type="button" className="link-button" aria-pressed={drillOn(state, "objective", o.key)} onClick={() => pick([{ dim: "objective", key: o.key }])}>{label("objective", o.key)}</button></td>
                      <td>{some(o.focusAreas)}</td>
                      <td>{some(o.owners)}</td>
                      <td>{some(o.valueTypes)}</td>
                      <td><button type="button" className="link-button" aria-label={`${label("objective", o.key)} in ${label("business_line", g.key)}: ${o.count}`} onClick={() => pick([{ dim: "business_line", key: g.key }, { dim: "objective", key: o.key }])}><strong>{o.count.toLocaleString("en-GB")}</strong></button></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      <section className="rp-card rp-wide" aria-label="Initiatives per Objective by planned quarter">
        <h2 className="rp-title">Initiatives per Objective by planned quarter</h2>
        <p className="rp-note">How many initiatives each Objective has in each Planned Quarter, to see how the focus moves between quarters. Initiatives without a Planned Quarter are in “Unscheduled”. Click a bar to filter on that Objective and quarter.</p>
        {objectives.length === 0 ? none : (
          <>
            <EChart name="okr-quarters" label="Initiatives per Objective for each planned quarter" height={Math.max(160, objectives.length * (byQuarter.columns.length * 16 + 22) + 56)} option={option}
              onClick={(p) => { const o = objectives[p.dataIndex ?? -1]; const q = byQuarter.columns[p.seriesIndex ?? -1]; if (o && q) pick([{ dim: "objective", key: o.key }, { dim: "quarter", key: q }]); }} />
            <DataTable caption="Initiatives per Objective by planned quarter" head={["Objective", ...byQuarter.columns.map((q) => label("quarter", q)), "Total"]} rows={objectives.map((o) => [label("objective", o.key), ...byQuarter.columns.map((q) => o.cells[q] ?? 0), o.total])} />
          </>
        )}
      </section>

      <StackedChart title={`Objectives by Phase, planned for ${quarter}`} note={`The initiatives whose Planned Quarter is the current quarter (${quarter}, ${thisQuarter.length.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} after the filters), split by Initiative Phase.`} data={quarterPhase} rowDim="objective" colDim="initiative_phase" label={label} state={state} onPick={pick} />
    </>
  );
}
