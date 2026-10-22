"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { parseBase } from "@/features/portfolio/grid-view";
import { PortfolioController } from "@/features/portfolio/controller";
import { MemoryDataSource, sampleItems } from "@/features/portfolio/memory-source";
import { PortfolioGrid } from "@/features/portfolio/portfolio-grid";
import type { Lookups } from "@/features/portfolio/types";

const lookups: Lookups = {
  projects: ["Platform", "Marketplace", "Growth", "Payments", "Mobile", "Data"].map((name, i) => ({ id: `p${i + 1}`, name })),
  members: ["ana", "bo", "chen", "dee", "eli"].map((n, i) => ({ user_id: `u${i + 1}`, email: `${n}@example.test` })),
};

export function HarnessClient({ n, latency, role, view, allColumns }: { n: number; latency: number; role: string; view?: string; allColumns: boolean }) {
  const { controller, source } = useMemo(() => {
    const items = sampleItems(n, lookups.projects.map((p) => p.id), lookups.members.map((m) => m.user_id));
    const source = new MemoryDataSource(items, { latencyMs: latency });
    const controller = new PortfolioController(source, items, lookups, role, () => new Date(Date.UTC(2027, 3, 14)));
    return { controller, source };
  }, [n, latency, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }] }), { projects: lookups.projects }), []);
  useEffect(() => {
    (window as unknown as { __pv: unknown }).__pv = { controller, source, store };
  }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={lookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin" || role === "creator"}>
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="grid" />
      <main className="content">
        <PortfolioGrid controller={controller} lookups={lookups} initialBase={parseBase(view ?? null, { kind: "builtin", name: "Prioritisation" })} me="u1" renderAllColumns={allColumns} headLeft={<h1>Roadmap (test page)</h1>} />
      </main>
    </div>
    </WorkspaceProvider>
  );
}
