"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { ReportsView } from "@/features/reports/reports-view";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeReportsHarness } from "../harness-data";

export function HarnessReports({ n, role }: { n: number; role: string }) {
  const { controller, source } = useMemo(() => makeReportsHarness(n, role), [n, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [], views: [] }), { projects: harnessLookups.projects }), []);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store }; }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="reports" />
        <main className="content"><ReportsView controller={controller} lookups={harnessLookups} me="u1" /></main>
      </div>
    </WorkspaceProvider>
  );
}
