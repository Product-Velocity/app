import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { OpenOnComputer } from "@/components/open-on-computer";
import { GanttClient } from "@/features/gantt/gantt-client";

export const metadata = { title: "Gantt · Product Velocity" };

export default async function GanttPage() {
  const { supabase, active, user } = await requireWorkspace("/gantt");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <><OpenOnComputer what="The Gantt" /><div className="desktop-only"><GanttClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} /></div></>;
}
