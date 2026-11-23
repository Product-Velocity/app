"use client";

import { MemoryGateSource } from "@/features/gates/gate-source";
import { useEffect, useMemo } from "react";
import { AppHeader } from "@/components/app-header";
import { CardsView } from "@/features/cards/cards-view";
import { WorkspaceProvider } from "@/features/workspace/provider";
import { MemoryWorkspaceStore } from "@/features/workspace/store";
import { harnessLookups as baseLookups, makeCardsHarness } from "../harness-data";
import type { Lookups } from "@/features/portfolio/types";

// tracker links on two cards, for the clickable tracker IDs in the card header
const harnessLookups: Lookups = {
  ...baseLookups,
  github: { connected: true, links: {
    "item-1": { mode: "push", number: 42, url: "https://github.com/acme/app/issues/42", state: "synced", error: null, ghState: "open", lastActivity: null },
  } },
  jira: { links: {
    "item-2": { mode: "follow", issueKey: "PLAT-7", url: "https://acme.atlassian.net/browse/PLAT-7", status: "In Progress", category: "indeterminate", lastSynced: null },
    "item-1": { mode: "follow", issueKey: "PLAT-1", url: "javascript:alert(1)", status: null, category: null, lastSynced: null },
  } },
};

export function HarnessCards({ n, role }: { n: number; role: string }) {
  const { controller, source } = useMemo(() => makeCardsHarness(n, role), [n, role]);
  const store = useMemo(() => Object.assign(new MemoryWorkspaceStore({
    me: "u1", admin: role === "admin",
    scopes: [{ id: "scope-a", name: "Marketplace and Platform", projectIds: ["p1", "p2"] }, { id: "scope-b", name: "Customer-facing work", projectIds: ["p3"] }],
    views: [
      { id: "view-must", name: "Must haves", surface: "cards", columns: ["stack_rank", "item_code", "initiative_name"], filters: [{ field: "moscow", op: "is", value: "Must" }], groupBy: null },
      { id: "view-detail", name: "With dates", surface: "cards", columns: ["stack_rank", "item_code", "initiative_name", "g2m_date_est", "confidence", "horizon", "start_date"], filters: [], groupBy: null },
    ],
  }), { projects: harnessLookups.projects }), []);
  // a move without a gate: the in-memory gate source changes the row like the database would, then the board reads it back
  const gates = useMemo(() => {
    const g = new MemoryGateSource();
    g.onMove = (id, to) => { const stored = source.items.find((i) => i.id === id) as Record<string, unknown> | undefined; if (stored) stored.initiative_phase = to; };
    return g;
  }, [source]);
  useEffect(() => { (window as unknown as { __pv: unknown }).__pv = { controller, source, store, gates }; }, [controller, source, store, gates]);
  return (
    <WorkspaceProvider store={store} projects={harnessLookups.projects} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"} userId="u1">
      <div className="shell">
        <AppHeader tenantName="Meridian Media" email="ashu.mathura@example.test" roleLabel="Admin" isApprover current="cards" />
        <main className="content"><CardsView controller={controller} lookups={harnessLookups} me="u1" gates={gates} pageHref={(c) => `/dev/item/${encodeURIComponent(c)}`} /></main>
      </div>
    </WorkspaceProvider>
  );
}
