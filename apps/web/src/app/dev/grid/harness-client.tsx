"use client";

import { useEffect, useMemo } from "react";
import { DatePrefs } from "@/components/date-prefs";
import { AppHeader } from "@/components/app-header";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { parseBase } from "@/features/portfolio/grid-view";
import { PortfolioGrid } from "@/features/portfolio/portfolio-grid";
import { bigLookups, harnessLookups, makeHarness, withGithubTree } from "../harness-data";

export function HarnessClient({ n, latency, role, view, allColumns, bigLists = false, github = false, datefmt = "d MMM yyyy" }: { n: number; latency: number; role: string; view?: string; allColumns: boolean; bigLists?: boolean; github?: boolean; datefmt?: string }) {
  const base = bigLists ? bigLookups : harnessLookups;
  const { controller, source, lookups } = useMemo(() => { const h = makeHarness(n, latency, role, base); return { ...h, lookups: github ? withGithubTree(h.controller, h.source, "R-01", base) : base }; }, [n, latency, role, base, github]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ me: "u1", admin: role === "admin", scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }] }), { projects: lookups.projects }), [lookups]);
  useEffect(() => {
    (window as unknown as { __pv: unknown }).__pv = { controller, source, store };
  }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={lookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin" || role === "creator"} userId="u1">
    <DatePrefs format={datefmt} />
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="grid" showTrash />
      <main className="content">
        <PortfolioGrid controller={controller} lookups={lookups} initialBase={parseBase(view ?? null, { kind: "builtin", name: "Prioritisation" })} me="u1" renderAllColumns={allColumns} headLeft={<h1>Roadmap (test page)</h1>} />
      </main>
    </div>
    </WorkspaceProvider>
  );
}
