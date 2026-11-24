import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { InsightsClient } from "@/features/phone/insights-view";

export const metadata = { title: "Insights · Product Velocity" };

/** Key charts for a phone (issue #635). Works on a computer too. */
export default async function InsightsPage() {
  const { supabase, active, user } = await requireWorkspace("/insights");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <InsightsClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
