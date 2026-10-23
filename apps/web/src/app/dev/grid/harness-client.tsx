"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { parseBase } from "@/features/portfolio/grid-view";
import { PortfolioGrid } from "@/features/portfolio/portfolio-grid";
import { bigLookups, harnessLookups, makeHarness } from "../harness-data";

export function HarnessClient({ n, latency, role, view, allColumns, bigLists = false }: { n: number; latency: number; role: string; view?: string; allColumns: boolean; bigLists?: boolean }) {
  const lookups = bigLists ? bigLookups : harnessLookups;
  const { controller, source } = useMemo(() => makeHarness(n, latency, role, lookups), [n, latency, role, lookups]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }] }), { projects: lookups.projects }), [lookups]);
  useEffect(() => {
    (window as unknown as { __pv: unknown }).__pv = { controller, source, store };
  }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={lookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin" || role === "creator"}>
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="grid" showTrash />
      <main className="content">
        <PortfolioGrid controller={controller} lookups={lookups} initialBase={parseBase(view ?? null, { kind: "builtin", name: "Prioritisation" })} me="u1" renderAllColumns={allColumns} headLeft={<h1>Roadmap (test page)</h1>} />
      </main>
    </div>
    </WorkspaceProvider>
  );
}
