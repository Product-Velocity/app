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
    const g = new MemoryGateSource([], role === "admin" ? ["A", "B", "C"] : []);
    g.items = controller.rows.map((r) => ({ id: r.id, item_code: r.item_code, initiative_name: r.initiative_name, initiative_phase: (r.initiative_phase as string | null) ?? null, initiative_status: null, current_gate: null, gate_status: null, hypothesis: null, effort: (r.effort as string | null) ?? null, moscow: (r.moscow as string | null) ?? null, health: (r.health as string | null) ?? null, kr_metric: null, home_project: String(r.home_project), start_experiment: null }));
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
