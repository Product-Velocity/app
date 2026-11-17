"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { ReportsView } from "@/features/reports/reports-view";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import type { FeedRow, GateRequest, JiraStatusRecord, TrackerRef } from "@pv/domain";
import { MemoryGateSource } from "@/features/gates/gate-source";
import { harnessLookups, makeReportsHarness } from "../harness-data";

/** Gate requests for the first items: item-1 and item-2 passed Gate B (building starts 10 and 9 days later), item-3 was put on hold, item-4 waits, item-5 was stopped at Gate A. */
const at = (d: string) => `${d}T00:00:00Z`;
const gr = (id: string, item: number, gate: "A" | "B" | "C", requested: string, o: Partial<GateRequest> = {}): GateRequest => ({
  id, item_id: `item-${item}`, gate, kind: "decision", requested_by: null, requested_at: at(requested), preferred_approvers: [], ready: true, criteria: [], outcome: null, rationale: null,
  fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null, ...o,
});
const GATE_REQUESTS: GateRequest[] = [
  gr("g1", 1, "B", "2027-03-01", { outcome: "go", decided_at: at("2027-03-03"), rationale: "ok" }), // item-1 starts building 2027-02-01 + 40 days = 2027-03-13
  gr("g2", 2, "B", "2027-03-01", { outcome: "go_with_conditions", decided_at: at("2027-03-05"), rationale: "ok", fast_lane: true }), // item-2 starts 2027-03-14
  gr("g3", 3, "B", "2027-03-02", { outcome: "hold", decided_at: at("2027-03-06"), rationale: "later" }),
  gr("g4", 4, "B", "2027-03-02"),
  gr("g5", 5, "A", "2027-02-01", { outcome: "stop", decided_at: at("2027-02-04"), rationale: "no" }),
];

/** Changes of today for the first items (fictional): item-1 closed in Jira and moved to Completed by a person, item-2 only had ticket activity, item-3 changed health. */
async function changesOfToday(from: Date): Promise<FeedRow[]> {
  const t = (h: number, m: number, s = 0) => new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, m, s).toISOString();
  const r = (id: number, item: number, entity: string, field: string, old: unknown, next: unknown, at: string, actor: string | null, via: string): FeedRow => ({ id, item_id: `item-${item}`, entity, field, old, new: next, at, actor_id: actor, via });
  return [
    r(1, 3, "items", "health", "On Track", "At Risk", t(11, 2), "u1", "UI"),
    r(2, 1, "items", "initiative_status", "Active", "Completed", t(9, 30), "u1", "UI"),
    r(3, 1, "items", "status", "In progress", "Done", t(9, 18, 0), "u1", "UI"), // a person pressed Sync: the tracker set the value (the same step as the Jira row below: one row)
    r(4, 1, "item_jira_links", "jira_status", "Project Execution", "Project Closed", t(9, 18), null, "system"),
    r(5, 2, "item_github_links", "gh_state", "open", "closed_completed", t(8, 41), null, "GitHub webhook"),
  ];
}

/** Tracker issues for the first items (fictional; example.test links). */
async function trackerIssues(): Promise<Map<string, TrackerRef>> {
  return new Map<string, TrackerRef>([
    ["item-1", { tracker: "Jira", key: "DEMO-7049", title: "Bidder adapter, iteration 1", url: "https://example.test/browse/DEMO-7049" }],
    ["item-2", { tracker: "GitHub", key: "meridian/web#412", title: null, url: "https://example.test/meridian/web/issues/412" }],
  ]);
}

/** The Jira user behind the Jira move of today (fictional name). */
async function jiraUsersOfToday(from: Date): Promise<JiraStatusRecord[]> {
  return [{ issue_key: "DEMO-7049", to_status: "Project Closed", changed_at: new Date(from.getFullYear(), from.getMonth(), from.getDate(), 9, 17, 59).toISOString(), actor_name: "Dana Reyes" }];
}

export function HarnessReports({ n, role, demo = false }: { n: number; role: string; demo?: boolean }) {
  const { controller, source, gates } = useMemo(() => {
    const h = makeReportsHarness(n, role);
    if (demo) { // ?demo=changes: data for the Changes screenshot only (other tests keep the standard rows)
      // the demo state goes into the page's data source too, so a Refresh (which reads it again) keeps it
      const set = (id: string, o: Record<string, unknown>) => { for (const list of [h.controller.rows, h.source.items] as Record<string, unknown>[][]) Object.assign(list.find((r) => r.id === id) ?? {}, o); };
      set("item-1", { initiative_phase: null, initiative_status: null, status: "Done", issues_total: 4, issues_closed: 4, health: "On Track" }); // like a Jira pull-in: no phase, no status
      set("item-2", { initiative_phase: "Build", initiative_status: "Active", status: "Done", health: "On Track" }); // Build and the tracker is done: Move to Test is one click
      set("item-3", { initiative_phase: "Build", initiative_status: "Active", status: "In progress", health: null, stale_issues: 2 });
    }
    const g = new MemoryGateSource([], ["A", "B", "C"], [], [], { A: [], B: [], C: [] });
    g.onMove = (id, to) => { const row = h.source.items.find((i) => i.id === id) as Record<string, unknown> | undefined; if (row) row.initiative_phase = to; }; // what a move does to the screen
    return { ...h, gates: g };
  }, [n, role, demo]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [], views: [] }), { projects: harnessLookups.projects }), []);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store, gates, feedLoads: 0 }; }, [controller, source, store, gates]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="reports" />
        <main className="content"><ReportsView controller={controller} lookups={harnessLookups} me="u1" loadGateRequests={async () => GATE_REQUESTS} gateSource={gates} loadChanges={(from) => { const w = window as unknown as { __pv?: { feedLoads: number } }; if (w.__pv) w.__pv.feedLoads++; return changesOfToday(from); }} loadTrackerIssues={() => trackerIssues()} loadJiraUsers={(_k, from) => jiraUsersOfToday(from)} /></main>
      </div>
    </WorkspaceProvider>
  );
}
