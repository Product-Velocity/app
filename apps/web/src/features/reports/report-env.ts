"use client";

import { useCallback, useMemo } from "react";
import {
  BAR_DIMS, DIM_FIELD, UNSET, compareValues, drillOn, matchesReport, optionsFor, quarterChoices, toggleDrill, unsetLabel, type ReportCtx, type ReportDim, type ReportState,
} from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import type { GridItem, Lookups } from "../portfolio/types";

/** The reports of the Reports tab, in the order of the list; the first one opens by default. */
export const REPORTS = [
  { id: "overview", label: "Overview" },
  { id: "health", label: "Roadmap Health" },
  { id: "gates", label: "Gate history" },
] as const;
export type ReportId = (typeof REPORTS)[number]["id"];
export const DEFAULT_REPORT: ReportId = REPORTS[0].id;
export const parseReportId = (v: string | null): ReportId => REPORTS.find((r) => r.id === v)?.id ?? DEFAULT_REPORT;

/** What every report shares: the rows after the filters, the names and choices of the filters, and the click-to-filter behaviour. */
export type ReportEnv = {
  controller: PortfolioController;
  lookups: Lookups;
  state: ReportState;
  inScope: GridItem[];
  rows: GridItem[];
  ctx: ReportCtx;
  teamNames: string[];
  label: (dim: ReportDim, key: string) => string;
  choices: (dim: ReportDim) => string[];
  setFilter: (dim: ReportDim, values: string[]) => void;
  pick: (picks: { dim: ReportDim; key: string }[]) => void;
  nameOf: (id: string) => string;
  anything: boolean;
};

export function useReportEnv(controller: PortfolioController, lookups: Lookups, version: number, projectIds: string[] | null, state: ReportState, setState: (f: (s: ReportState) => ReportState) => void): ReportEnv {
  const teamNames = useMemo(() => (lookups.teams ?? []).map((t) => t.name), [lookups.teams]);
  const ctx = useMemo(() => ({ teamNames }), [teamNames]);
  const inScope = useMemo<GridItem[]>(
    () => controller.rows.filter((r) => projectIds === null || projectIds.includes(r.home_project)),
    // the controller changes its rows in place; the version says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, version, projectIds],
  );
  const rows = useMemo(() => inScope.filter((r) => matchesReport(r, state, ctx)).sort((a, b) => a.stack_rank - b.stack_rank), [inScope, state, ctx]);

  const label = useCallback((dim: ReportDim, key: string) => {
    if (key === UNSET) return unsetLabel(dim);
    if (dim === "product_manager" || dim === "engineering_manager") return lookups.members.find((m) => m.user_id === key)?.email ?? "unknown person";
    return key;
  }, [lookups.members]);

  /** The choices of a bar filter: what the field allows plus every value in use, "not set" last. */
  const choices = useCallback((dim: ReportDim): string[] => {
    const inUse = new Set<string>();
    for (const r of inScope) { const v = r[DIM_FIELD[dim]]; if (typeof v === "string" && v) (dim === "team" ? v.split(/,\s*/) : [v]).forEach((x) => inUse.add(x)); }
    let list: string[];
    if (dim === "product_manager" || dim === "engineering_manager") list = lookups.members.map((m) => m.user_id);
    else if (dim === "team") list = teamNames;
    else if (dim === "group") list = lookups.groups ?? [];
    else if (dim === "quarter") list = quarterChoices(inUse);
    else list = optionsFor(DIM_FIELD[dim]).map((o) => o.value);
    return [...new Set([...list, ...inUse].filter((v) => dim !== "team" || teamNames.includes(v)))].concat(UNSET).sort((a, b) => (dim === "quarter" || dim === "product_manager" || dim === "engineering_manager" ? 0 : compareValues(dim, a, b)));
  }, [inScope, lookups.members, lookups.groups, teamNames]);

  const setFilter = useCallback((dim: ReportDim, values: string[]) => setState((s) => ({ ...s, filters: { ...s.filters, [dim]: values } })), [setState]);
  /** A click on a chart: if everything picked is already a pill, remove those pills; else add the missing ones. */
  const pick = useCallback((picks: { dim: ReportDim; key: string }[]) => setState((s) => {
    const allOn = picks.every((p) => drillOn(s, p.dim, p.key));
    return picks.reduce((acc, p) => (allOn === drillOn(acc, p.dim, p.key) ? toggleDrill(acc, p.dim, p.key) : acc), s);
  }), [setState]);
  const nameOf = useCallback((id: string) => String(inScope.find((r) => r.id === id)?.initiative_name ?? id), [inScope]);
  const anything = BAR_DIMS.some((d) => state.filters[d]?.length) || state.drill.length > 0;

  return { controller, lookups, state, inScope, rows, ctx, teamNames, label, choices, setFilter, pick, nameOf, anything };
}
