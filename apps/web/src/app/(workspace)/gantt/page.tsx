import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { PhoneRedirect } from "@/components/phone-redirect";
import { GanttClient } from "@/features/gantt/gantt-client";

export const metadata = { title: "Gantt · Product Velocity" };

export default async function GanttPage() {
  const { supabase, active, user } = await requireWorkspace("/gantt");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <><PhoneRedirect to={`/w/${active.tenantId}/cards`} /><div className="desktop-only"><GanttClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} /></div></>;
}
