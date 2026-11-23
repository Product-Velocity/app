import { createClient } from "@/lib/supabase/browser";
import type { QuickField } from "./quick-change";

export type QuickChangeResult = { ok: true; old: string | null; new: string } | { ok: false; error: string };
/** Where a quick change is saved: the database function item_quick_change in the app, a stand-in in the test page. */
export type QuickChangeSource = { change(itemId: string, field: QuickField, value: string, note: string): Promise<QuickChangeResult> };

export const supabaseQuickChangeSource: QuickChangeSource = {
  async change(itemId, field, value, note) {
    const { data, error } = await createClient().rpc("item_quick_change", { p_item: itemId, p_field: field, p_value: value, p_note: note.trim() || null });
    if (error) return { ok: false, error: error.message };
    const r = (data ?? {}) as { old?: string | null; new?: string };
    return { ok: true, old: r.old ?? null, new: r.new ?? value };
  },
};
