"use client";

import type { ReactNode } from "react";
import { BAR_DIMS, DIM_LABEL, UNSET, emptyReport, toggleDrill, type ReportState } from "@pv/domain";
import { Popover } from "../portfolio/popover";
import type { ReportEnv } from "./report-env";

/** The filter bar, the two toggles and the click-to-filter pills: the same for every report, so a filter set on one stays on the next. */
export function ReportFilters({ env, setState, extra }: { env: ReportEnv; setState: (f: (s: ReportState) => ReportState) => void; extra?: ReactNode }) {
  const { state, label, choices, setFilter, anything } = env;
  return (
    <>
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
        {extra}
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
    </>
  );
}
