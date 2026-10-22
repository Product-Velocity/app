import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { GanttClient } from "@/features/gantt/gantt-client";

export const metadata = { title: "Gantt · Product Velocity" };

export default async function GanttPage() {
  const { supabase, active, user } = await requireWorkspace("/gantt");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <GanttClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
