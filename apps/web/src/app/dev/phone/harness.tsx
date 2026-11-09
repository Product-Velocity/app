"use client";

import { useMemo } from "react";
import { PhoneInitiatives } from "@/features/phone/phone-initiatives";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeCardsHarness } from "../harness-data";

export function HarnessPhone({ n }: { n: number }) {
  const { controller } = useMemo(() => makeCardsHarness(n, "creator"), [n]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [], views: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit canAdmin={false}>
      <div className="shell"><main className="content"><PhoneInitiatives controller={controller} lookups={harnessLookups} me="u1" tenantId="t1" /></main></div>
    </WorkspaceProvider>
  );
}
