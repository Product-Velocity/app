"use client";

import { useEffect, useMemo } from "react";
import type { GateRequest } from "@pv/domain";
import { AppHeader } from "@/components/app-header";
import { PhoneDecisions } from "@/features/phone/phone-decisions";
import { DecisionsView } from "@/features/gates/decisions-view";
import { MemoryGateSource, type GateItem } from "@/features/gates/gate-source";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups } from "../harness-data";

const item = (n: number, name: string, phase: string): GateItem => ({
  id: `item-${n}`, item_code: `R-${String(n).padStart(2, "0")}`, initiative_name: name, initiative_phase: phase, initiative_status: "Active", current_gate: null, gate_status: null,
  hypothesis: n === 2 ? "Customers who see the new checkout convert more." : null, effort: "M", moscow: "Must", health: "On Track", kr_metric: n === 1 ? "Activation rate" : null, home_project: "p1", start_experiment: null,
});
const req = (o: Partial<GateRequest> & Pick<GateRequest, "id" | "item_id" | "gate">): GateRequest => ({
  kind: "decision", requested_by: "u2", requested_at: "2027-04-12T09:00:00Z", preferred_approvers: [], ready: false, criteria: [], outcome: null, rationale: null, fast_lane: false,
  target_phase: null, skipped_phases: [], review_date: null, decided_by: null, decided_at: null, withdrawn_at: null, ...o,
});

/** Four requests: two for gate B, one A, one C, and one already decided with a fast lane. */
export function HarnessDecisions({ can, phone = false }: { can: string; phone?: boolean }) {
  const source = useMemo(() => {
    const s = new MemoryGateSource(
      [
        req({ id: "r1", item_id: "item-1", gate: "A", requested_at: "2027-04-10T09:00:00Z", ready: true, criteria: [{ label: "Hypothesis written", ok: true }, { label: "Discovery document exists", ok: true }] }),
        req({ id: "r2", item_id: "item-2", gate: "B", requested_at: "2027-04-12T09:00:00Z", criteria: [{ label: "PRD document exists", ok: true }, { label: "Effort estimated", ok: true }, { label: "MoSCoW set", ok: false }] }),
        req({ id: "r3", item_id: "item-3", gate: "B", requested_at: "2027-04-13T09:00:00Z", requested_by: "u1" }),
        req({ id: "r4", item_id: "item-4", gate: "C", requested_at: "2027-04-11T09:00:00Z", ready: true }),
        req({ id: "r5", item_id: "item-5", gate: "B", requested_at: "2027-04-01T09:00:00Z", outcome: "go", rationale: "Tiny change, ship it", fast_lane: true, target_phase: "Roll-out", skipped_phases: ["Build", "Test", "Experiment"], decided_by: "u1", decided_at: "2027-04-02T10:00:00Z" }),
      ],
      can.split(",").filter(Boolean) as ("A" | "B" | "C")[],
      [{ kind: "prd", status: "in_review" }],
    );
    s.items = [item(1, "Faster onboarding", "Discover"), item(2, "New checkout flow", "Define"), item(3, "Search relevance", "Define"), item(4, "Referral programme", "Experiment"), item(5, "Fix footer link", "Roll-out")];
    s.deciders = [
      { user_id: "u1", email: "ana@example.test", role: "admin", is_approver: false, is_service_account: false },
      { user_id: "u2", email: "bo@example.test", role: "creator", is_approver: true, is_service_account: false },
      { user_id: "u3", email: "cy@example.test", role: "creator", is_approver: false, is_service_account: false },
    ];
    return s;
  }, [can]);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { source }; }, [source]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit canAdmin>
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ana@example.test" roleLabel="Admin" isApprover current="decisions" decisionsWaiting={4} />
      <main className="content">{phone ? <PhoneDecisions source={source} me="u1" tenantId="t1" /> : <DecisionsView source={source} me="u1" />}</main>
    </div>
    </WorkspaceProvider>
  );
}
