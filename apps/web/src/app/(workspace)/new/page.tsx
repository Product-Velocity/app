import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { PhoneQuickAddClient } from "@/features/phone/phone-quick-add";

export const metadata = { title: "New initiative · Product Velocity" };

/** Quick add on a phone: name only is required; complete it on a computer later (docs/29-MOBILE.md section 4.4). */
export default async function NewPage() {
  const { supabase, active, user } = await requireWorkspace("/new");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <PhoneQuickAddClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
