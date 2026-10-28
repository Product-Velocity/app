import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { ReportsClient } from "@/features/reports/reports-client";

export const metadata = { title: "Reports · Product Velocity" };

export default async function ReportsPage() {
  const { supabase, active, user } = await requireWorkspace("/reports");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <ReportsClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
