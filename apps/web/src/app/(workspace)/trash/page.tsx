import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { TrashClient } from "@/features/trash/trash-client";

export const metadata = { title: "Trash · Product Velocity" };

/** Deleted initiatives of the workspace: restore (creators and admins) or delete forever (admins). */
export default async function TrashPage() {
  const { supabase, active } = await requireWorkspace("/trash");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <TrashClient tenantId={active.tenantId} role={active.role} lookups={lookups} />;
}
