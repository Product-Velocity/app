"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { ItemPage } from "@/features/portfolio/item-page-client";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeHarness } from "../../harness-data";

export function HarnessItem({ code, role }: { code: string; role: string }) {
  const { controller, source } = useMemo(() => makeHarness(40, 0, role), [role]);
  const store = useMemo(() => new MemoryWorkspaceStore(), []);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store }; }, [controller, source, store]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="grid" />
        <main className="content">
          <ItemPage controller={controller} lookups={harnessLookups} userId="u1" code={code} pageHref={(c) => `/dev/item/${encodeURIComponent(c)}?role=${role}`} backHref="/dev/grid" />
        </main>
      </div>
    </WorkspaceProvider>
  );
}
