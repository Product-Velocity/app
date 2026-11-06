import "server-only";
import type { RemovedCtx } from "./removed-gate";

// Initiatives an approver STOPPED at a decision gate (issue #343; Ashu 2026-11-05): Initiative Status is Cancelled and the latest decided gate request is a Stop.
// They are offered next to the removed ones in "Removed or stopped in Product Velocity", with the same boundaries (decisions 2026-11-03-github-close-removed and
// 2026-11-03-jira-close-removed): link in mode push, not handled before, a creator or admin confirms each one, nothing is written before. The database function
// `item_is_stopped` is the same test again at the moment of recording. A read that fails offers nothing (the Trash list still works).
export type StoppedRow = { id: string; item_code: string; initiative_name: string; gate: string };

const IN_CHUNK = 100;
const chunk = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function stoppedItems(ctx: RemovedCtx, only?: string): Promise<StoppedRow[]> {
  let q = ctx.supabase.from("items").select("id, item_code, initiative_name").eq("tenant_id", ctx.tenantId).eq("initiative_status", "Cancelled");
  if (only) q = q.eq("id", only);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return [];
  const cancelled = data as { id: string; item_code: string; initiative_name: string }[];
  const latest = new Map<string, { gate: string; outcome: string | null; at: string }>();
  for (const part of chunk(cancelled.map((c) => c.id), IN_CHUNK)) {
    const r = await ctx.supabase.from("gate_reviews").select("item_id, gate, outcome, decided_at").eq("tenant_id", ctx.tenantId).eq("kind", "decision").in("item_id", part);
    if (r.error) return [];
    for (const g of (r.data ?? []) as { item_id: string; gate: string; outcome: string | null; decided_at: string | null }[]) {
      if (!g.decided_at) continue; // an open request decides nothing
      const seen = latest.get(g.item_id);
      if (!seen || g.decided_at > seen.at) latest.set(g.item_id, { gate: g.gate, outcome: g.outcome, at: g.decided_at });
    }
  }
  return cancelled.filter((c) => latest.get(c.id)?.outcome === "stop").map((c) => ({ ...c, gate: latest.get(c.id)!.gate }));
}
