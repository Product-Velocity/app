import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { AttentionClient } from "@/features/attention/attention-client";

export const metadata = { title: "Needs attention · Product Velocity" };

/** What has to be looked at, why, and the next step (issue #337, docs/28-DECISION-GATES.md). Scope-aware like the grid. */
export default async function AttentionPage() {
  const { supabase, active, user } = await requireWorkspace("/attention");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <AttentionClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
