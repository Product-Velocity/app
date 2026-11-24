import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { PhoneTrackerClient } from "@/features/phone/phone-tracker";

export const metadata = { title: "Tracker · Product Velocity" };

/** The latest changes that came from GitHub and Jira, as cards (issue #635). Made for a phone; it also works on a computer. */
export default async function TrackerPage() {
  const { supabase, active, user } = await requireWorkspace("/tracker");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <PhoneTrackerClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
