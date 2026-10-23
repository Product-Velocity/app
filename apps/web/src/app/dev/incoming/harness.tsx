"use client";

import { useMemo } from "react";
import { IncomingView } from "@/features/incoming/incoming-view";
import { MemoryIncomingSource } from "@/features/incoming/memory-source";

const PROJECTS = [{ id: "p1", name: "Platform" }, { id: "p2", name: "Marketplace" }];

export function IncomingHarness({ role }: { role: string }) {
  const source = useMemo(() => new MemoryIncomingSource(), []);
  return (
    <div className="shell"><main className="content">
      <IncomingView source={source} projects={PROJECTS} canEdit={role === "creator" || role === "admin"} canAdmin={role === "admin"} now={Date.UTC(2026, 9, 23)} />
    </main></div>
  );
}
