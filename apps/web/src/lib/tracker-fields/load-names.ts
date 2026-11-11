import type { SupabaseClient } from "@supabase/supabase-js";
import type { Names } from "@pv/github";
import { namesFromRows, parseConfigRows } from "./mapping";
import type { Tracker } from "./slots";

/**
 * The stealth-mode names saved for the project an item belongs to (issue #411), for the writes that are not a normal Sync (the "removed" label).
 * Anything that can not be read (no item, no project, no table or column yet) gives no names: the `pv:` defaults, as before.
 */
export async function namesForItem(supabase: SupabaseClient, tenantId: string, itemId: string, tracker: Tracker): Promise<Names> {
  try {
    const { data: item } = await supabase.from("items").select("home_project_id").eq("tenant_id", tenantId).eq("id", itemId).maybeSingle();
    const project = (item as { home_project_id?: string | null } | null)?.home_project_id;
    if (!project) return {};
    const { data } = await supabase.from("tracker_field_config").select("slot, enabled, field_id, label_text").eq("tenant_id", tenantId).eq("project_id", project).eq("provider", tracker);
    const rows = ((data ?? []) as { slot: string; enabled: boolean; field_id: string | null; label_text?: string | null }[]).map((r) => ({ slot: r.slot, enabled: r.enabled, field: r.field_id, text: r.label_text ?? null }));
    return namesFromRows(parseConfigRows(rows, tracker), tracker);
  } catch {
    return {};
  }
}
