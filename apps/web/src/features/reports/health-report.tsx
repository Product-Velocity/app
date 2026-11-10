"use client";

import { useMemo, useState } from "react";
import { NEEDS_ATTENTION, UNSET, ageDays, agingSummary, dayNumber, daysInPhase, drillOn, healthCounts, isActive, isCompleted, longestInPhase, stackCounts, type NeedsAttention } from "@pv/domain";
import type { EChartsCoreOption } from "echarts/core";
import { CHART_FONT, EChart, PALETTE, RADIUS } from "./echart";
import type { ReportEnv } from "./report-env";
import { StackedChart } from "./stacked-chart";
import { TimeToMarket } from "./ttm-charts";
import { StatusPill } from "../../components/status-pill";

const SHOWN = 200;
const LONGEST = 10;
const fmtDays = (n: number | null) => (n === null ? "–" : `${Math.round(n * 10) / 10}`);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

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

/**
 * Roadmap Health (request R-129, issue #287): where active work piles up, how long it has been in its phase, which initiatives are Blocked,
 * At Risk or Delayed, and how long finished work took. Same filters, pills, chart look and peek panel as Overview; nothing is edited here.
 */
export function HealthReport({ env, onOpen }: { env: ReportEnv; onOpen: (id: string) => void }) {
  const { controller, rows, ctx, state, label, pick, nameOf } = env;
  const [showAll, setShowAll] = useState(false);
  const today = controller.todayDate();
  const todayN = dayNumber(today);
  const todayText = today.toISOString().slice(0, 10);

  const active = useMemo(() => rows.filter(isActive), [rows]);
  const completed = useMemo(() => rows.filter(isCompleted), [rows]);
  const counts = useMemo(() => healthCounts(active), [active]);
  const aging = useMemo(() => agingSummary(active, todayN), [active, todayN]);
  const longest = useMemo(() => longestInPhase(active, todayN, LONGEST), [active, todayN]);
  const teamPhase = useMemo(() => stackCounts(active, "team", "initiative_phase", ctx), [active, ctx]);
  const teamHealth = useMemo(() => stackCounts(active, "team", "health", ctx), [active, ctx]);
  const multiTeam = active.some((r) => typeof r.contributing_teams === "string" && r.contributing_teams.includes(","));
  const list = useMemo(() => [...active].sort((a, b) => (daysInPhase(b, todayN) ?? -1) - (daysInPhase(a, todayN) ?? -1) || a.stack_rank - b.stack_rank), [active, todayN]);

  const phaseKey = (phase: string) => (phase === "Not set" ? UNSET : phase);
  const option = useMemo<EChartsCoreOption>(() => ({
    grid: { left: 8, right: 110, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, textStyle: { fontFamily: CHART_FONT }, formatter: (p: unknown) => { const g = aging.phases[(p as { dataIndex: number }[])[0]!.dataIndex]!; return `<b>${g.phase}</b><br/>Median ${fmtDays(g.median)} days<br/>Longest ${fmtDays(g.max)} days<br/>${plural(g.withDate, "initiative", "initiatives")} with a date${g.missing ? `<br/>${g.missing} without a date` : ""}`; } },
    xAxis: { type: "value", name: "days", nameLocation: "end", axisLabel: { color: "#4b5563" }, splitLine: { lineStyle: { color: "#edeff3" } } },
    yAxis: { type: "category", inverse: true, data: aging.phases.map((g) => g.phase), axisLabel: { color: "#111827" }, axisTick: { show: false } },
    series: [{ type: "bar", barMaxWidth: 22, showBackground: true, backgroundStyle: { color: "#f3f4f7", borderRadius: [0, RADIUS, RADIUS, 0] }, itemStyle: { color: PALETTE[0], borderRadius: [0, RADIUS, RADIUS, 0] }, label: { show: true, position: "right", color: "#111827", formatter: (p: { dataIndex: number }) => { const g = aging.phases[p.dataIndex]!; return g.withDate === 0 ? "no date" : `${fmtDays(g.median)} d (n=${g.withDate})`; } }, emphasis: { itemStyle: { color: "#1a56c4" } }, data: aging.phases.map((g) => g.median ?? 0) }],
  }), [aging]);

  const tile = (n: number, text: string, onClick?: () => void, pressed?: boolean, kpi?: string) => onClick ? (
    <button type="button" className="rp-kpi rp-kpi-btn" aria-pressed={pressed} onClick={onClick}><span className="rp-kpi-n" data-kpi={kpi}>{n.toLocaleString("en-GB")}</span><span className="rp-kpi-l">{text}</span></button>
  ) : (
    <div className="rp-kpi"><span className="rp-kpi-n" data-kpi={kpi}>{n.toLocaleString("en-GB")}</span><span className="rp-kpi-l">{text}</span></div>
  );
  const none = <p className="rp-empty" role="status">No data matching current filters</p>;

  return (
    <>
      <section className="rp-card rp-wide" aria-label="Roadmap Health summary">
        <h2 className="rp-title">Roadmap Health</h2>
        <p className="rp-note">Active initiatives (Initiative Status is Active) as of {todayText}, after the filters above. Click Blocked, At Risk or Delayed to see only those; click again to remove the filter.</p>
        <div className="rp-kpis" role="group" aria-label="Active initiatives and those that need attention">
          {tile(counts.active, "Active initiatives", undefined, undefined, "active")}
          {NEEDS_ATTENTION.map((h: NeedsAttention) => tile(counts.counts[h], h, () => pick([{ dim: "health", key: h }]), drillOn(state, "health", h), h.toLowerCase().replace(" ", "-")))}
          <div className="rp-kpi"><span className="rp-kpi-n" data-kpi="median-in-phase">{fmtDays(aging.median)}</span><span className="rp-kpi-l">Median days in current phase</span></div>
          {tile(aging.missing, "Active without a usable phase date (left out of the days)", undefined, undefined, "missing")}
        </div>
      </section>

      <div className="rp-grid">
        <StackedChart title="Active initiatives by Team and Phase" note={multiTeam ? "An initiative with several teams counts once per team, so the bars can add up to more than the number of initiatives." : undefined} data={teamPhase} rowDim="team" colDim="initiative_phase" label={label} state={state} percent={state.percent} onPick={pick} />
        <StackedChart title="Active initiatives by Team and Health" note={multiTeam ? "An initiative with several teams counts once per team." : undefined} data={teamHealth} rowDim="team" colDim="health" label={label} state={state} percent={state.percent} onPick={pick} />
      </div>

      <section className="rp-card rp-wide" aria-label="Aging by phase">
        <h2 className="rp-title">Active aging: median days in the current phase</h2>
        <p className="rp-note">Today minus the start date of the phase the initiative is in (Start Discovery, Start Definition, …), else the day Phase Changed At. {aging.missing > 0 ? `${plural(aging.missing, "active initiative has", "active initiatives have")} no usable date and ${aging.missing === 1 ? "is" : "are"} not in the bars.` : "Every active initiative has a date."} {aging.ageMissing > 0 ? `${plural(aging.ageMissing, "has", "have")} no Start Date or Planned Start for the overall age.` : ""}{aging.ageMedian !== null ? ` Median age since Start Date: ${fmtDays(aging.ageMedian)} days.` : ""}</p>
        {aging.phases.length === 0 ? none : (
          <>
            <EChart name="health-aging" label="Median days in the current phase, by phase" height={Math.max(120, aging.phases.length * 34 + 40)} option={option} onClick={(p) => { const g = aging.phases[p.dataIndex ?? -1]; if (g) pick([{ dim: "initiative_phase", key: phaseKey(g.phase) }]); }} />
            <DataTable caption="Days in the current phase by phase" head={["Phase", "Active", "With a date", "Without a date", "Median days", "Average days", "Longest days"]} rows={aging.phases.map((g) => [g.phase, g.count, g.withDate, g.missing, fmtDays(g.median), fmtDays(g.average), fmtDays(g.max)])} />
          </>
        )}
      </section>

      <section className="rp-card rp-wide" aria-label="Longest in current phase">
        <h2 className="rp-title">Longest in their current phase</h2>
        {longest.length === 0 ? none : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th scope="col">Initiative</th><th scope="col">Phase</th><th scope="col">Health</th><th scope="col">Days in phase</th></tr></thead>
              <tbody>
                {longest.map((w) => { const r = rows.find((x) => x.id === w.id)!; return (
                  <tr key={w.id}>
                    <td><button type="button" className="link-button" onClick={() => onOpen(w.id)}>{nameOf(w.id)}</button></td>
                    <td>{String(r.initiative_phase ?? "Not set")}</td>
                    <td>{r.health ? <StatusPill value={String(r.health)} /> : "Not set"}</td>
                    <td>{w.days}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="rp-note">Completed delivery duration uses completed initiatives only (Initiative Status is Completed); an initiative without G2M Date (actual) or a start date is counted as excluded.</p>
      <TimeToMarket rows={completed} ctx={ctx} label={label} onPick={pick} onOpen={onOpen} nameOf={nameOf} />

      <section className="rp-card" aria-label="Active initiatives">
        <h2 className="rp-title">Active initiatives, longest in phase first</h2>
        {list.length === 0 ? none : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th scope="col">ID</th><th scope="col">Initiative</th><th scope="col">Phase</th><th scope="col">Health</th><th scope="col">Team</th><th scope="col">Days in phase</th><th scope="col">Age (days)</th></tr></thead>
              <tbody>
                {(showAll ? list : list.slice(0, SHOWN)).map((r) => (
                  <tr key={r.id}>
                    <td>{String(r.item_code ?? "")}</td>
                    <td><button type="button" className="link-button" onClick={() => onOpen(r.id)}>{String(r.initiative_name ?? r.id)}</button></td>
                    <td>{String(r.initiative_phase ?? "Not set")}</td>
                    <td>{r.health ? <StatusPill value={String(r.health)} /> : "Not set"}</td>
                    <td>{String(r.contributing_teams ?? "")}</td>
                    <td>{daysInPhase(r, todayN) ?? "No date"}</td>
                    <td>{ageDays(r, todayN) ?? "No date"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAll && list.length > SHOWN && <button type="button" className="tool-btn" onClick={() => setShowAll(true)}>Show all {list.length.toLocaleString("en-GB")} rows</button>}
          </div>
        )}
      </section>
    </>
  );
}
