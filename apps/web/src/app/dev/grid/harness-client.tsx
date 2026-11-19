"use client";

import { useEffect, useMemo } from "react";
import { DatePrefs } from "@/components/date-prefs";
import { AppHeader } from "@/components/app-header";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { parseBase } from "@/features/portfolio/grid-view";
import { PortfolioGrid } from "@/features/portfolio/portfolio-grid";
import { MemoryGateSource } from "@/features/gates/gate-source";
import { bigLookups, harnessLookups, makeHarness, withGithubTree, withJiraLinks } from "../harness-data";

export function HarnessClient({ n, latency, role, view, allColumns, bigLists = false, github = false, jira = false, gates = false, datefmt = "d MMM yyyy" }: { n: number; latency: number; role: string; view?: string; allColumns: boolean; bigLists?: boolean; github?: boolean; jira?: boolean; gates?: boolean; datefmt?: string }) {
  const base = bigLists ? bigLookups : harnessLookups;
  const { controller, source, lookups } = useMemo(() => { const h = makeHarness(n, latency, role, base); return { ...h, lookups: github ? withGithubTree(h.controller, h.source, "R-01", base) : jira ? withJiraLinks(h.controller, base, h.source) : base }; }, [n, latency, role, base, github, jira]);
  // decision gates: the first items sit in Discover, Define, Build and Test; an in-memory gate source records what the dialogs send
  const gateSource = useMemo(() => {
    if (!gates) return undefined;
    const phases = ["Discover", "Define", "Build", "Test"];
    controller.rows.forEach((r, i) => { (r as Record<string, unknown>).initiative_phase = phases[i % 4]; });
    // Flags and Actions columns: R-01 has every linked issue closed with no phase (Tracker done: a move to Test passes the gates, so it opens the request); R-03 is in Build with its build done (Build done: moves at once)
    const [a, , c] = controller.rows as unknown as Record<string, unknown>[];
    if (a) Object.assign(a, { initiative_phase: null, status: "Done", issues_total: 3, issues_closed: 3 });
    if (c) Object.assign(c, { initiative_phase: "Build", status: "Done", issues_total: 2, issues_closed: 2 });
    // Outcome reviews columns: the last row is in Roll-out since 2026-08-01 with a key result from 10 to 110 and its 30 day review recorded (value 60, adoption 18%)
    const last = controller.rows.at(-1) as unknown as Record<string, unknown> | undefined;
    if (last) Object.assign(last, { initiative_phase: "Roll-out", initiative_status: "Active", start_rollout: "2026-08-01", kr_start: 10, kr_target: 110 });
    controller.deriveFlags();
    const g = new MemoryGateSource([], role === "admin" ? ["A", "B", "C"] : []);
    g.deciders = [{ user_id: "u1", email: "ana@example.test", role: "admin", is_approver: false, is_service_account: false }, { user_id: "u2", email: "bo@example.test", role: "creator", is_approver: true, is_service_account: false }, { user_id: "u3", email: "cy@example.test", role: "creator", is_approver: false, is_service_account: false }];
    g.items = controller.rows.map((r) => ({ id: r.id, item_code: r.item_code, initiative_name: r.initiative_name, initiative_phase: (r.initiative_phase as string | null) ?? null, initiative_status: null, current_gate: null, gate_status: null, hypothesis: null, effort: (r.effort as string | null) ?? null, moscow: (r.moscow as string | null) ?? null, health: (r.health as string | null) ?? null, kr_metric: null, home_project: String(r.home_project), start_experiment: null }));
    if (last) g.outcomeReviews = [{ item_id: String(last.id), at_days: 30, due_on: "2026-08-31", requested_at: "2026-09-01T00:00:00Z", realised_kr_value: 60, adoption_pct: 18, notes: null, recorded_at: "2026-09-02T00:00:00Z" }];
    return g;
  }, [gates, controller, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ me: "u1", admin: role === "admin", scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }] }), { projects: lookups.projects }), [lookups]);
  useEffect(() => {
    (window as unknown as { __pv: unknown }).__pv = { controller, source, store, gates: gateSource };
  }, [controller, source, store, gateSource]);
  return (
    <WorkspaceProvider store={store} projects={lookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"} userId="u1">
    <DatePrefs format={datefmt} />
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="grid" showTrash />
      <main className="content">
        <PortfolioGrid controller={controller} lookups={lookups} initialBase={parseBase(view ?? null, { kind: "builtin", name: "Prioritisation" })} me="u1" renderAllColumns={allColumns} headLeft={<h1>Roadmap (test page)</h1>} {...(gateSource ? { gates: gateSource } : {})} />
      </main>
    </div>
    </WorkspaceProvider>
  );
}
