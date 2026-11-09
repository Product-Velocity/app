import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { ForYouClient } from "@/features/phone/for-you";

export const metadata = { title: "For you · Product Velocity" };

/** The phone's home: what needs this person now (docs/29-MOBILE.md section 4.1). Works on a computer too. */
export default async function ForYouPage() {
  const { supabase, active, user } = await requireWorkspace("/for-you");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <ForYouClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
