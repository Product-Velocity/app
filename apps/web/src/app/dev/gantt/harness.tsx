"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { GanttView } from "@/features/gantt/gantt-view";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeGanttHarness } from "../harness-data";

export function HarnessGantt({ n, role }: { n: number; role: string }) {
  const { controller, source } = useMemo(() => makeGanttHarness(n, role), [n, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({
    scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }],
    views: [{ id: "view-must", name: "Must haves", columns: ["stack_rank", "item_code", "initiative_name"], filters: [{ field: "moscow", op: "is", value: "Must" }], groupBy: null }],
  }), { projects: harnessLookups.projects }), []);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store }; }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="gantt" />
        <main className="content"><GanttView controller={controller} lookups={harnessLookups} me="u1" pageHref={(c) => `/dev/item/${encodeURIComponent(c)}`} /></main>
      </div>
    </WorkspaceProvider>
  );
}
