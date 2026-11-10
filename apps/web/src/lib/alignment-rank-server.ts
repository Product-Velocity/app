import "server-only";
import type { requireWorkspace } from "@/lib/session";
import { suggestionRows, type SuggestionRow } from "@/lib/alignment-rank";
import type { ResultsSnapshot } from "@/lib/alignment-results";

type Supabase = Awaited<ReturnType<typeof requireWorkspace>>["supabase"];

/** The initiatives of a closed session as the vote and today's Stack Rank see them. Read as the signed-in person, so the workspace's rules apply. */
export async function loadSuggestion(supabase: Supabase, tenantId: string, sessionId: string, snap: ResultsSnapshot): Promise<{ rows: SuggestionRow[]; skipped: number }> {
  const { data: links } = await supabase.from("alignment_items").select("id, item_id").eq("tenant_id", tenantId).eq("session_id", sessionId);
  const list = (links ?? []) as { id: string; item_id: string | null }[];
  const ids = list.map((l) => l.item_id).filter((x): x is string => !!x);
  const { data: items } = ids.length
    ? await supabase.from("items").select("id, item_code, initiative_name, stack_rank, cycle_id, deleted_at").eq("tenant_id", tenantId).in("id", ids)
    : { data: [] };
  return suggestionRows(snap.results.joint, list, (items ?? []) as never);
}
