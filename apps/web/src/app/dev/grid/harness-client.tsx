"use client";

import { useEffect, useMemo } from "react";
import { PortfolioController } from "@/features/portfolio/controller";
import { MemoryDataSource, sampleItems } from "@/features/portfolio/memory-source";
import { PortfolioGrid } from "@/features/portfolio/portfolio-grid";
import type { Lookups } from "@/features/portfolio/types";

const lookups: Lookups = {
  projects: ["Platform", "Marketplace", "Growth", "Payments", "Mobile", "Data"].map((name, i) => ({ id: `p${i + 1}`, name })),
  members: ["ana", "bo", "chen", "dee", "eli"].map((n, i) => ({ user_id: `u${i + 1}`, email: `${n}@example.test` })),
};

export function HarnessClient({ n, latency, role }: { n: number; latency: number; role: string }) {
  const { controller, source } = useMemo(() => {
    const items = sampleItems(n, lookups.projects.map((p) => p.id), lookups.members.map((m) => m.user_id));
    const source = new MemoryDataSource(items, { latencyMs: latency });
    const controller = new PortfolioController(source, items, lookups, role, () => new Date(Date.UTC(2027, 3, 14)));
    return { controller, source };
  }, [n, latency, role]);
  useEffect(() => {
    (window as unknown as { __pv: unknown }).__pv = { controller, source };
  }, [controller, source]);
  return (
    <div style={{ padding: 16 }}>
      <h1>Roadmap (test page)</h1>
      <PortfolioGrid controller={controller} lookups={lookups} />
    </div>
  );
}
