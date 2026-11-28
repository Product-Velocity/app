import "server-only";
import type { requireWorkspace } from "@/lib/session";
import { moscowRows, type MoscowRow } from "@/lib/alignment-moscow";
import type { ResultsSnapshot } from "@/lib/alignment-results";

type Supabase = Awaited<ReturnType<typeof requireWorkspace>>["supabase"];

/** The initiatives of a closed MoSCoW session as the vote and today's MoSCoW field see them. Read as the signed-in person, so the workspace's rules apply. */
export async function loadMoscow(supabase: Supabase, tenantId: string, sessionId: string, snap: ResultsSnapshot): Promise<{ rows: MoscowRow[]; skipped: number }> {
  const { data: links } = await supabase.from("alignment_items").select("id, item_id").eq("tenant_id", tenantId).eq("session_id", sessionId);
  const list = (links ?? []) as { id: string; item_id: string | null }[];
  const ids = list.map((l) => l.item_id).filter((x): x is string => !!x);
  const { data: items } = ids.length
    ? await supabase.from("items").select("id, item_code, initiative_name, moscow, deleted_at").eq("tenant_id", tenantId).in("id", ids)
    : { data: [] };
  return moscowRows(snap.results.moscow ?? [], list, (items ?? []) as never);
}
