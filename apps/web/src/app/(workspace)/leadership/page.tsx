import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { LeadershipClient } from "@/features/leadership/leadership-client";

export const metadata = { title: "Leadership · Product Velocity" };

/** The portfolio-level view for leadership viewers (and everyone else in the workspace): read-only, scope-aware. */
export default async function LeadershipPage() {
  const { supabase, active, user } = await requireWorkspace("/leadership");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <LeadershipClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
