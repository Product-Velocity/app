"use client";

import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { TrashView } from "@/features/trash/trash-view";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups, makeHarness } from "../harness-data";

const NOW = Date.UTC(2027, 3, 14, 12);

/** Twelve items, four of them already deleted (by Ana and Bo, on different days). */
export function HarnessTrash({ role }: { role: string }) {
  const { source } = useMemo(() => {
    const h = makeHarness(12, 0, role);
    const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
    void h.source.trashItems(["item-2", "item-5", "item-7", "item-9"]).then(() => {
      const when: Record<string, [number, string]> = { "item-2": [1, "u1"], "item-5": [10, "u2"], "item-7": [29, "u1"], "item-9": [3, "u2"] };
      for (const t of h.source.trash) { t.deleted_at = day(when[t.id]![0]); t.deleted_by = when[t.id]![1]; }
    });
    return h;
  }, [role]);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { source }; }, [source]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({ scopes: [] }), { projects: harnessLookups.projects }), []);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"}>
    <div className="shell">
      <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="grid" showTrash />
      <main className="content"><TrashView source={source} lookups={harnessLookups} role={role} now={NOW} /></main>
    </div>
    </WorkspaceProvider>
  );
}
