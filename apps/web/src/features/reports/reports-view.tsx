"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BAR_DIMS, DIM_FIELD, DIM_LABEL, FIELD_BY_KEY, REPORT_DIMS, REPORT_GRID_COLUMNS, UNSET, compareValues, drillOn, emptyReport, matchesReport, optionsFor,
  parseReport, quarterChoices, serializeReport, stackCounts, toggleDrill, unsetLabel, type ReportDim, type ReportState,
} from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import { downloadCsv, selectionToCsv } from "../portfolio/export-selection";
import { formatField } from "../portfolio/format";
import { ItemPanel } from "../portfolio/item-panel";
import { Popover } from "../portfolio/popover";
import { StatusStrip, useStatus } from "../portfolio/status-strip";
import type { GridItem, Lookups } from "../portfolio/types";
import { useScope } from "../workspace/scope";
import { StackedChart } from "./stacked-chart";
import { TimelineChart } from "./timeline-chart";
import { TimeToMarket } from "./ttm-charts";

const SHOWN = 200;
const FIELD_OF = (key: string) => FIELD_BY_KEY[key]!;

/** Writes the filters into the address (other parameters such as ?scope= stay), without reloading. */
function writeAddress(state: ReportState) {
  const url = new URL(window.location.href);
  for (const k of [...url.searchParams.keys()]) if (k.startsWith("f.") || k === "d" || k === "arch" || k === "draft") url.searchParams.delete(k);
  for (const [k, v] of serializeReport(state)) url.searchParams.append(k, v);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Reports tab (issue #233, step 1): filter bar, click-to-filter pills, Product Manager x Phase, Group x Team and Team x Status / Health charts, and the matching rows. */
export function ReportsView({ controller, lookups, me }: { controller: PortfolioController; lookups: Lookups; me: string | null }) {
  const status = useStatus(controller);
  const params = useSearchParams();
  const scope = useScope();
  const [state, setState] = useState<ReportState>(() => parseReport(params));
  const [peekId, setPeekId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => writeAddress(state), [state]);

  const teamNames = useMemo(() => (lookups.teams ?? []).map((t) => t.name), [lookups.teams]);
  const ctx = useMemo(() => ({ teamNames }), [teamNames]);
  const inScope = useMemo<GridItem[]>(
    () => controller.rows.filter((r) => scope.projectIds === null || scope.projectIds.includes(r.home_project)),
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, status.version, scope.projectIds],
  );
  const rows = useMemo(() => inScope.filter((r) => matchesReport(r, state, ctx)).sort((a, b) => a.stack_rank - b.stack_rank), [inScope, state, ctx]);

  const label = useCallback((dim: ReportDim, key: string) => {
    if (key === UNSET) return unsetLabel(dim);
    if (dim === "product_manager") return lookups.members.find((m) => m.user_id === key)?.email ?? "unknown person";
    return key;
  }, [lookups.members]);

  /** The choices of a bar filter: what the field allows plus every value in use, "not set" last. */
  const choices = useCallback((dim: ReportDim): string[] => {
    const inUse = new Set<string>();
    for (const r of inScope) { const v = r[DIM_FIELD[dim]]; if (typeof v === "string" && v) (dim === "team" ? v.split(/,\s*/) : [v]).forEach((x) => inUse.add(x)); }
    let list: string[];
    if (dim === "product_manager") list = lookups.members.map((m) => m.user_id);
    else if (dim === "team") list = teamNames;
    else if (dim === "group") list = lookups.groups ?? [];
    else if (dim === "quarter") list = quarterChoices(inUse);
    else list = optionsFor(DIM_FIELD[dim]).map((o) => o.value);
    return [...new Set([...list, ...inUse].filter((v) => dim !== "team" || teamNames.includes(v)))].concat(UNSET).sort((a, b) => (dim === "quarter" || dim === "product_manager" ? 0 : compareValues(dim, a, b)));
  }, [inScope, lookups.members, lookups.groups, teamNames]);

  const setFilter = (dim: ReportDim, values: string[]) => setState((s) => ({ ...s, filters: { ...s.filters, [dim]: values } }));
  /** A click on a chart: if everything picked is already a pill, remove those pills; else add the missing ones. */
  const pick = (picks: { dim: ReportDim; key: string }[]) => setState((s) => {
    const allOn = picks.every((p) => drillOn(s, p.dim, p.key));
    return picks.reduce((acc, p) => (allOn === drillOn(acc, p.dim, p.key) ? toggleDrill(acc, p.dim, p.key) : acc), s);
  });
  const barCount = BAR_DIMS.reduce((n, d) => n + (state.filters[d]?.length ? 1 : 0), 0);
  const anything = barCount > 0 || state.drill.length > 0;

  const pmPhase = useMemo(() => stackCounts(rows, "product_manager", "initiative_phase", ctx), [rows, ctx]);
  const groupTeam = useMemo(() => stackCounts(rows, "group", "team", ctx), [rows, ctx]);
  const teamStatus = useMemo(() => stackCounts(rows, "team", "initiative_status", ctx), [rows, ctx]);
  const teamHealth = useMemo(() => stackCounts(rows, "team", "health", ctx), [rows, ctx]);

  const nameOf = useCallback((id: string) => String(inScope.find((r) => r.id === id)?.initiative_name ?? id), [inScope]);
  const fields = REPORT_GRID_COLUMNS.map(FIELD_OF);
  const fmt = (f: (typeof fields)[number], r: GridItem) => formatField(f, r[f.key], { today: controller.todayDate(), members: lookups.members, projects: lookups.projects });
  const exportCsv = () => downloadCsv(`reports-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(rows, fields, lookups));
  const multiTeam = rows.some((r) => typeof r.contributing_teams === "string" && r.contributing_teams.includes(","));

  return (
    <div className="reports">
      <div className="page-head"><h1>Reports</h1><span className="muted" role="status">{rows.length.toLocaleString("en-GB")} of {inScope.length.toLocaleString("en-GB")} initiatives</span></div>
      <StatusStrip controller={controller} />

      <div className="rp-filters" role="region" aria-label="Report filters">
        {BAR_DIMS.map((dim) => {
          const picked = state.filters[dim] ?? [];
          return (
            <Popover key={dim} active={picked.length > 0} label={<>{DIM_LABEL[dim]}{picked.length > 0 && <span className="rp-badge" aria-label={`${picked.length} selected`}>{picked.length}</span>}</>}>
              {() => (
                <div role="group" aria-label={DIM_LABEL[dim]} className="rp-options">
                  {dim === "quarter" && [...new Set(choices(dim).filter((c) => c !== UNSET).map((c) => c.slice(3)))].map((year) => (
                    <button key={year} type="button" className="link-button" onClick={() => setFilter(dim, [...new Set([...picked, ...[1, 2, 3, 4].map((q) => `Q${q} ${year}`)])])}>Full year {year}</button>
                  ))}
                  {choices(dim).map((v) => (
                    <label key={v} className="rp-option">
                      <input type="checkbox" checked={picked.includes(v)} onChange={(e) => setFilter(dim, e.target.checked ? [...picked, v] : picked.filter((x) => x !== v))} />
                      {label(dim, v)}
                    </label>
                  ))}
                  {picked.length > 0 && <button type="button" className="link-button" onClick={() => setFilter(dim, [])}>Clear {DIM_LABEL[dim]}</button>}
                </div>
              )}
            </Popover>
          );
        })}
        <label className="rp-toggle"><input type="checkbox" checked={state.archived} onChange={(e) => setState((s) => ({ ...s, archived: e.target.checked }))} />Include archived</label>
        <label className="rp-toggle"><input type="checkbox" checked={state.aiDrafts} onChange={(e) => setState((s) => ({ ...s, aiDrafts: e.target.checked }))} />Include AI drafts</label>
        <button type="button" className="tool-btn" disabled={!anything} onClick={() => setState((s) => ({ ...emptyReport(), archived: s.archived, aiDrafts: s.aiDrafts }))}>Reset filters</button>
        <button type="button" className="tool-btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV ({rows.length.toLocaleString("en-GB")})</button>
      </div>

      {state.drill.length > 0 && (
        <ul className="rp-pills" aria-label="Filters from clicking the charts">
          {state.drill.map((d) => (
            <li key={`${d.dim}:${d.value}`}>
              <button type="button" className="rp-pill" onClick={() => setState((s) => toggleDrill(s, d.dim, d.value))} aria-label={`Remove filter ${DIM_LABEL[d.dim]}: ${label(d.dim, d.value)}`}>
                {DIM_LABEL[d.dim]}: {label(d.dim, d.value)} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rp-grid">
        <StackedChart title="Initiatives by Product Manager and Phase" data={pmPhase} rowDim="product_manager" colDim="initiative_phase" label={label} state={state} onPick={pick} />
        <StackedChart title="Initiatives by Group and Team" note={multiTeam ? "An initiative with several teams counts once per team, so the bars can add up to more than the number of initiatives." : undefined} data={groupTeam} rowDim="group" colDim="team" label={label} state={state} onPick={pick} />
        <StackedChart title="Status by Team" data={teamStatus} rowDim="team" colDim="initiative_status" label={label} state={state} onPick={pick} />
        <StackedChart title="Health by Team" data={teamHealth} rowDim="team" colDim="health" label={label} state={state} onPick={pick} />
      </div>

      <TimeToMarket rows={rows} ctx={ctx} label={label} onPick={pick} onOpen={setPeekId} nameOf={nameOf} />
      <TimelineChart rows={rows} today={controller.todayDate()} onOpen={setPeekId} />

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
                        {i === 1 ? <button type="button" className="link-button" onClick={() => setPeekId(r.id)}>{fmt(f, r)}</button> : f.key === "health" && r.health ? <span className={`pill health-${String(r.health).toLowerCase().replace(/[^a-z]+/g, "-")}`}>{fmt(f, r)}</span> : fmt(f, r)}
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
      {peekId && <ItemPanel controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" onClose={() => setPeekId(null)} />}
    </div>
  );
}

export { REPORT_DIMS };
