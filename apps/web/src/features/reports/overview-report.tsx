"use client";

import { useMemo, useState } from "react";
import { REPORT_GRID_COLUMNS, FIELD_BY_KEY, stackCounts, type ReportState } from "@pv/domain";
import { formatField } from "../portfolio/format";
import type { GridItem } from "../portfolio/types";
import { Donuts } from "./donuts";
import { ImpactEffort } from "./impact-chart";
import type { ReportEnv } from "./report-env";
import { StackedChart } from "./stacked-chart";
import { TimelineChart } from "./timeline-chart";
import { TimeToMarket } from "./ttm-charts";

const SHOWN = 200;
const FIELD_OF = (key: string) => FIELD_BY_KEY[key]!;

/** The first report (issue #233): click-to-filter donuts, stacked bars, Impact and Effort, Time to Market, the timeline and the matching rows. */
export function OverviewReport({ env, setState, onOpen }: { env: ReportEnv; setState: (f: (s: ReportState) => ReportState) => void; onOpen: (id: string) => void }) {
  const { controller, lookups, rows, ctx, state, label, pick, nameOf } = env;
  const [showAll, setShowAll] = useState(false);
  const teamPhase = useMemo(() => stackCounts(rows, "team", "initiative_phase", ctx), [rows, ctx]);
  const pmPhase = useMemo(() => stackCounts(rows, "product_manager", "initiative_phase", ctx), [rows, ctx]);
  const groupTeam = useMemo(() => stackCounts(rows, "group", "team", ctx), [rows, ctx]);
  const teamStatus = useMemo(() => stackCounts(rows, "team", "initiative_status", ctx), [rows, ctx]);
  const teamHealth = useMemo(() => stackCounts(rows, "team", "health", ctx), [rows, ctx]);

  const fields = REPORT_GRID_COLUMNS.map(FIELD_OF);
  const fmt = (f: (typeof fields)[number], r: GridItem) => formatField(f, r[f.key], { today: controller.todayDate(), members: lookups.members, projects: lookups.projects });
  const multiTeam = rows.some((r) => typeof r.contributing_teams === "string" && r.contributing_teams.includes(","));

  return (
    <>
      <Donuts rows={rows} ctx={ctx} state={state} label={label} onPick={pick} />

      <div className="rp-chart-tools" role="group" aria-label="Bar charts show">
        <span className="muted">Bars show</span>
        {([false, true] as const).map((p) => <button key={String(p)} type="button" className="tool-btn" aria-pressed={state.percent === p} onClick={() => setState((s) => ({ ...s, percent: p }))}>{p ? "Share of each bar (%)" : "Counts"}</button>)}
      </div>
      <div className="rp-grid">
        <StackedChart title="Initiatives by Product Manager and Phase" data={pmPhase} rowDim="product_manager" colDim="initiative_phase" label={label} state={state} percent={state.percent} onPick={pick} />
        <StackedChart title="Initiatives by Team and Phase" note={multiTeam ? "An initiative with several teams counts once per team." : undefined} data={teamPhase} rowDim="team" colDim="initiative_phase" label={label} state={state} percent={state.percent} onPick={pick} />
        <StackedChart title="Initiatives by Group and Team" note={multiTeam ? "An initiative with several teams counts once per team, so the bars can add up to more than the number of initiatives." : undefined} data={groupTeam} rowDim="group" colDim="team" label={label} state={state} percent={state.percent} onPick={pick} />
        <StackedChart title="Status by Team" data={teamStatus} rowDim="team" colDim="initiative_status" label={label} state={state} percent={state.percent} onPick={pick} />
        <StackedChart title="Health by Team" data={teamHealth} rowDim="team" colDim="health" label={label} state={state} percent={state.percent} onPick={pick} />
      </div>

      <ImpactEffort rows={rows} onPick={pick} onOpen={onOpen} nameOf={nameOf} />
      <TimeToMarket rows={rows} ctx={ctx} label={label} onPick={pick} onOpen={onOpen} nameOf={nameOf} />
      <TimelineChart rows={rows} today={controller.todayDate()} onOpen={onOpen} />

      <section className="rp-card" aria-label="Initiatives">
        <h2 className="rp-title">Initiatives</h2>
        {rows.length === 0 ? <p className="rp-empty" role="status">No data matching current filters</p> : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr>{fields.map((f) => <th key={f.key} scope="col">{f.name}</th>)}</tr></thead>
              <tbody>
                {(showAll ? rows : rows.slice(0, SHOWN)).map((r) => (
                  <tr key={r.id}>
                    {fields.map((f, i) => (
                      <td key={f.key}>
                        {i === 1 ? <button type="button" className="link-button" onClick={() => onOpen(r.id)}>{fmt(f, r)}</button> : f.key === "health" && r.health ? <span className={`pill health-${String(r.health).toLowerCase().replace(/[^a-z]+/g, "-")}`}>{fmt(f, r)}</span> : fmt(f, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAll && rows.length > SHOWN && <button type="button" className="tool-btn" onClick={() => setShowAll(true)}>Show all {rows.length.toLocaleString("en-GB")} rows</button>}
          </div>
        )}
      </section>
    </>
  );
}
