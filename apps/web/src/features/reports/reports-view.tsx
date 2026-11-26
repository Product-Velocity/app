"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BAR_DIMS, DIM_LABEL, REPORT_DIMS, REPORT_GRID_COLUMNS, FIELD_BY_KEY, parseReport, serializeReport, type ReportState } from "@pv/domain";
import type { PortfolioController } from "../portfolio/controller";
import { downloadCsv, selectionToCsv } from "../portfolio/export-selection";
import { ItemPanel } from "../portfolio/item-panel";
import { StatusStrip, useStatus } from "../portfolio/status-strip";
import type { Lookups } from "../portfolio/types";
import { useScope } from "../workspace/scope";
import { useWorkspace } from "../workspace/provider";
import type { FeedRow, GateRequest, JiraStatusRecord, TrackerRef } from "@pv/domain";
import { ChangesReport } from "./changes-report";
import type { GateSource } from "../gates/gate-source";
import { GateHistoryReport } from "./gate-history-report";
import { HealthReport } from "./health-report";
import { OkrReport } from "./okr-report";
import { OverviewReport } from "./overview-report";
import { VelocityReport, VELOCITY_PARAMS } from "./velocity-report";
import { DEFAULT_REPORT, REPORTS, parseReportId, useReportEnv, type ReportId } from "./report-env";
import { ReportFilters } from "./report-filters";
import { printReportPage, reportPdfTitle } from "./print-report";
import { PageHeader } from "@/components/page-header";

