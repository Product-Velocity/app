"use client";

import { useMemo } from "react";
import { MemoryGateSource } from "@/features/gates/gate-source";
import { ForYou } from "@/features/phone/for-you";
import { PhoneQuickAdd } from "@/features/phone/phone-quick-add";
import { PhoneInitiatives } from "@/features/phone/phone-initiatives";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeCardsHarness } from "../harness-data";

export function HarnessPhone({ n, screen }: { n: number; screen: string }) {
  const { controller } = useMemo(() => makeCardsHarness(n, "creator"), [n]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [], views: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit canAdmin={false}>
      <div className="shell"><main className="content">{screen === "add" ? <PhoneQuickAdd controller={controller} lookups={harnessLookups} tenantId="t1" />
          : screen === "for-you" ? <ForYou controller={controller} me="u1" tenantId="t1" lookups={harnessLookups} source={new MemoryGateSource()} />
          : <PhoneInitiatives controller={controller} lookups={harnessLookups} me="u1" tenantId="t1" />}</main></div>
    </WorkspaceProvider>
  );
}
