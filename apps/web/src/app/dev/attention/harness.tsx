"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { AttentionView } from "@/features/attention/attention-view";
import { MemoryGateSource } from "@/features/gates/gate-source";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeHarness } from "../harness-data";

/** Eight initiatives, one for each reason (today is 14 Apr 2027): R-01 build done, R-02 work before the gate, R-03 cancelled but building, R-04 a Hold due, R-05 blocked, R-06 stalled, R-07 a request waiting 12 days, R-08 open conditions. */
export function HarnessAttention({ role }: { role: string }) {
  const { controller, source, gates } = useMemo(() => {
    const h = makeHarness(10, 0, role);
    const set = (n: number, o: Record<string, unknown>) => {
      Object.assign(h.source.items.find((i) => i.id === `item-${n}`)!, o);
      Object.assign(h.controller.row(`item-${n}`)!, o);
    };
    for (let n = 1; n <= 10; n++) set(n, { initiative_status: "Active", health: "On Track", status: "Not started", initiative_phase: "Test", phase_changed_at: "2027-04-10", g2m_date_est: "2027-12-31" });
    set(1, { initiative_phase: "Build", status: "Done" });
    set(2, { initiative_phase: "Define", status: "In progress" });
    set(3, { initiative_phase: "Build", status: "In progress", initiative_status: "Cancelled" });
    set(4, { initiative_phase: "Define", gate_status: "Held", next_gate_due: "2027-04-14" });
    set(5, { health: "Blocked" });
    set(6, { initiative_phase: "Define", phase_changed_at: "2027-02-01" });
    set(7, { initiative_phase: "Define" });
    const g = new MemoryGateSource([
      { id: "r7", item_id: "item-7", gate: "B", kind: "decision", requested_by: "u2", requested_at: "2027-04-02T09:00:00Z", preferred_approvers: [], ready: false, criteria: [], outcome: null, rationale: null, fast_lane: false, target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null },
    ], ["A", "B", "C"], [], [{ id: "c1", review_id: "r0", item_id: "item-8", text: "Legal review", done_at: null }, { id: "c2", review_id: "r0", item_id: "item-8", text: "Privacy note", done_at: null }]);
    g.onMove = (id, to) => { const s = h.source.items.find((i) => i.id === id) as Record<string, unknown> | undefined; if (s) s.initiative_phase = to; };
    return { ...h, gates: g };
  }, [role]);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, gates }; }, [controller, source, gates]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ana@example.test" roleLabel="Admin" isApprover current="attention" />
        <main className="content"><AttentionView controller={controller} lookups={harnessLookups} me="u1" source={gates} pageHref={(c) => `/dev/item/${encodeURIComponent(c)}`} decisionsHref="/dev/decisions" /></main>
      </div>
    </WorkspaceProvider>
  );
}
