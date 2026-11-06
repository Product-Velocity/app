"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { ReportsView } from "@/features/reports/reports-view";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import type { GateRequest } from "@pv/domain";
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

export function HarnessReports({ n, role }: { n: number; role: string }) {
  const { controller, source } = useMemo(() => makeReportsHarness(n, role), [n, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [], views: [] }), { projects: harnessLookups.projects }), []);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store }; }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="reports" />
        <main className="content"><ReportsView controller={controller} lookups={harnessLookups} me="u1" loadGateRequests={async () => GATE_REQUESTS} /></main>
      </div>
    </WorkspaceProvider>
  );
}
