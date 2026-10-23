"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { LeadershipView } from "@/features/leadership/leadership-view";
import { MemoryLeadershipStore } from "@/features/leadership/store";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeLeadershipHarness } from "../harness-data";

export function HarnessLeadership({ n, role }: { n: number; role: string }) {
  const { controller, source, changes, reviewed } = useMemo(() => makeLeadershipHarness(n, role), [n, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({
    scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }],
  }), { projects: harnessLookups.projects }), []);
  const lead = useMemo(() => {
    const s = new MemoryLeadershipStore(changes);
    s.writable = role === "creator" || role === "admin";
    if (reviewed) s.updates.push(reviewed);
    return s;
  }, [changes, role, reviewed]);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store, lead }; }, [controller, source, store, lead]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Leadership viewer" isApprover={false} current="leadership" />
        <main className="content"><LeadershipView controller={controller} lookups={harnessLookups} me="u1" store={lead} pageHref={(c) => `/dev/item/${encodeURIComponent(c)}`} /></main>
      </div>
    </WorkspaceProvider>
  );
}
