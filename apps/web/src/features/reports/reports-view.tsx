"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { REPORT_DIMS, REPORT_GRID_COLUMNS, FIELD_BY_KEY, parseReport, serializeReport, type ReportState } from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import { downloadCsv, selectionToCsv } from "../portfolio/export-selection";
import { ItemPanel } from "../portfolio/item-panel";
import { StatusStrip, useStatus } from "../portfolio/status-strip";
import type { Lookups } from "../portfolio/types";
import { useScope } from "../workspace/scope";
import { HealthReport } from "./health-report";
import { OverviewReport } from "./overview-report";
import { DEFAULT_REPORT, REPORTS, parseReportId, useReportEnv, type ReportId } from "./report-env";
import { ReportFilters } from "./report-filters";

/** Writes the report and the filters into the address (other parameters such as ?scope= stay), without reloading. The default report has no parameter. */
function writeAddress(state: ReportState, report: ReportId) {
  const url = new URL(window.location.href);
  for (const k of [...url.searchParams.keys()]) if (k.startsWith("f.") || k === "d" || k === "arch" || k === "draft" || k === "pct" || k === "report") url.searchParams.delete(k);
  if (report !== DEFAULT_REPORT) url.searchParams.set("report", report);
  for (const [k, v] of serializeReport(state)) url.searchParams.append(k, v);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Reports tab: a list of reports next to the title (the first opens by default), the filter bar they share, and the report chosen.
 * Overview is issue #233; Roadmap Health is request R-129 (issue #287).
 */
export function ReportsView({ controller, lookups, me }: { controller: PortfolioController; lookups: Lookups; me: string | null }) {
  const status = useStatus(controller);
  const params = useSearchParams();
  const scope = useScope();
  const [state, setState] = useState<ReportState>(() => parseReport(params));
  const [report, setReport] = useState<ReportId>(() => parseReportId(params.get("report")));
  const [peekId, setPeekId] = useState<string | null>(null);
  useEffect(() => writeAddress(state, report), [state, report]);

  const env = useReportEnv(controller, lookups, status.version, scope.projectIds, state, setState);
  const fields = REPORT_GRID_COLUMNS.map((k) => FIELD_BY_KEY[k]!);
  const exportCsv = () => downloadCsv(`reports-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(env.rows, fields, lookups));

  const overviewTools = (
    <>
      <button type="button" className="tool-btn" disabled={env.rows.length === 0} onClick={exportCsv}>Export CSV ({env.rows.length.toLocaleString("en-GB")})</button>
      <button type="button" className="tool-btn" disabled title="A PDF summary of this page (filters, Time to Market card and charts) comes later (issue #233, P1)">PDF summary (later)</button>
    </>
  );

  return (
    <div className="reports">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="view-chips" role="group" aria-label="Report">
          {REPORTS.map((r) => (
            <button key={r.id} type="button" className={report === r.id ? "view-chip view-chip-on" : "view-chip"} aria-pressed={report === r.id} onClick={() => setReport(r.id)}>{r.label}</button>
          ))}
        </div>
        <span className="muted" role="status">{env.rows.length.toLocaleString("en-GB")} of {env.inScope.length.toLocaleString("en-GB")} initiatives</span>
      </div>
      <StatusStrip controller={controller} />

      <ReportFilters env={env} setState={setState} extra={report === "overview" ? overviewTools : undefined} />

      {report === "overview" ? <OverviewReport env={env} setState={setState} onOpen={setPeekId} /> : <HealthReport env={env} onOpen={setPeekId} />}
      {peekId && <ItemPanel controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" onClose={() => setPeekId(null)} />}
    </div>
  );
}

export { REPORT_DIMS };