/** Writes the report and the filters into the address (other parameters such as ?scope= stay), without reloading. The default report has no parameter. */
function writeAddress(state: ReportState, report: ReportId) {
  const url = new URL(window.location.href);
  for (const k of [...url.searchParams.keys()]) if (k.startsWith("f.") || k === "d" || k === "arch" || k === "draft" || k === "pct" || k === "report" || (report !== "velocity" && (VELOCITY_PARAMS as readonly string[]).includes(k))) url.searchParams.delete(k);
  if (report !== DEFAULT_REPORT) url.searchParams.set("report", report);
  for (const [k, v] of serializeReport(state)) url.searchParams.append(k, v);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Reports tab: a list of reports next to the title (the first opens by default), the filter bar they share, and the report chosen.
 * Overview is issue #233; Roadmap Health is request R-129 (issue #287).
 */
export function ReportsView({ controller, lookups, me, loadGateRequests, loadChanges, loadTrackerIssues, loadJiraUsers, loadJiraChildren, gateSource }: { controller: PortfolioController; lookups: Lookups; me: string | null; /** Reads the decision-gate requests of the workspace (Gate history). */ loadGateRequests?: () => Promise<GateRequest[]>; /** Reads the changes of a period (Changes). */ loadChanges?: (from: Date, to: Date) => Promise<FeedRow[]>; /** Reads the Jira or GitHub issue each initiative is linked to (Changes: name, id and link). */ loadTrackerIssues?: (itemIds: string[]) => Promise<Map<string, TrackerRef>>; /** The decision-gate functions (Changes: Move to Test and Request gate on a flag). */ gateSource?: GateSource; /** Reads who moved Jira issues to a status (Changes: the Jira user column). */ loadJiraUsers?: (issueKeys: string[], from: Date, to: Date) => Promise<JiraStatusRecord[]>; /** Reads the child issues of the linked Jira issues (Changes: who moved them). */ loadJiraChildren?: (itemIds: string[]) => Promise<Map<string, string[]>> }) {
  const status = useStatus(controller);
  const params = useSearchParams();
  const scope = useScope();
  const { isDemo } = useWorkspace();
  const [state, setState] = useState<ReportState>(() => parseReport(params));
  const [report, setReport] = useState<ReportId>(() => parseReportId(params.get("report")));
  const [peekId, setPeekId] = useState<string | null>(null);
  useEffect(() => writeAddress(state, report), [state, report]);

  const env = useReportEnv(controller, lookups, status.version, scope.projectIds, state, setState);
  const fields = REPORT_GRID_COLUMNS.map((k) => FIELD_BY_KEY[k]!);
  const exportCsv = () => downloadCsv(`reports-${new Date().toISOString().slice(0, 10)}.csv`, selectionToCsv(env.rows, fields, lookups));

  const root = useRef<HTMLDivElement>(null);
  const day = new Date().toISOString().slice(0, 10);
  const reportName = REPORTS.find((r) => r.id === report)?.label ?? "Overview";
  const exportPdf = () => { if (root.current) void printReportPage(root.current, reportPdfTitle(reportName, day)); };
  // the filters in words, for the top of the printed page (the filter bar itself is hidden there)
  const filterText = [
    ...BAR_DIMS.flatMap((dim) => { const picked = state.filters[dim] ?? []; return picked.length > 0 ? [`${DIM_LABEL[dim]}: ${picked.map((v) => env.label(dim, v)).join(", ")}`] : []; }),
    ...state.drill.map((d) => `${DIM_LABEL[d.dim]}: ${env.label(d.dim, d.value)}`),
    ...(state.archived ? ["Including archived"] : []), ...(state.aiDrafts ? ["Including AI drafts"] : []),
  ];
  const tools = (
    <>
      {report === "overview" && !isDemo && <button type="button" className="tool-btn" disabled={env.rows.length === 0} onClick={exportCsv}>Export CSV ({env.rows.length.toLocaleString("en-GB")})</button>}
      <button type="button" className="tool-btn" title="Opens the print window for this whole page: choose “Save as PDF”" onClick={exportPdf}>Export PDF</button>
    </>
  );

  return (
    <div className="reports" ref={root}>
      <PageHeader
        title="Reports"
        views={<div className="view-chips" role="group" aria-label="Report">
          {REPORTS.map((r) => (
            <button key={r.id} type="button" className={report === r.id ? "view-chip view-chip-on" : "view-chip"} aria-pressed={report === r.id} onClick={() => setReport(r.id)}>{r.label}</button>
          ))}
        </div>}
        count={`${env.rows.length.toLocaleString("en-GB")} of ${env.inScope.length.toLocaleString("en-GB")} initiatives`}
      />
      <StatusStrip controller={controller} />
      <div className="rp-print-head" aria-hidden="true">
        <strong>Reports · {reportName}</strong> · {day} · {env.rows.length.toLocaleString("en-GB")} of {env.inScope.length.toLocaleString("en-GB")} initiatives{filterText.length > 0 ? ` · ${filterText.join(" · ")}` : ""}
      </div>

      {/* the details panel opens beside the report, like in the Gantt; it used to be added under the page, out of sight */}
      <div className={peekId ? "reports-split reports-split-open" : "reports-split"}>
        <div className="reports-main">
          <ReportFilters env={env} setState={setState} extra={tools} />

          {report === "overview" ? <OverviewReport env={env} setState={setState} onOpen={setPeekId} /> : report === "health" ? <HealthReport env={env} onOpen={setPeekId} /> : report === "changes" ? <ChangesReport env={env} load={loadChanges} loadIssues={loadTrackerIssues} loadJiraUsers={loadJiraUsers} loadJiraChildren={loadJiraChildren} {...(gateSource ? { gates: gateSource } : {})} me={me} onOpen={setPeekId} /> : report === "velocity" ? <VelocityReport env={env} load={loadGateRequests} onOpen={setPeekId} /> : report === "okrs" ? <OkrReport env={env} /> : <GateHistoryReport env={env} load={loadGateRequests} onOpen={setPeekId} />}
        </div>
        {peekId && <ItemPanel controller={controller} lookups={lookups} itemId={peekId} me={me} mode="peek" onClose={() => setPeekId(null)} />}
      </div>
    </div>
  );
}

export { REPORT_DIMS };
