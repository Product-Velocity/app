import { requireWorkspace } from "@/lib/session";
import { ItemPageClient } from "@/features/portfolio/item-page-client";
import { loadLookups } from "@/features/portfolio/lookups";

export async function generateMetadata({ params }: { params: Promise<{ item: string }> }) {
  const { item } = await params;
  return { title: `${decodeURIComponent(item)} · Product Velocity` };
}

/** One initiative on a page of its own. The address is shareable; the data and the role rules are the same as in the grid. */
export default async function ItemPage({ params }: { params: Promise<{ item: string }> }) {
  const { item } = await params;
  const code = decodeURIComponent(item);
  const { supabase, active, user } = await requireWorkspace(`/portfolio/${encodeURIComponent(code)}`);
  const lookups = await loadLookups(supabase, active.tenantId);
  return <ItemPageClient tenantId={active.tenantId} role={active.role} userId={user.id} lookups={lookups} code={code} />;
}
