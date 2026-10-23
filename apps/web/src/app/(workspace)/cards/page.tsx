import { requireWorkspace } from "@/lib/session";
import { loadLookups } from "@/features/portfolio/lookups";
import { CardsClient } from "@/features/cards/cards-client";

export const metadata = { title: "Cards · Product Velocity" };

export default async function CardsPage() {
  const { supabase, active, user } = await requireWorkspace("/cards");
  const lookups = await loadLookups(supabase, active.tenantId);
  return <CardsClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} />;
}
